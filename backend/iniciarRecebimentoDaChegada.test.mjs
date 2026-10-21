import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciarRecebimentoDaChegada } from './services/iniciarRecebimentoDaChegada.mjs'

const actorId = '2bde5d04-6f7e-49e0-a8ab-47ad701e9216'
const arrivalId = '8a4413fd-57cb-4e23-b2db-c99082a3aa89'
const receiptId = '0a93a45e-cc8a-4cc7-899c-5acb07637e8a'
const supplierId = 'f39538f9-6a7d-4226-8b49-f41dc487a9de'
const actor = { id: actorId, perfil: 'ALMOXARIFADO', ativo: true }
const input = { pedido: 'PC-123', tipo: 'Estoque', fornecedor: 'Empresa ABC' }

function fakePool({ updateFailure = false } = {}) {
  const state = {
    arrival: {
      id: arrivalId, status: 'REGISTRADA', recebimento_id: null, excluido_em: null,
      nfe_chave_acesso: null, numero_nf: '39804', serie_nf: '2',
      cnpj_emitente: '04994734000518', fornecedor_id: supplierId,
      fornecedor_nome_snapshot: 'Empresa ABC',
    },
    receipt: null,
  }
  const commands = []
  let snapshot
  let releases = 0
  const client = {
    async query(sql, values = []) {
      const statement = sql.replace(/\s+/g, ' ').trim()
      commands.push({ statement, values })
      if (statement === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] } }
      if (statement === 'ROLLBACK') { state.arrival = snapshot.arrival; state.receipt = snapshot.receipt; return { rows: [] } }
      if (statement === 'COMMIT' || statement === 'SET LOCAL ROLE alm_api' || statement.startsWith('SELECT set_config(')) return { rows: [] }
      if (statement.includes('FROM alm.chegadas_portaria WHERE id')) return { rows: [structuredClone(state.arrival)] }
      if (statement.includes('FROM alm.tipos_recebimento WHERE codigo')) return { rows: values[0] === 'ESTOQUE' ? [{ id: 1 }] : [] }
      if (statement.includes('FROM alm.fornecedores') && statement.includes('AND id')) return { rows: values[0] === supplierId ? [{ id: supplierId }] : [] }
      if (statement.includes('FROM alm.fornecedores') && statement.includes('AND cnpj')) return { rows: [] }
      if (statement.includes('alm.criar_recebimento_da_chegada(')) {
        if (state.arrival.recebimento_id) return { rows: [{ recebimento_id: receiptId, codigo: state.receipt.codigo, reutilizado: true }] }
        state.arrival.status = 'VINCULADA'
        state.arrival.recebimento_id = receiptId
        state.receipt = { id: receiptId, codigo: 'REC-2026-000001', pedido_compra: null, tipo_codigo: null, fornecedor_nome_snapshot: 'Empresa ABC', razao_social: 'Empresa ABC' }
        return { rows: [{ recebimento_id: receiptId, codigo: state.receipt.codigo, reutilizado: false }] }
      }
      if (statement.startsWith('UPDATE alm.recebimentos')) {
        if (updateFailure) throw Object.assign(new Error('internal database detail'), { code: '23514' })
        state.receipt.pedido_compra = values[0]
        state.receipt.tipo_codigo = 'ESTOQUE'
        return { rows: [{ id: receiptId }], rowCount: 1 }
      }
      if (statement.includes('FROM alm.recebimentos r')) return { rows: state.receipt ? [structuredClone(state.receipt)] : [] }
      throw new Error(`Unexpected SQL: ${statement}`)
    },
    release() { releases++ },
  }
  return { state, commands, get releases() { return releases }, async connect() { return client } }
}

test('creates and completes a linked receipt in one transaction with a server actor', async () => {
  const pool = fakePool()
  const result = await iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input })
  assert.deepEqual(result, { recebimentoId: receiptId, codigo: 'REC-2026-000001', reutilizado: false })
  assert.equal(pool.state.arrival.recebimento_id, receiptId)
  assert.equal(pool.state.receipt.pedido_compra, 'PC-123')
  assert.equal(pool.commands.at(-1).statement, 'COMMIT')
  assert.deepEqual(pool.commands.find(({ statement }) => statement.startsWith('SELECT set_config(')).values[0], actorId)
  assert.equal(pool.releases, 1)
})

test('rolls back both REC creation and CHG linkage if completion fails', async () => {
  const pool = fakePool({ updateFailure: true })
  await assert.rejects(
    iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input }),
    (error) => error.status === 422 && error.code === 'VALIDATION_ERROR' && !error.message.includes('internal database detail'),
  )
  assert.equal(pool.state.arrival.status, 'REGISTRADA')
  assert.equal(pool.state.arrival.recebimento_id, null)
  assert.equal(pool.state.receipt, null)
  assert.equal(pool.commands.at(-1).statement, 'ROLLBACK')
  assert.equal(pool.releases, 1)
})

test('a matching retry returns the same REC without updating it', async () => {
  const pool = fakePool()
  await iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input })
  const updates = pool.commands.filter(({ statement }) => statement.startsWith('UPDATE alm.recebimentos')).length
  const retry = await iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input })
  assert.deepEqual(retry, { recebimentoId: receiptId, codigo: 'REC-2026-000001', reutilizado: true })
  assert.equal(pool.commands.filter(({ statement }) => statement.startsWith('UPDATE alm.recebimentos')).length, updates)
})

test('a divergent retry is a conflict and preserves the first receipt', async () => {
  const pool = fakePool()
  await iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input })
  await assert.rejects(
    iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input: { ...input, pedido: 'PC-999' } }),
    (error) => error.status === 409 && error.code === 'ARRIVAL_RETRY_CONFLICT',
  )
  assert.equal(pool.state.receipt.pedido_compra, 'PC-123')
  assert.equal(pool.state.arrival.recebimento_id, receiptId)
  assert.equal(pool.commands.at(-1).statement, 'ROLLBACK')
})

test('missing, inactive, and unauthorized actors never acquire a database connection', async () => {
  const pool = { async connect() { throw new Error('should not connect') } }
  for (const invalid of [null, { ...actor, ativo: false }]) {
    await assert.rejects(iniciarRecebimentoDaChegada({ pool, actor: invalid, chegadaId: arrivalId, input }), { status: 401 })
  }
  for (const perfil of ['CONSULTA', 'PORTARIA', 'SUPRIMENTOS']) {
    await assert.rejects(iniciarRecebimentoDaChegada({ pool, actor: { ...actor, perfil }, chegadaId: arrivalId, input }), { status: 403 })
  }
})

test('rejects client-owned actor and receipt fields before the database function', async () => {
  const pool = fakePool()
  await assert.rejects(
    iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input: { ...input, usuarioId: actorId } }),
    (error) => error.status === 422 && error.code === 'VALIDATION_ERROR',
  )
  assert.equal(pool.commands.some(({ statement }) => statement.includes('alm.criar_recebimento_da_chegada(')), false)
  assert.equal(pool.commands.at(-1).statement, 'ROLLBACK')
})
