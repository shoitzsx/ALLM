import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createPostgresPool } from './config/postgres.mjs'
import { withApiTransaction } from './auth/postgresAuth.mjs'
import {
  createReceipt, createDivergence, changeDivergence, findReceipt,
  transitionReceipt, archiveReceipt, restoreReceipt, updateReceipt,
  updateItem, removeItem,
} from './services/postgresReceipts.mjs'
import { startAttachmentUpload, confirmAttachment, archiveAttachment } from './services/postgresAttachments.mjs'
import { listVisualization, exportVisualization } from './services/postgresVisualization.mjs'

const disposable = process.env.ALM_DB_HOST === '127.0.0.1'
  && process.env.ALM_DB_NAME === 'alm_ci_clean'
  && process.env.ALM_DB_TEST_DISPOSABLE === 'YES'

test('PostgreSQL receipt, item, divergence, attachment and visualization flow',
  { skip: !disposable }, async () => {
    const pool = createPostgresPool()
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16)])
    const fileId = `file-${randomUUID()}`
    const folders = { root: 'root-test', year: '2026', month: '10',
      yearId: 'year-test', monthId: 'month-test' }
    const drive = {
      ensureCategoryFolder: async (receiptCode, categoryCode) => ({ ...folders,
        receiptId: receiptCode, categoryId: `${receiptCode}-${categoryCode}` }),
      createResumableUpload: async () => ({ sessionUrl: 'https://example.test/upload' }),
      getUploadedFile: async () => ({ id: fileId, name: 'test.png', description: 'test.png',
        mimeType: 'image/png', size: String(png.length) }),
      downloadFile: async () => ({ buffer: png, mimeType: 'image/png', name: 'test.png' }),
    }
    const tx = (actor, action) => withApiTransaction(pool, actor, randomUUID(), action)
    try {
      const userId = await tx(null, async (client) => {
        const matricula = `T${Date.now()}`.slice(0, 20)
        const { rows: [user] } = await client.query(`INSERT INTO alm.usuarios
          (matricula,nome,perfil) VALUES($1,'Teste operação','ALMOXARIFADO') RETURNING id`, [matricula])
        return user.id
      })
      const receipt = await tx(userId, (client) => createReceipt(client, {
        pedido: 'PC-TESTE', numeroNf: '123', fornecedor: 'Fornecedor Teste',
        tipo: 'Estoque', itens: [{ numero: 10, descricao: 'Item teste',
          quantidadeSolicitada: 2, quantidadeRecebida: 2, unidade: 'UN' }],
      }, userId))
      assert.match(receipt.protocolo, /^REC-\d{4}-\d{6}$/)
      assert.equal(receipt.itens.length, 1)
      assert.equal(receipt.status, 'Em digitação')

      const item = await tx(userId, (client) => updateItem(client, receipt.id,
        receipt.itens[0].id, { quantidadeRecebida: 3 }, userId))
      assert.equal(item.quantidadeRecebida, 3)
      const updated = await tx(userId, (client) => updateReceipt(client, receipt.id,
        { observacoes: 'Conferência em andamento' }, userId))
      assert.equal(updated.observacoes, 'Conferência em andamento')
      await tx(userId, (client) => transitionReceipt(client, receipt.id,
        { status: 'Em conferência' }, userId, 'ALMOXARIFADO'))
      const divergence = await tx(userId, (client) => createDivergence(client, receipt.id,
        { tipo: 'Quantidade incorreta', descricao: 'Uma unidade extra', itemId: item.id }, userId))
      assert.equal(divergence.resolvida, false)
      const afterDivergence = await tx(userId, (client) => findReceipt(client, receipt.id))
      assert.equal(afterDivergence.status, 'DIVERGENCIA_IDENTIFICADA')
      await tx(userId, (client) => changeDivergence(client, receipt.id, divergence.id,
        'resolver', { resolucao: 'Quantidade aceita após conferência' }, userId))

      const session = await tx(userId, (client) => startAttachmentUpload(client, drive,
        receipt.id, { name: 'test.png', mimeType: 'image/png', size: png.length,
          categoria: 'Nota Fiscal' }, userId, 'http://localhost:5173'))
      assert.equal(session.upload.method, 'PUT')
      const attachment = await tx(userId, (client) => confirmAttachment(client, drive,
        receipt.id, { fileId, categoria: 'Nota Fiscal' }, userId))
      assert.equal(attachment.nome, 'test.png')
      assert.ok(attachment.url.endsWith(`/anexos/${attachment.id}/download`))
      await assert.rejects(tx(userId, (client) => confirmAttachment(client, drive,
        receipt.id, { fileId, categoria: 'Nota Fiscal' }, userId)),
      { status: 409, code: 'ATTACHMENT_ALREADY_LINKED' })

      await tx(userId, (client) => transitionReceipt(client, receipt.id,
        { status: 'Em conferência' }, userId, 'ALMOXARIFADO'))
      const finalized = await tx(userId, (client) => transitionReceipt(client, receipt.id,
        { status: 'Conferido/Finalizado' }, userId, 'ALMOXARIFADO'))
      assert.equal(finalized.statusCodigo, 'CONFERIDO_FINALIZADO')
      await assert.rejects(tx(userId, (client) => removeItem(client,
        receipt.id, item.id, userId)), { status: 409 })
      await tx(userId, (client) => transitionReceipt(client, receipt.id,
        { status: 'Em conferência' }, userId, 'ALMOXARIFADO'))

      for (const tab of ['chegadas', 'recebimentos', 'itens', 'divergencias',
        'historico', 'auditoria', 'anexos', 'usuarios']) {
        const result = await tx(userId, (client) => listVisualization(client,
          tab, new URLSearchParams({ page: '1', pageSize: '25' })))
        assert.ok(Array.isArray(result.data), tab)
      }
      const csv = await tx(userId, (client) => exportVisualization(client,
        'recebimentos', new URLSearchParams({ search: receipt.protocolo })))
      assert.match(csv, /Protocolo/)
      assert.match(csv, new RegExp(receipt.protocolo))

      const removed = await tx(userId, (client) => archiveAttachment(client,
        receipt.id, attachment.id, 'Documento substituído', userId))
      assert.ok(removed.excluido_em)
      await assert.rejects(tx(userId, (client) => transitionReceipt(client, receipt.id,
        { status: 'Conferido/Finalizado' }, userId, 'ALMOXARIFADO')))
      const archived = await tx(userId, (client) => archiveReceipt(client,
        receipt.id, 'Fim do teste', userId))
      assert.equal(archived.arquivado, true)
      const restored = await tx(userId, (client) => restoreReceipt(client, receipt.id, userId))
      assert.equal(restored.arquivado, false)
    } finally { await pool.end() }
  })
