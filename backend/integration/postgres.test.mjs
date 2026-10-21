import { randomInt, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPostgresPool, readPostgresConfig } from '../config/postgres.mjs'
import { iniciarRecebimentoDaChegada } from '../services/iniciarRecebimentoDaChegada.mjs'

const requiredNames = ['ALM_DB_HOST', 'ALM_DB_NAME', 'ALM_DB_API_USER', 'ALM_DB_API_PASSWORD']
const configured = requiredNames.every((name) => Boolean(process.env[name]?.trim()))
const disposable = configured
  && ['localhost', '127.0.0.1', '::1'].includes(process.env.ALM_DB_HOST)
  && process.env.ALM_DB_NAME === 'alm_ci_clean'
  && process.env.ALM_DB_TEST_DISPOSABLE === 'YES'

test('PostgreSQL configuration verifies remote TLS and limits plaintext to loopback', () => {
  const base = {
    ALM_DB_HOST: 'db.example.test', ALM_DB_NAME: 'postgres',
    ALM_DB_API_USER: 'alm_runtime_api', ALM_DB_API_PASSWORD: 'local-secret',
  }
  const remote = readPostgresConfig(base)
  assert.equal(remote.ssl.rejectUnauthorized, true)
  assert.equal(remote.max, 3)
  assert.throws(() => readPostgresConfig({ ...base, ALM_DB_SSL_MODE: 'disable' }), /loopback/)
  assert.equal(readPostgresConfig({ ...base, ALM_DB_HOST: '127.0.0.1', ALM_DB_SSL_MODE: 'disable' }).ssl, false)
  assert.throws(() => readPostgresConfig({ ...base, ALM_DB_API_USER: 'postgres' }), /alm_runtime_api/)
})

test('alm_runtime_api can assume alm_api with expected grants', { skip: !configured }, async () => {
  const pool = createPostgresPool()
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE alm_api')
    const { rows: [identity] } = await client.query(`
      SELECT session_user, current_user,
             has_table_privilege(current_user, 'alm.chegadas_portaria', 'SELECT') AS can_read_chg,
             has_table_privilege(current_user, 'alm.recebimentos', 'UPDATE') AS can_update_rec,
             has_table_privilege(current_user, 'alm.tipos_recebimento', 'SELECT') AS can_read_types,
             has_table_privilege(current_user, 'alm.fornecedores', 'SELECT') AS can_read_suppliers,
             has_function_privilege(current_user, 'alm.criar_recebimento_da_chegada(uuid)', 'EXECUTE') AS can_convert
    `)
    assert.equal(identity.current_user, 'alm_api')
    assert.equal(identity.session_user, 'alm_runtime_api')
    assert.equal(identity.can_read_chg, true)
    assert.equal(identity.can_update_rec, true)
    assert.equal(identity.can_read_types, true)
    assert.equal(identity.can_read_suppliers, true)
    assert.equal(identity.can_convert, true)
  } finally {
    if (client) {
      let discardConnection = false
      try { await client.query('ROLLBACK') } catch { discardConnection = true }
      client.release(discardConnection)
    }
    await pool.end()
  }
})

async function transaction(pool, actor, action) {
  const client = await pool.connect()
  let discardConnection = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE alm_api')
    await client.query("SELECT set_config('app.usuario_id', $1, true), set_config('app.ator_sistema', $2, true), set_config('app.request_id', $3, true)",
      [actor || '', actor ? '' : 'CHG_REC_INTEGRATION_TEST', randomUUID()])
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { discardConnection = true }
    throw error
  } finally {
    client.release(discardConnection)
  }
}

async function createFixture(pool) {
  const userId = await transaction(pool, null, async (client) => {
    const matricula = `T${randomInt(0, 1e12).toString().padStart(12, '0')}`
    const result = await client.query(`
      INSERT INTO alm.usuarios (matricula, nome, perfil)
      VALUES ($1, 'Teste CHG REC', 'ALMOXARIFADO') RETURNING id
    `, [matricula])
    return result.rows[0].id
  })
  const cnpj = makeValidCnpj()
  let otherCnpj = makeValidCnpj()
  while (otherCnpj === cnpj) otherCnpj = makeValidCnpj()
  const suppliers = await transaction(pool, userId, async (client) => {
    const rows = []
    for (const [value, name] of [[cnpj, 'Fornecedor A Teste'], [otherCnpj, 'Fornecedor B Teste']]) {
      const { rows: [supplier] } = await client.query(`
        INSERT INTO alm.fornecedores (cnpj, razao_social, criado_por, alterado_por)
        VALUES ($1, $2, $3::uuid, $3::uuid) RETURNING id
      `, [value, name, userId])
      rows.push(supplier.id)
    }
    return rows
  })
  return { userId, cnpj, otherCnpj, supplierA: suppliers[0], supplierB: suppliers[1] }
}

