import { createHash, randomUUID } from 'node:crypto'
import { authFailure } from '../auth/postgresAuth.mjs'
import { MAX_ATTACHMENT_BYTES, RESUMABLE_UPLOAD_CHUNK_BYTES,
  normalizeAttachmentMetadata, safeStorageFileName } from '../attachments.mjs'
import { attachmentResponse, documentCode, findReceipt } from './postgresReceipts.mjs'

const PROVIDER = 'GOOGLE_DRIVE'
const invalid = (message) => authFailure(422, 'INVALID_UPLOAD_FILE', message)

function detectMime(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) return 'image/gif'
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (buffer.subarray(4, 8).toString() === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString()
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
  }
  return null
}

function mimeMatches(detected, declared) {
  return detected === declared || (detected === 'image/heic' && declared === 'image/heif')
}

async function upsertContainer(client, { namespace, key, parentId, receiptId,
  purpose, categoryCode, objectId, actorId, name }) {
  const { rows: [row] } = await client.query(`INSERT INTO alm.storage_containers
    (recebimento_id,parent_id,storage_provider,storage_namespace,logical_key,
      storage_object_id,finalidade,tipo_arquivo_codigo,status,nome_administrativo,
      criado_por,alterado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'DISPONIVEL',$9,$10,$10)
    ON CONFLICT (storage_provider,storage_namespace,logical_key) DO UPDATE SET
      storage_object_id=EXCLUDED.storage_object_id,status='DISPONIVEL',
      alterado_por=EXCLUDED.alterado_por RETURNING id`,
  [receiptId, parentId, PROVIDER, namespace, key, objectId, purpose,
    categoryCode, name, actorId])
  return row.id
}

async function saveContainerTree(client, receipt, categoryCode, folders, actorId) {
  const namespace = folders.root
  const rootId = await upsertContainer(client, { namespace, key: '/', parentId: null,
    receiptId: null, purpose: 'ROOT', categoryCode: null,
    objectId: folders.root, actorId, name: 'ALM Recebimentos' })
  const yearKey = `/${folders.year}`
  const yearId = await upsertContainer(client, { namespace, key: yearKey, parentId: rootId,
    receiptId: null, purpose: 'ANO', categoryCode: null,
    objectId: folders.yearId, actorId, name: folders.year })
  const monthKey = `${yearKey}/${folders.month}`
  const monthId = await upsertContainer(client, { namespace, key: monthKey, parentId: yearId,
    receiptId: null, purpose: 'MES', categoryCode: null,
    objectId: folders.monthId, actorId, name: folders.month })
  const receiptKey = `${monthKey}/${receipt.codigo}`
  const receiptId = await upsertContainer(client, { namespace, key: receiptKey, parentId: monthId,
    receiptId: receipt.id, purpose: 'RECEBIMENTO', categoryCode: null,
    objectId: folders.receiptId, actorId, name: receipt.codigo })
  return upsertContainer(client, { namespace, key: `${receiptKey}/${categoryCode}`,
    parentId: receiptId, receiptId: receipt.id, purpose: 'CATEGORIA', categoryCode,
    objectId: folders.categoryId, actorId, name: categoryCode })
}

export async function startAttachmentUpload(client, drive, receiptId, input, actorId, origin) {
  const receipt = await findReceipt(client, receiptId, { lock: true, full: false })
  if (receipt.status === 'CONFERIDO_FINALIZADO') {
    throw authFailure(409, 'RECEIPT_FINALIZED', 'Reabra o recebimento antes de anexar arquivos.')
  }
  const metadata = normalizeAttachmentMetadata(input)
  const categoryCode = documentCode(metadata.categoria)
  if (!categoryCode) throw authFailure(422, 'INVALID_CATEGORY', 'Categoria do anexo inválida.')
  const folders = await drive.ensureCategoryFolder(receipt.codigo, categoryCode)
  const { rows: [counter] } = await client.query(`SELECT count(*)::int AS total FROM alm.arquivos
    WHERE recebimento_id=$1`, [receipt.id])
  const sequence = String(counter.total + 1).padStart(4, '0')
  const storageName = `${safeStorageFileName(receipt.codigo)}_${sequence}_${safeStorageFileName(metadata.name)}`
  const { sessionUrl } = await drive.createResumableUpload({ ...metadata,
    storageName, receiptId: receipt.id, origin, folderId: folders.categoryId, categoryCode })
  return { upload: { sessionUrl, method: 'PUT', chunkSize: RESUMABLE_UPLOAD_CHUNK_BYTES },
    constraints: { maxBytes: MAX_ATTACHMENT_BYTES, chunkBytes: RESUMABLE_UPLOAD_CHUNK_BYTES } }
}

