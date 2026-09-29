// Downloads traverse the Vercel Function as authenticated responses. Keep the
// binary below its 4.5 MB response ceiling as well as the upload body limit.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const RESUMABLE_UPLOAD_CHUNK_BYTES = 1024 * 1024
export const MAX_LEGACY_BASE64_ATTACHMENT_BYTES = 3 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/avif',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function validationError(code, message, details) {
  const error = new Error(message)
  error.status = 422
  error.code = code
  error.details = details
  return error
}

function normalizedName(value) {
  const name = String(value || '').trim()
  if (!name) throw validationError('FILE_NAME_REQUIRED', 'Nome do arquivo é obrigatório.')
  if (name.length > 180) throw validationError('FILE_NAME_TOO_LONG', 'Nome do arquivo excede 180 caracteres.')
  return name
}

function normalizedMimeType(value) {
  const mimeType = String(value || '').trim().toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw validationError('UNSUPPORTED_FILE_TYPE', 'Tipo de arquivo não suportado. Envie PDF, JPG, PNG, WEBP, GIF, AVIF, HEIC ou HEIF.')
  }
  return mimeType
}

function normalizedSize(value, maxBytes = MAX_ATTACHMENT_BYTES) {
  const size = Number(value)
  if (!Number.isSafeInteger(size) || size <= 0) throw validationError('INVALID_FILE_SIZE', 'Tamanho do arquivo inválido.')
  if (size > maxBytes) throw validationError('FILE_TOO_LARGE', `Arquivo excede ${Math.floor(maxBytes / 1024 / 1024)} MB.`, { maxBytes })
  return size
}

export function normalizeAttachmentMetadata(input, { maxBytes = MAX_ATTACHMENT_BYTES } = {}) {
  return {
    name: normalizedName(input?.name),
    mimeType: normalizedMimeType(input?.mimeType),
    size: normalizedSize(input?.size, maxBytes),
    categoria: String(input?.categoria || 'Outro').trim() || 'Outro',
  }
}

export function decodeBase64Attachment(value, expectedSize) {
  const encoded = String(value || '').trim()
  // FileReader.readAsDataURL() produces canonical Base64. Reject malformed
  // input rather than letting Buffer silently decode partial data.
  if (!encoded || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw validationError('INVALID_FILE_DATA', 'Conteúdo do arquivo inválido.')
  }
  if (encoded.length > Math.ceil(expectedSize / 3) * 4 + 4) {
    throw validationError('FILE_SIZE_MISMATCH', 'O tamanho informado não corresponde ao conteúdo enviado.')
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (!buffer.length) throw validationError('INVALID_FILE_DATA', 'Conteúdo do arquivo vazio.')
  if (buffer.length !== expectedSize) {
    throw validationError('FILE_SIZE_MISMATCH', 'O tamanho informado não corresponde ao conteúdo enviado.')
  }
  return buffer
}

export function safeStorageFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'arquivo'
}

export function isInlinePreviewMimeType(mimeType) {
  return new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']).has(mimeType)
}
