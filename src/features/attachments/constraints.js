// Espelha os limites documentados em docs/attachments-api.md — o backend
// (backend/attachments.mjs) continua sendo a autoridade final; isto é só
// validação client-side para feedback imediato, antes de abrir uma sessão.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const RESUMABLE_UPLOAD_CHUNK_BYTES = 1024 * 1024

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
]

export const ALLOWED_ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_MIME_TYPES.join(',')
export const ALLOWED_IMAGE_ACCEPT = ALLOWED_ATTACHMENT_MIME_TYPES.filter((type) => type.startsWith('image/')).join(',')

function attachmentValidationError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function validateAttachmentFile(file) {
  if (!file) throw attachmentValidationError('FILE_NAME_REQUIRED', 'Selecione um arquivo.')
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type)) {
    throw attachmentValidationError('UNSUPPORTED_FILE_TYPE', 'Este tipo de arquivo não é aceito.')
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw attachmentValidationError('FILE_TOO_LARGE', 'O arquivo excede o limite de 4 MiB.')
  }
}
