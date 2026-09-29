import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_ATTACHMENT_BYTES, MAX_LEGACY_BASE64_ATTACHMENT_BYTES, decodeBase64Attachment, isInlinePreviewMimeType, normalizeAttachmentMetadata } from './attachments.mjs'
import { createGoogleDriveClient } from './integrations/googleDrive.mjs'

const valid = { name: 'nota-fiscal.pdf', mimeType: 'application/pdf', size: 3, categoria: 'Nota Fiscal' }

test('normaliza metadados válidos de anexo', () => {
  assert.deepEqual(normalizeAttachmentMetadata(valid), valid)
})

test('rejeita formatos que não são documentos ou imagens permitidos', () => {
  assert.throws(
    () => normalizeAttachmentMetadata({ ...valid, mimeType: 'text/html' }),
    { code: 'UNSUPPORTED_FILE_TYPE', status: 422 },
  )
})

test('aplica os limites próprios dos fluxos resumível e legado', () => {
  assert.throws(
    () => normalizeAttachmentMetadata({ ...valid, size: MAX_ATTACHMENT_BYTES + 1 }),
    { code: 'FILE_TOO_LARGE', status: 422 },
  )
  assert.throws(
    () => normalizeAttachmentMetadata({ ...valid, size: MAX_LEGACY_BASE64_ATTACHMENT_BYTES + 1 }, { maxBytes: MAX_LEGACY_BASE64_ATTACHMENT_BYTES }),
    { code: 'FILE_TOO_LARGE', status: 422 },
  )
})

test('decodifica Base64 estrito e confere o tamanho declarado', () => {
  assert.deepEqual(decodeBase64Attachment('YWJj', 3), Buffer.from('abc'))
  assert.throws(() => decodeBase64Attachment('YWJj', 2), { code: 'FILE_SIZE_MISMATCH', status: 422 })
  assert.throws(() => decodeBase64Attachment('not-base64!', 3), { code: 'INVALID_FILE_DATA', status: 422 })
})

test('somente imagens seguras podem ser exibidas inline', () => {
  assert.equal(isInlinePreviewMimeType('image/jpeg'), true)
  assert.equal(isInlinePreviewMimeType('application/pdf'), false)
  assert.equal(isInlinePreviewMimeType('image/heic'), false)
})

test('Drive não configurado falha de forma explícita sem inicializar a API inteira', async () => {
  const drive = createGoogleDriveClient({})
  await assert.rejects(
    () => drive.createResumableUpload({ name: 'nota.pdf', mimeType: 'application/pdf', size: 1, receiptId: 'REC-1' }),
    { code: 'DRIVE_NOT_CONFIGURED', status: 503 },
  )
})
