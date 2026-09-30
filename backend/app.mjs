import { randomUUID } from 'node:crypto'
import { DEMO_USERS } from '../src/data.js'
import { readEnvironment } from './config/env.mjs'
import { createGoogleSheetsClient } from './integrations/googleSheets.mjs'
import { createGoogleDriveClient, isOriginAllowed } from './integrations/googleDrive.mjs'
import { createRecebimentosRepository } from './repositories/recebimentosRepository.mjs'
import * as service from './services/recebimentosService.mjs'
import { MAX_ATTACHMENT_BYTES, MAX_LEGACY_BASE64_ATTACHMENT_BYTES, RESUMABLE_UPLOAD_CHUNK_BYTES, decodeBase64Attachment, isInlinePreviewMimeType, normalizeAttachmentMetadata } from './attachments.mjs'

const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)) }
const error = (res, status, code, message, details) => json(res, status, { error: { code, message, ...(details ? { details } : {}) } })
const routeParts = (url) => url.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean)
const parseUrl = (req) => new URL(req.url, `http://${req.headers.host || 'localhost'}`)
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) return {}; try { return JSON.parse(raw) } catch { const exception = new Error('JSON inválido.'); exception.status = 400; exception.code = 'INVALID_JSON'; throw exception } }
function sendDownload(res, { buffer, mimeType, name }, corsOrigin) {
  const safeName = encodeURIComponent(String(name || 'arquivo').replace(/[\r\n]/g, ''))
  const disposition = isInlinePreviewMimeType(mimeType) ? 'inline' : 'attachment'
  res.writeHead(200, {
    'Content-Length': buffer.length,
    'Content-Type': mimeType,
    'Content-Disposition': `${disposition}; filename*=UTF-8''${safeName}`,
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': corsOrigin,
  })
  res.end(buffer)
}
export function attachmentResponse(attachment) {
  const { storageKey, _rowNumber, ...publicAttachment } = attachment
  return publicAttachment
}

// Tenta persistir; se falhar, tenta desfazer o efeito colateral externo
// (o upload no Drive) e, se ATÉ a limpeza falhar, avisa via onCleanupFailed
// em vez de engolir silenciosamente — mas o erro relançado é sempre o da
// falha de persistência original, nunca o da limpeza.
export async function persistOrCleanupDrive({ persist, cleanup, onCleanupFailed }) {
  try {
    return await persist()
  } catch (exception) {
    try {
      await cleanup()
    } catch {
      onCleanupFailed?.()
    }
    throw exception
  }
}
function receiptResponse(receipt) {
  return { ...receipt, anexos: (receipt.anexos || []).map(attachmentResponse) }
}
function listFiltered(recebimentos, search) { let rows = search.get('includeArchived') === 'true' ? recebimentos : recebimentos.filter((entry) => !entry.arquivado); const q = (search.get('q') || '').toLowerCase().trim(); const status = search.get('status'); const fornecedor = search.get('fornecedor'); const pedido = search.get('pedido'); const nf = search.get('numeroNf'); if (q) rows = rows.filter((entry) => JSON.stringify(entry).toLowerCase().includes(q)); if (status) rows = rows.filter((entry) => entry.status === status); if (fornecedor) rows = rows.filter((entry) => entry.fornecedor === fornecedor); if (pedido) rows = rows.filter((entry) => entry.pedido === pedido); if (nf) rows = rows.filter((entry) => entry.numeroNf === nf); const orderBy = search.get('orderBy') || 'dataRecebimento'; const dir = search.get('order') === 'asc' ? 1 : -1; rows = [...rows].sort((a, b) => String(a[orderBy] || '').localeCompare(String(b[orderBy] || '')) * dir); const page = Math.max(1, Number(search.get('page') || 1)); const pageSize = Math.min(100, Math.max(1, Number(search.get('pageSize') || 50))); return { data: rows.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) } } }