export async function confirmAttachment(client, drive, receiptId, input, actorId) {
  const receipt = await findReceipt(client, receiptId, { lock: true, full: false })
  if (receipt.status === 'CONFERIDO_FINALIZADO') {
    throw authFailure(409, 'RECEIPT_FINALIZED', 'Reabra o recebimento antes de anexar arquivos.')
  }
  const fileId = typeof input.fileId === 'string' ? input.fileId.trim() : ''
  const categoryCode = documentCode(input.categoria)
  if (!fileId || fileId.length > 200 || !categoryCode) throw invalid('Arquivo ou categoria inválida.')
  const { rows: [linked] } = await client.query(`SELECT id FROM alm.arquivos
    WHERE storage_provider=$1 AND storage_object_id=$2 LIMIT 1`, [PROVIDER, fileId])
  if (linked) throw authFailure(409, 'ATTACHMENT_ALREADY_LINKED', 'Arquivo já confirmado.')
  const folders = await drive.ensureCategoryFolder(receipt.codigo, categoryCode)
  const file = await drive.getUploadedFile(fileId, receipt.id,
    { folderId: folders.categoryId, categoryCode })
  const metadata = normalizeAttachmentMetadata({ name: file.description || file.name,
    mimeType: file.mimeType, size: Number(file.size), categoria: input.categoria })
  const downloaded = await drive.downloadFile(fileId)
  if (downloaded.buffer.length !== metadata.size) throw invalid('Tamanho do arquivo não confere.')
  const detectedMime = detectMime(downloaded.buffer)
  if (!detectedMime || !mimeMatches(detectedMime, metadata.mimeType)) {
    throw invalid('Conteúdo do arquivo não corresponde ao tipo informado.')
  }
  const containerId = await saveContainerTree(client, receipt, categoryCode, folders, actorId)
  const sha256 = createHash('sha256').update(downloaded.buffer).digest('hex')
  const { rows: [row] } = await client.query(`INSERT INTO alm.arquivos
    (recebimento_id,tipo_arquivo_codigo,storage_provider,storage_namespace,
     storage_object_id,storage_container_id,nome_original,nome_storage,
     mime_type_declarado,mime_type_detectado,tamanho_bytes,checksum_sha256,
     idempotency_key,status_upload,integridade_verificada_em,criado_por,alterado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DISPONIVEL',
      clock_timestamp(),$14,$14) RETURNING *`,
  [receipt.id, categoryCode, PROVIDER, folders.root, fileId, containerId,
    metadata.name, file.name, metadata.mimeType, detectedMime, metadata.size,
    sha256, randomUUID(), actorId])
  return attachmentResponse(row)
}

export async function listAttachments(client, receiptId) {
  const receipt = await findReceipt(client, receiptId, { full: true })
  return receipt.anexos
}

export async function attachmentForDownload(client, receiptId, attachmentId) {
  const receipt = await findReceipt(client, receiptId, { full: false })
  const { rows: [row] } = await client.query(`SELECT * FROM alm.arquivos WHERE id=$1
    AND recebimento_id=$2 AND excluido_em IS NULL AND status_upload='DISPONIVEL'`,
  [attachmentId, receipt.id])
  if (!row) throw authFailure(404, 'ATTACHMENT_NOT_FOUND', 'Anexo não encontrado.')
  return row
}

export async function archiveAttachment(client, receiptId, attachmentId, reason, actorId) {
  const receipt = await findReceipt(client, receiptId, { lock: true, full: false })
  if (receipt.status === 'CONFERIDO_FINALIZADO') {
    throw authFailure(409, 'RECEIPT_FINALIZED', 'Reabra o recebimento antes de remover anexos.')
  }
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 2000) : ''
  if (!cleanReason) throw authFailure(422, 'VALIDATION_ERROR', 'Informe o motivo da remoção.')
  const { rows: [row] } = await client.query(`UPDATE alm.arquivos SET
    excluido_em=clock_timestamp(),excluido_por=$3,motivo_exclusao=$4,alterado_por=$3
    WHERE id=$1 AND recebimento_id=$2 AND excluido_em IS NULL RETURNING *`,
  [attachmentId, receipt.id, actorId, cleanReason])
  if (!row) throw authFailure(404, 'ATTACHMENT_NOT_FOUND', 'Anexo não encontrado.')
  return row
}
