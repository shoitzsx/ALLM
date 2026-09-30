import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_ATTACHMENT_BYTES, MAX_LEGACY_BASE64_ATTACHMENT_BYTES, decodeBase64Attachment, isInlinePreviewMimeType, normalizeAttachmentMetadata } from './attachments.mjs'
import { createGoogleDriveClient, isOriginAllowed, buildResumableUploadHeaders } from './integrations/googleDrive.mjs'
import { parseSheetValues, REQUEST_OPTIONS } from './integrations/googleSheets.mjs'
import { createRecebimentosRepository } from './repositories/recebimentosRepository.mjs'
import { attachmentResponse, persistOrCleanupDrive } from './app.mjs'

const valid = { name: 'nota-fiscal.pdf', mimeType: 'application/pdf', size: 3, categoria: 'Nota Fiscal' }

// Sheets falso em memória — sem rede real, só pra verificar quais sheets
// cada operação toca e com quais argumentos.
function createFakeSheets(initialData = {}) {
  const store = new Map(Object.entries(initialData).map(([name, rows]) => [name, rows.map((data, i) => ({ rowNumber: i + 2, data: { ...data } }))]))
  const calls = []
  const sheet = (name) => { if (!store.has(name)) store.set(name, []); return store.get(name) }
  return {
    calls,
    getRows: (name) => sheet(name).map((row) => ({ ...row, data: { ...row.data } })),
    async readRows(name) { calls.push(['readRows', name]); return sheet(name).map((row) => ({ rowNumber: row.rowNumber, data: { ...row.data } })) },
    async readManyRows(names) { calls.push(['readManyRows', names]); return names.map((name) => sheet(name).map((row) => ({ rowNumber: row.rowNumber, data: { ...row.data } }))) },
    async appendRow(name, data) { calls.push(['appendRow', name]); const rows = sheet(name); const rowNumber = rows.length ? Math.max(...rows.map((r) => r.rowNumber)) + 1 : 2; rows.push({ rowNumber, data: { ...data } }) },
    async updateRow(name, rowNumber, data) { calls.push(['updateRow', name]); const rows = sheet(name); const index = rows.findIndex((r) => r.rowNumber === rowNumber); if (index >= 0) rows[index] = { rowNumber, data: { ...data } }; else rows.push({ rowNumber, data: { ...data } }) },
    async deleteRows(name, rowNumbers) { calls.push(['deleteRows', name]); store.set(name, sheet(name).filter((r) => !rowNumbers.includes(r.rowNumber))) },
  }
}

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

// O upload resumível só ganha CORS do Google para a Origin presente já na
// criação da sessão — por isso o backend precisa validar antes de repassar.
const allowlist = ['http://localhost:5173', 'https://allm.vercel.app']

test('permite origem de desenvolvimento presente na allowlist', () => {
  assert.equal(isOriginAllowed('http://localhost:5173', allowlist), true)
})

test('permite origem de produção presente na allowlist', () => {
  assert.equal(isOriginAllowed('https://allm.vercel.app', allowlist), true)
})

test('rejeita origem fora da allowlist', () => {
  assert.equal(isOriginAllowed('https://evil.example.com', allowlist), false)
})

test('rejeita origem ausente — este endpoint só existe para gerar sessão destinada ao navegador', () => {
  assert.equal(isOriginAllowed('', allowlist), false)
  assert.equal(isOriginAllowed(undefined, allowlist), false)
})

test('não faz correspondência por substring/prefixo — só igualdade exata', () => {
  assert.equal(isOriginAllowed('http://localhost:5173.evil.com', allowlist), false)
  assert.equal(isOriginAllowed('http://evil-http://localhost:5173', allowlist), false)
})

test('a sessão resumível envia a Origin já validada no header da requisição ao Google', () => {
  const headers = buildResumableUploadHeaders({ accessToken: 'token-x', mimeType: 'application/pdf', size: 10, origin: 'http://localhost:5173' })
  assert.equal(headers.Origin, 'http://localhost:5173')
  assert.equal(headers.Authorization, 'Bearer token-x')
})

test('não inclui header Origin quando nenhuma origem validada foi repassada', () => {
  const headers = buildResumableUploadHeaders({ accessToken: 'token-x', mimeType: 'application/pdf', size: 10 })
  assert.equal('Origin' in headers, false)
})

