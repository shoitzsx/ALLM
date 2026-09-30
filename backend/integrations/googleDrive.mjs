import { google } from 'googleapis'
import { Readable } from 'node:stream'
import { safeStorageFileName } from '../attachments.mjs'

const FOLDER_NAME = 'ALM Recebimentos - Anexos'
const RESUMABLE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,parents,appProperties,trashed'

// Escopo `drive.file`: a conta OAuth só enxerga arquivos/pastas criados por
// este app (não o Drive inteiro do usuário) — necessário porque contas de
// serviço não têm cota de armazenamento própria para criar arquivos no Drive.
export const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file']

export function createGoogleDriveOAuthClient(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

// Comparação exata, nunca substring/prefixo/regex — quem chama (backend/app.mjs)
// decide a allowlist; esta função só confere a decisão antes de repassar a
// Origin ao Google, nunca aceita o header do cliente sem checagem.
export function isOriginAllowed(origin, allowedOrigins) {
  return typeof origin === 'string' && origin.length > 0 && Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)
}

// Extraído à parte para poder testar, sem rede real, que a Origin já validada
// (nunca o header cru) é o que vai no POST que abre a sessão resumível no Drive.
export function buildResumableUploadHeaders({ accessToken, mimeType, size, origin }) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType,
    'X-Upload-Content-Length': String(size),
    ...(origin ? { Origin: origin } : {}),
  }
}

function driveError(exception, fallbackCode = 'DRIVE_OPERATION_FAILED') {
  if (exception?.status && typeof exception?.code === 'string') return exception
  const status = Number(exception?.response?.status || exception?.status || 0)
  const error = new Error(status === 401 ? 'Falha na autorização do Google Drive.' : 'Falha na operação no Google Drive.')
  error.status = 502
  error.code = status === 401 ? 'DRIVE_AUTH_FAILED' : fallbackCode
  error.cause = exception
  return error
}

export function createGoogleDriveClient(config) {
  const configured = Boolean(config.clientId && config.clientSecret && config.refreshToken)
  const auth = configured ? createGoogleDriveOAuthClient(config.clientId, config.clientSecret) : null
  if (auth) auth.setCredentials({ refresh_token: config.refreshToken })
  const drive = auth ? google.drive({ version: 'v3', auth }) : null

  let folderIdPromise = null
  function requireConfigured() {
    if (drive) return
    const error = new Error('Google Drive OAuth nao configurado.')
    error.status = 503
    error.code = 'DRIVE_NOT_CONFIGURED'
    throw error
  }

  async function ensureFolder() {
    requireConfigured()
    if (config.folderId) return config.folderId
    if (!folderIdPromise) {
      folderIdPromise = (async () => {
        try {
          const existing = await drive.files.list({
            q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id)',
            spaces: 'drive',
          })
          if (existing.data.files?.[0]) return existing.data.files[0].id
          const created = await drive.files.create({
            requestBody: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id',
          })
          return created.data.id
        } catch (exception) {
          folderIdPromise = null
          throw driveError(exception, 'DRIVE_FOLDER_UNAVAILABLE')
        }
      })()
    }
    return folderIdPromise
  }

  async function uploadFile({ name, mimeType, buffer, receiptId }) {
    const parents = [await ensureFolder()]
    try {
      const response = await drive.files.create({
        requestBody: { name: safeStorageFileName(name), mimeType, parents, appProperties: { almReceiptId: receiptId } },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id,name,mimeType,size,parents,appProperties,trashed',
      })
      return response.data
    } catch (exception) {
      throw driveError(exception)
    }
  }

  async function createResumableUpload({ name, mimeType, size, receiptId, origin }) {
    requireConfigured()
    const parents = [await ensureFolder()]
    try {
      const tokenResponse = await auth.getAccessToken()
      const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token
      if (!accessToken) throw new Error('Access token indisponível.')
      const response = await fetch(RESUMABLE_UPLOAD_URL, {
        method: 'POST',
        headers: buildResumableUploadHeaders({ accessToken, mimeType, size, origin }),
        body: JSON.stringify({ name: safeStorageFileName(name), mimeType, parents, appProperties: { almReceiptId: receiptId } }),
      })
      const sessionUrl = response.headers.get('location')
      if (!response.ok || !sessionUrl) {
        const details = await response.text().catch(() => '')
        const error = new Error(details || `Falha ao iniciar upload (${response.status}).`)
        error.status = response.status
        throw error
      }
      return { sessionUrl }
    } catch (exception) {
      throw driveError(exception, 'DRIVE_UPLOAD_SESSION_FAILED')
    }
  }

  async function getUploadedFile(fileId, receiptId) {
    requireConfigured()
    try {
      const response = await drive.files.get({ fileId, fields: 'id,name,mimeType,size,parents,appProperties,trashed' })
      const file = response.data
      const folderId = await ensureFolder()
      if (file.trashed) {
        const error = new Error('Arquivo não encontrado.')
        error.status = 404
        error.code = 'FILE_NOT_FOUND'
        throw error
      }
      if (!file.parents?.includes(folderId) || file.appProperties?.almReceiptId !== receiptId) {
        const error = new Error('Arquivo não pertence a este recebimento.')
        error.status = 422
        error.code = 'INVALID_UPLOAD_FILE'
        throw error
      }
      return file
    } catch (exception) {
      if (exception?.status && typeof exception?.code === 'string') throw exception
      const status = Number(exception?.response?.status || exception?.status || 0)
      if (status === 404) {
        const error = new Error('Arquivo não encontrado.')
        error.status = 404
        error.code = 'FILE_NOT_FOUND'
        throw error
      }
      throw driveError(exception)
    }
  }

  async function downloadFile(fileId) {
    requireConfigured()
    try {
      const meta = await drive.files.get({ fileId, fields: 'mimeType, name' })
      const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
      return { buffer: Buffer.from(response.data), mimeType: meta.data.mimeType || 'application/octet-stream', name: meta.data.name || 'arquivo' }
    } catch (exception) {
      const status = Number(exception?.response?.status || exception?.status || 0)
      if (status === 404) {
        const error = new Error('Arquivo não encontrado.')
        error.status = 404
        error.code = 'FILE_NOT_FOUND'
        throw error
      }
      throw driveError(exception)
    }
  }

  async function deleteFile(fileId) {
    requireConfigured()
    try {
      await drive.files.delete({ fileId })
    } catch (exception) {
      if (Number(exception?.response?.status || exception?.status || 0) !== 404) throw driveError(exception)
    }
  }

  return { uploadFile, createResumableUpload, getUploadedFile, downloadFile, deleteFile }
}