function makeValidCnpj() {
  const digits = Array.from({ length: 12 }, () => randomInt(0, 10))
  if (new Set(digits).size === 1) digits[0] = (digits[0] + 1) % 10
  const check = (weights, source) => {
    const sum = weights.reduce((total, weight, index) => total + weight * source[index], 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  digits.push(check([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], digits))
  digits.push(check([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], digits))
  return digits.join('')
}

async function createArrival(pool, fixture, { mismatchedCnpj = false, supplierSnapshot = 'Fornecedor A Teste' } = {}) {
  return transaction(pool, fixture.userId, async (client) => {
    const { rows: [arrival] } = await client.query(`
      INSERT INTO alm.chegadas_portaria (
        numero_nf, cnpj_emitente, fornecedor_id, fornecedor_nome_snapshot,
        metodo_leitura, criado_por, alterado_por
      ) VALUES ($1, $2, $3::uuid, $4, 'MANUAL', $5::uuid, $5::uuid)
      RETURNING id
    `, [String(randomInt(10000, 99999)), mismatchedCnpj ? fixture.otherCnpj : fixture.cnpj,
      fixture.supplierA, supplierSnapshot, fixture.userId])
    return arrival.id
  })
}

test('real PostgreSQL CHG to REC transaction, rollback, retry and concurrency', { skip: !disposable }, async () => {
  const pool = createPostgresPool()
  try {
    const fixture = await createFixture(pool)
    const actor = { id: fixture.userId, perfil: 'ALMOXARIFADO', ativo: true }
    const input = { pedido: 'PC-TESTE', tipo: 'Estoque', fornecedor: 'Fornecedor A Teste' }

    const arrivalId = await createArrival(pool, fixture)
    const created = await iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input })
    assert.equal(created.reutilizado, false)
    assert.match(created.codigo, /^REC-\d{4}-\d{6}$/)
    const retry = await iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input })
    assert.deepEqual(retry, { ...created, reutilizado: true })
    await assert.rejects(
      iniciarRecebimentoDaChegada({ pool, actor, chegadaId: arrivalId, input: { ...input, fornecedor: 'Outro fornecedor' } }),
      { status: 409, code: 'ARRIVAL_RETRY_CONFLICT' },
    )

    const snapshotArrivalId = await createArrival(pool, fixture, { supplierSnapshot: 'Nome capturado na chegada' })
    const snapshotInput = { ...input, fornecedor: 'Nome capturado na chegada' }
    const snapshotCreated = await iniciarRecebimentoDaChegada({ pool, actor, chegadaId: snapshotArrivalId, input: snapshotInput })
    const snapshotRetry = await iniciarRecebimentoDaChegada({ pool, actor, chegadaId: snapshotArrivalId, input: snapshotInput })
    assert.equal(snapshotCreated.reutilizado, false)
    assert.equal(snapshotRetry.recebimentoId, snapshotCreated.recebimentoId)
    assert.equal(snapshotRetry.reutilizado, true)

    const rollbackArrivalId = await createArrival(pool, fixture, { mismatchedCnpj: true })
    await assert.rejects(
      iniciarRecebimentoDaChegada({ pool, actor, chegadaId: rollbackArrivalId, input }),
      { status: 409, code: 'ARRIVAL_INVALID_DATA' },
    )
    const rollbackState = await transaction(pool, fixture.userId, async (client) => {
      const { rows: [state] } = await client.query(`
        SELECT c.status, c.recebimento_id,
               (SELECT count(*)::integer FROM alm.recebimentos r
                 WHERE r.dados_origem->>'chegada_portaria_id' = c.id::text) AS receipt_count
          FROM alm.chegadas_portaria c WHERE c.id = $1::uuid
      `, [rollbackArrivalId])
      return state
    })
    assert.equal(rollbackState.status, 'REGISTRADA')
    assert.equal(rollbackState.recebimento_id, null)
    assert.equal(rollbackState.receipt_count, 0)

    const concurrentArrivalId = await createArrival(pool, fixture)
    const [first, second] = await Promise.all([
      iniciarRecebimentoDaChegada({ pool, actor, chegadaId: concurrentArrivalId, input }),
      iniciarRecebimentoDaChegada({ pool, actor, chegadaId: concurrentArrivalId, input }),
    ])
    assert.equal(first.recebimentoId, second.recebimentoId)
    assert.deepEqual([first.reutilizado, second.reutilizado].sort(), [false, true])
  } finally {
    await pool.end()
  }
})