export async function createApp() {
  const env = readEnvironment()
  const repository = createRecebimentosRepository({ sheets: createGoogleSheetsClient(env.google), defaultUsers: DEMO_USERS })
  const drive = createGoogleDriveClient(env.google.drive)
  const receiptOr404 = (res, receipt) => { if (receipt) return receipt; error(res, 404, 'RECEIPT_NOT_FOUND', 'Recebimento não encontrado.'); return null }
  function writeGuard(user, res) { if (service.canWrite(user)) return true; error(res, 403, 'FORBIDDEN', 'O perfil Consulta não pode alterar dados.'); return false }
  async function requestUser(req, res) { const user = await repository.getUsuario(req.headers['x-user-id'] || DEMO_USERS[0]?.id); if (!user) { error(res, 401, 'UNAUTHORIZED', 'Usuário não autenticado.'); return null } return user }
  const save = async (receipt) => repository.updateRecebimento(receipt)
  async function saveUploadedAttachment(receipt, metadata, uploaded, user) {
    const attachment = service.addAttachment(receipt, metadata, uploaded.id, user)
    // The Drive object has no value without durable metadata in Sheets.
    await persistOrCleanupDrive({
      persist: () => repository.addAttachmentRow(receipt),
      cleanup: () => drive.deleteFile(uploaded.id),
      onCleanupFailed: () => console.error('Cleanup do Drive falhou após erro de persistência.', { receiptId: receipt.id, attachmentId: attachment.id, cleanupFailed: true }),
    })
    return attachment
  }

  async function handle(req, res) {
    const url = parseUrl(req); const parts = routeParts(url)
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': env.corsOrigin, 'Access-Control-Allow-Headers': 'Content-Type, X-User-Id', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' }); return res.end() }
    if (!url.pathname.startsWith('/api/v1')) return error(res, 404, 'NOT_FOUND', 'Rota não encontrada.')
    try {
      const user = await requestUser(req, res); if (!user) return
      if (parts.join('/') === 'auth/me' && req.method === 'GET') return json(res, 200, { ...service.actor(user), email: user.email, permissoes: service.permissions(user) })
      if (parts.join('/') === 'catalogos' && req.method === 'GET') return json(res, 200, service.catalogos())
      if (parts.join('/') === 'usuarios' && req.method === 'GET') return json(res, 200, { data: await repository.listUsuarios() })
      if (parts.join('/') === 'usuarios' && req.method === 'POST') { if (!service.isAdmin(user)) return error(res, 403, 'FORBIDDEN', 'Somente administrador pode criar usuários.'); const input = await body(req); if (!input.nome || !input.email || !input.perfil) return error(res, 422, 'VALIDATION_ERROR', 'Nome, e-mail e perfil são obrigatórios.'); if (!['Administrador', 'Almoxarifado', 'Suprimentos', 'Consulta'].includes(input.perfil)) return error(res, 422, 'VALIDATION_ERROR', 'Perfil inválido.'); const created = { id: input.id || `USR-${randomUUID()}`, nome: String(input.nome).trim(), name: String(input.nome).trim(), iniciais: String(input.nome).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(), email: String(input.email).trim(), perfil: input.perfil, role: input.perfil, ativo: input.ativo !== false }; await repository.saveUsuario(created); return json(res, 201, created) }
      if (parts[0] === 'usuarios' && parts.length === 2 && req.method === 'GET') { const target = await repository.getUsuario(parts[1]); return target ? json(res, 200, target) : error(res, 404, 'USER_NOT_FOUND', 'Usuário não encontrado.') }
      if (parts[0] === 'usuarios' && parts.length === 2 && req.method === 'PATCH') { if (!service.isAdmin(user)) return error(res, 403, 'FORBIDDEN', 'Somente administrador pode editar usuários.'); const target = await repository.getUsuario(parts[1]); if (!target) return error(res, 404, 'USER_NOT_FOUND', 'Usuário não encontrado.'); const input = await body(req); if (input.perfil && !['Administrador', 'Almoxarifado', 'Suprimentos', 'Consulta'].includes(input.perfil)) return error(res, 422, 'VALIDATION_ERROR', 'Perfil inválido.'); Object.assign(target, input, { id: target.id }); target.name = target.nome; target.role = target.perfil; await repository.saveUsuario(target); return json(res, 200, target) }
      if (parts.join('/') === 'recebimentos' && req.method === 'GET') { const result = listFiltered(await repository.listRecebimentos(), url.searchParams); return json(res, 200, { ...result, data: result.data.map(receiptResponse) }) }
      if (parts.join('/') === 'recebimentos' && req.method === 'POST') { if (!writeGuard(user, res)) return; const created = service.createRecebimento(await body(req), user, await repository.listRecebimentos()); await repository.createRecebimento(created); return json(res, 201, receiptResponse(created)) }
      if (parts[0] === 'recebimentos' && parts.length === 2 && req.method === 'GET') { const receipt = await repository.getRecebimento(parts[1]); return receipt ? json(res, 200, receiptResponse(receipt)) : error(res, 404, 'RECEIPT_NOT_FOUND', 'Recebimento não encontrado.') }
      if (parts[0] === 'recebimentos' && parts.length === 2 && req.method === 'PATCH') { if (!writeGuard(user, res)) return; const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); if (!receipt) return; service.updateRecebimento(receipt, await body(req), user); await save(receipt); return json(res, 200, receiptResponse(receipt)) }
      if (parts[0] === 'recebimentos' && parts[2] === 'itens') { const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); if (!receipt) return; if (req.method === 'GET' && parts.length === 3) return json(res, 200, { data: receipt.itens || [] }); if (!writeGuard(user, res)) return; if (req.method === 'POST' && parts.length === 3) { const item = service.addItem(receipt, await body(req), user); await save(receipt); return json(res, 201, item) } if (parts.length === 4 && req.method === 'PATCH') { const item = service.updateItem(receipt, parts[3], await body(req), user); await save(receipt); return json(res, 200, item) } if (parts.length === 4 && req.method === 'DELETE') { const item = service.removeItem(receipt, parts[3], user); await save(receipt); return json(res, 200, item) } }
      if (parts[0] === 'recebimentos' && parts[2] === 'anexos') {
        const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); if (!receipt) return
        if (req.method === 'GET' && parts.length === 3) return json(res, 200, { data: (receipt.anexos || []).filter((entry) => !entry.removido).map(attachmentResponse) })
        if (req.method === 'GET' && parts.length === 5 && parts[4] === 'download') {
          const attachment = (receipt.anexos || []).find((entry) => entry.id === parts[3] && !entry.removido)
          if (!attachment) return error(res, 404, 'ATTACHMENT_NOT_FOUND', 'Arquivo não encontrado.')
          return sendDownload(res, await drive.downloadFile(attachment.storageKey), env.corsOrigin)
        }
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'upload-sessions') {
          if (!writeGuard(user, res)) return
          // O binário vai do navegador direto pro Drive (nunca pela nossa API) —
          // a sessionUrl só recebe CORS do Google para a Origin que mandarmos
          // agora. Por isso exigimos Origin e checamos contra a allowlist antes
          // de repassá-la; sem Origin (ex.: chamada server-to-server), recusamos,
          // já que este endpoint só existe para gerar sessão destinada ao navegador.
          const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : ''
          if (!isOriginAllowed(origin, env.google.drive.allowedUploadOrigins)) {
            return error(res, 403, 'ORIGIN_NOT_ALLOWED', 'Origem não autorizada para criar sessão de upload.')
          }
          const metadata = normalizeAttachmentMetadata(await body(req))
          const upload = await drive.createResumableUpload({ ...metadata, receiptId: receipt.id, origin })
          return json(res, 201, { upload: { sessionUrl: upload.sessionUrl, method: 'PUT', chunkSize: RESUMABLE_UPLOAD_CHUNK_BYTES }, constraints: { maxBytes: MAX_ATTACHMENT_BYTES, chunkBytes: RESUMABLE_UPLOAD_CHUNK_BYTES } })
        }
        if (req.method === 'POST' && parts.length === 3) {
          if (!writeGuard(user, res)) return
          const input = await body(req)
          if (input.fileId) {
            const uploaded = await drive.getUploadedFile(String(input.fileId), receipt.id)
            if ((receipt.anexos || []).some((entry) => entry.storageKey === uploaded.id && !entry.removido)) return error(res, 409, 'ATTACHMENT_ALREADY_LINKED', 'Arquivo já está vinculado a este recebimento.')
            const metadata = normalizeAttachmentMetadata({ ...input, name: uploaded.name, mimeType: uploaded.mimeType, size: Number(uploaded.size) })
            return json(res, 201, attachmentResponse(await saveUploadedAttachment(receipt, metadata, uploaded, user)))
          }
          if (!input.dataBase64) return error(res, 422, 'FILE_REQUIRED', 'Arquivo obrigatório.')
          const metadata = normalizeAttachmentMetadata(input, { maxBytes: MAX_LEGACY_BASE64_ATTACHMENT_BYTES })
          const buffer = decodeBase64Attachment(input.dataBase64, metadata.size)
          const uploaded = await drive.uploadFile({ ...metadata, buffer, receiptId: receipt.id })
          return json(res, 201, attachmentResponse(await saveUploadedAttachment(receipt, metadata, uploaded, user)))
        }
        if (parts.length === 4 && req.method === 'DELETE') { if (!writeGuard(user, res)) return; const attachment = service.removeAttachment(receipt, parts[3], (await body(req)).reason, user); await drive.deleteFile(attachment.storageKey); await repository.removeAttachmentRow(receipt, attachment); return json(res, 200, attachmentResponse(attachment)) }
      }
      if (parts[0] === 'recebimentos' && parts[2] === 'divergencias') { const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); if (!receipt) return; if (req.method === 'GET' && parts.length === 3) return json(res, 200, { data: receipt.divergencias || [] }); if (!writeGuard(user, res)) return; if (req.method === 'POST' && parts.length === 3) { const divergence = service.addDivergence(receipt, await body(req), user); await save(receipt); return json(res, 201, divergence) } if (parts.length === 5 && parts[4] === 'resolver' && req.method === 'POST') { const divergence = service.resolveDivergence(receipt, parts[3], await body(req), user); await save(receipt); return json(res, 200, divergence) } if (parts.length === 5 && parts[4] === 'reabrir' && req.method === 'POST') { const divergence = service.reopenDivergence(receipt, parts[3], await body(req), user); await save(receipt); return json(res, 200, divergence) } }
      if (parts[0] === 'recebimentos' && parts[2] === 'status' && parts.length === 3 && req.method === 'POST') { if (!writeGuard(user, res)) return; const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); if (!receipt) return; const result = service.transitionStatus(receipt, await body(req), user); await save(receipt); return json(res, 200, result) }
      if (parts[0] === 'recebimentos' && parts[2] === 'historico' && parts[3] === 'status' && req.method === 'GET') { const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); return receipt && json(res, 200, { data: receipt.historicoStatus || [] }) }
      if (parts[0] === 'recebimentos' && parts[2] === 'historico' && parts[3] === 'auditoria' && req.method === 'GET') { const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); return receipt && json(res, 200, { data: receipt.historicoAlteracoes || [] }) }
      if (parts[0] === 'recebimentos' && parts[2] === 'arquivar' && parts.length === 3 && req.method === 'POST') { const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); if (!receipt) return; service.archive(receipt, (await body(req)).reason, user); await save(receipt); return json(res, 200, receiptResponse(receipt)) }
      if (parts[0] === 'recebimentos' && parts[2] === 'restaurar' && parts.length === 3 && req.method === 'POST') { const receipt = receiptOr404(res, await repository.getRecebimento(parts[1])); if (!receipt) return; service.restore(receipt, user); await save(receipt); return json(res, 200, receiptResponse(receipt)) }
      if (parts.join('/') === 'dashboard' && req.method === 'GET') return json(res, 200, service.dashboard(await repository.listRecebimentos()))
      if (parts[0] === 'anexos' && parts.length === 3 && parts[2] === 'download' && req.method === 'GET') {
        try {
          const receipt = (await repository.listRecebimentos()).find((entry) => (entry.anexos || []).some((attachment) => attachment.storageKey === parts[1] && !attachment.removido))
          const attachment = receipt && receipt.anexos.find((entry) => entry.storageKey === parts[1] && !entry.removido)
          if (!attachment) return error(res, 404, 'FILE_NOT_FOUND', 'Arquivo não encontrado.')
          return sendDownload(res, await drive.downloadFile(attachment.storageKey), env.corsOrigin)
        } catch (exception) {
          if (exception.status) throw exception
          return error(res, 404, 'FILE_NOT_FOUND', 'Arquivo não encontrado.')
        }
      }
      return error(res, 404, 'NOT_FOUND', 'Endpoint não encontrado.')
    } catch (exception) { console.error(exception); return error(res, exception.status || 500, exception.code || 'INTERNAL_ERROR', exception.message || 'Erro interno.', exception.details) }
  }

  await repository.initialize()
  return { handle, env }
}