// FASE 1 da redução de leituras da Sheets API: batchGet + persistência
// dedicada de anexo (sem passar por replaceChildren completo).

test('parseSheetValues transforma values em {rowNumber, data}, pulando linhas em branco', () => {
  const values = [
    ['id', 'nome'],
    ['1', 'a'],
    ['', ''],
    ['2', 'b'],
  ]
  // rowNumber é calculado sobre a lista já filtrada (comportamento herdado
  // do readRows original) — a linha em branco não conta pro índice de 'b'.
  assert.deepEqual(parseSheetValues(values), [
    { rowNumber: 2, data: { id: '1', nome: 'a' } },
    { rowNumber: 3, data: { id: '2', nome: 'b' } },
  ])
})

test('parseSheetValues com values ausente/vazio devolve lista vazia', () => {
  assert.deepEqual(parseSheetValues(undefined), [])
  assert.deepEqual(parseSheetValues([]), [])
})

test('listRecebimentos usa 1 chamada readManyRows em vez de 6 readRows separadas', async () => {
  const sheets = createFakeSheets({
    Recebimentos: [{ id: 'REC-1', protocolo: 'REC-1', pedido: 'P', fornecedor: 'F', status: 'Em digitação', responsavel: '{}' }],
    Anexos: [{ id: 'ANX-1', recebimentoId: 'REC-1', nome: 'a.pdf', categoria: 'Outro', removido: 'false', incluidoPor: '{}', removidoPor: '{}' }],
  })
  const repository = createRecebimentosRepository({ sheets, defaultUsers: [] })

  const list = await repository.listRecebimentos()

  assert.equal(sheets.calls.filter(([op]) => op === 'readManyRows').length, 1)
  assert.equal(sheets.calls.some(([op]) => op === 'readRows'), false)
  assert.equal(list.length, 1)
  assert.equal(list[0].anexos.length, 1)
  assert.equal(list[0].anexos[0].id, 'ANX-1')
})

test('addAttachmentRow toca somente Recebimentos, Anexos e Auditoria', async () => {
  const sheets = createFakeSheets({ Recebimentos: [{ id: 'REC-1', protocolo: 'REC-1' }] })
  const repository = createRecebimentosRepository({ sheets, defaultUsers: [] })
  const receipt = {
    id: 'REC-1',
    anexos: [{ id: 'ANX-1', nome: 'a.pdf', categoria: 'Outro', incluidoPor: { id: 'U1' }, removidoPor: null }],
    historicoAlteracoes: [{ id: 'AUD-1', data: '2026-01-01', usuario: { id: 'U1' }, acao: 'Arquivo incluído', detalhes: 'a.pdf' }],
  }

  const returned = await repository.addAttachmentRow(receipt)

  const sheetsTouched = new Set(sheets.calls.map(([, name]) => name))
  assert.deepEqual([...sheetsTouched].sort(), ['Anexos', 'Auditoria', 'Recebimentos'])
  assert.equal(returned.id, 'ANX-1')
  assert.equal(sheets.getRows('Anexos').length, 1)
  assert.equal(sheets.getRows('Auditoria').length, 1)
})

test('addAttachmentRow NÃO toca Itens, Divergencias ou HistoricoStatus', async () => {
  const sheets = createFakeSheets({ Recebimentos: [{ id: 'REC-1', protocolo: 'REC-1' }] })
  const repository = createRecebimentosRepository({ sheets, defaultUsers: [] })
  const receipt = {
    id: 'REC-1',
    anexos: [{ id: 'ANX-1', nome: 'a.pdf', categoria: 'Outro', incluidoPor: { id: 'U1' }, removidoPor: null }],
    historicoAlteracoes: [{ id: 'AUD-1', data: '2026-01-01', usuario: { id: 'U1' }, acao: 'Arquivo incluído', detalhes: 'a.pdf' }],
  }

  await repository.addAttachmentRow(receipt)

  const touched = new Set(sheets.calls.map(([, name]) => name))
  assert.equal(touched.has('Itens'), false)
  assert.equal(touched.has('Divergencias'), false)
  assert.equal(touched.has('HistoricoStatus'), false)
  assert.equal(sheets.calls.some(([op]) => op === 'deleteRows'), false)
})

