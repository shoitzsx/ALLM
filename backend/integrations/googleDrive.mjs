import { google } from 'googleapis'
import { Readable } from 'node:stream'

const FOLDER_NAME = 'ALM Recebimentos - Anexos'

// Escopo `drive.file`: a conta OAuth só enxerga arquivos/pastas criados por
// este app (não o Drive inteiro do usuário) — necessário porque contas de
// serviço não têm cota de armazenamento própria para criar arquivos no Drive.
const SCOPES = ['https://www.googleapis.com/auth/drive.file']

export function createGoogleDriveClient(config) {
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret)
  auth.setCredentials({ refresh_token: config.refreshToken })
  const drive = google.drive({ version: 'v3', auth })

  let folderIdPromise = null
  async function ensureFolder() {
    if (config.folderId) return config.folderId
    if (!folderIdPromise) {
      folderIdPromise = (async () => {
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
      })()
    }
    return folderIdPromise
  }

  async function uploadFile({ name, mimeType, buffer }) {
    const parents = [await ensureFolder()]
    const response = await drive.files.create({
      requestBody: { name, parents },
      media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
      fields: 'id',
    })
    return { id: response.data.id }
  }

  async function downloadFile(fileId) {
    const meta = await drive.files.get({ fileId, fields: 'mimeType, name' })
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
    return { buffer: Buffer.from(response.data), mimeType: meta.data.mimeType || 'application/octet-stream' }
  }

  async function deleteFile(fileId) {
    await drive.files.delete({ fileId }).catch(() => {})
  }

  return { uploadFile, downloadFile, deleteFile }
}
