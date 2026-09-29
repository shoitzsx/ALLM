const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')
const USER_KEY = 'alm:api:user:v1'

function currentUserId() {
  try { return localStorage.getItem(USER_KEY) || 'USR-001' } catch { return 'USR-001' }
}
export function setApiUser(userId) { try { localStorage.setItem(USER_KEY, userId) } catch {} }

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUserId(), ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = {}
  try { payload = text ? JSON.parse(text) : {} } catch { payload = { raw: text } }
  if (!response.ok) {
    const details = Object.values(payload?.error?.details || {}).filter(Boolean)
    const requestError = new Error(
      details.length ? details.join(' ') : payload?.error?.message || `Erro HTTP ${response.status}`,
    )
    requestError.code = payload?.error?.code
    requestError.details = payload?.error?.details
    throw requestError
  }
  return payload
}

export const api = {
  me: () => apiRequest('/auth/me'),
  listRecebimentos: (params = {}) => apiRequest(`/recebimentos?${new URLSearchParams(params)}`),
  getRecebimento: (id) => apiRequest(`/recebimentos/${encodeURIComponent(id)}`),
  createRecebimento: (input) => apiRequest('/recebimentos', { method: 'POST', body: JSON.stringify(input) }),
  updateRecebimento: (id, input) => apiRequest(`/recebimentos/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  addItem: (id, input) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/itens`, { method: 'POST', body: JSON.stringify(input) }),
  updateItem: (id, itemId, input) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/itens/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeItem: (id, itemId) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/itens/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
  addDivergence: (id, input) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/divergencias`, { method: 'POST', body: JSON.stringify(input) }),
  resolveDivergence: (id, divId, resolution) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/divergencias/${encodeURIComponent(divId)}/resolver`, { method: 'POST', body: JSON.stringify({ resolucao: resolution }) }),
  reopenDivergence: (id, divId, reason) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/divergencias/${encodeURIComponent(divId)}/reabrir`, { method: 'POST', body: JSON.stringify({ reason }) }),
  transitionStatus: (id, status, note, force = false) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status, observacao: note, force }) }),
  archive: (id, reason) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/arquivar`, { method: 'POST', body: JSON.stringify({ reason }) }),
  restore: (id) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/restaurar`, { method: 'POST', body: '{}' }),
  // Legado (Base64 embutido no JSON) — mantido só por compatibilidade com o
  // contrato antigo. O fluxo novo (abaixo) não o usa.
  uploadAttachment: async (id, file, category) => {
    const dataBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file) })
    return apiRequest(`/recebimentos/${encodeURIComponent(id)}/anexos`, { method: 'POST', body: JSON.stringify({ name: file.name, mimeType: file.type, size: file.size, categoria: category, dataBase64 }) })
  },
  // Fluxo resumível (ver docs/attachments-api.md): cria a sessão no ALM, o
  // envio dos bytes acontece direto contra o Drive (src/features/attachments/resumableUpload.js).
  createAttachmentUploadSession: (id, metadata) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/anexos/upload-sessions`, { method: 'POST', body: JSON.stringify(metadata) }),
  confirmAttachment: (id, { fileId, categoria }) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/anexos`, { method: 'POST', body: JSON.stringify({ fileId, categoria }) }),
  removeAttachment: (id, attachmentId, reason) => apiRequest(`/recebimentos/${encodeURIComponent(id)}/anexos/${encodeURIComponent(attachmentId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  dashboard: () => apiRequest('/dashboard'),
}

// `attachment.url` já vem como caminho pronto do backend (nunca montamos com
// fileId/storageKey) — isto só reposiciona esse caminho sobre API_BASE, para
// continuar correto mesmo se VITE_API_URL apontar para outro host em dev.
export function attachmentDownloadHref(attachment) {
  const path = String(attachment?.url || '').replace(/^\/api\/v1/, '')
  return `${API_BASE}${path}`
}