test('removeAttachmentRow atualiza a linha existente em Anexos, sem apagar/reescrever a sheet', async () => {
  const sheets = createFakeSheets({
    Recebimentos: [{ id: 'REC-1', protocolo: 'REC-1' }],
    Anexos: [{ id: 'ANX-1', recebimentoId: 'REC-1', nome: 'a.pdf', removido: 'false' }],
  })
  const repository = createRecebimentosRepository({ sheets, defaultUsers: [] })
  const receipt = { id: 'REC-1', historicoAlteracoes: [{ id: 'AUD-2', data: '2026-01-02', usuario: { id: 'U1' }, acao: 'Arquivo removido', detalhes: 'a.pdf' }] }
  const attachment = { id: 'ANX-1', nome: 'a.pdf', removido: true, removidoEm: '2026-01-02', removidoPor: { id: 'U1' }, motivoRemocao: 'teste', _rowNumber: 2 }

  await repository.removeAttachmentRow(receipt, attachment)

  const ops = sheets.calls.map(([op, name]) => `${op}:${name}`).sort()
  assert.deepEqual(ops, ['appendRow:Auditoria', 'readRows:Recebimentos', 'updateRow:Anexos', 'updateRow:Recebimentos'])
  assert.equal(sheets.getRows('Anexos').length, 1)
  assert.equal(sheets.getRows('Anexos')[0].data.removido, true)
})

test('attachmentResponse nunca expõe storageKey nem o rowNumber interno', () => {
  const attachment = { id: 'ANX-1', nome: 'a.pdf', categoria: 'Outro', storageKey: 'drive-file-id-xyz', _rowNumber: 7 }
  const response = attachmentResponse(attachment)
  assert.equal('storageKey' in response, false)
  assert.equal('_rowNumber' in response, false)
  assert.equal(response.id, 'ANX-1')
})

test('falha na persistência aciona a limpeza do Drive', async () => {
  let cleanupCalled = false
  await assert.rejects(
    () => persistOrCleanupDrive({
      persist: async () => { throw new Error('sheets falhou') },
      cleanup: async () => { cleanupCalled = true },
    }),
    { message: 'sheets falhou' },
  )
  assert.equal(cleanupCalled, true)
})

test('falha na limpeza do Drive aciona o callback sanitizado e preserva o erro original', async () => {
  let flagged = false
  await assert.rejects(
    () => persistOrCleanupDrive({
      persist: async () => { throw new Error('sheets falhou') },
      cleanup: async () => { throw new Error('drive delete falhou') },
      onCleanupFailed: () => { flagged = true },
    }),
    { message: 'sheets falhou' },
  )
  assert.equal(flagged, true)
})

test('sucesso na persistência nunca aciona a limpeza do Drive', async () => {
  let cleanupCalled = false
  const result = await persistOrCleanupDrive({
    persist: async () => 'ok',
    cleanup: async () => { cleanupCalled = true },
  })
  assert.equal(result, 'ok')
  assert.equal(cleanupCalled, false)
})

// Uma chamada à Sheets API sem timeout/teto de retry pode ficar pendurada
// por tempo indefinido (já aconteceu de verdade nesta sessão) — aqui só
// confirmamos que os limites configurados são finitos, não o comportamento
// de rede real (isso exigiria simular um servidor lento, fora do escopo dos
// testes deste projeto).
test('chamadas à Sheets API têm timeout configurado, não indefinido', () => {
  assert.equal(typeof REQUEST_OPTIONS.timeout, 'number')
  assert.ok(REQUEST_OPTIONS.timeout > 0)
  assert.ok(REQUEST_OPTIONS.timeout <= 30000)
})

test('retry da Sheets API tem teto de tempo total e de atraso máximo, não Number.MAX_SAFE_INTEGER', () => {
  assert.ok(REQUEST_OPTIONS.retryConfig.totalTimeout < Number.MAX_SAFE_INTEGER)
  assert.ok(REQUEST_OPTIONS.retryConfig.maxRetryDelay < Number.MAX_SAFE_INTEGER)
  assert.ok(REQUEST_OPTIONS.retryConfig.totalTimeout > 0)
  assert.ok(REQUEST_OPTIONS.retryConfig.maxRetryDelay > 0)
  assert.ok(Number.isFinite(REQUEST_OPTIONS.retryConfig.retry))
})
