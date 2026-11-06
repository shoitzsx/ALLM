// Execute somente em alm_ci_clean local descartavel, apos apply-clean.mjs.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { hashPin } from '../../backend/auth/pin.mjs'
import { createOpaqueToken, hashOpaqueToken } from '../../backend/auth/webauthnSecurity.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(here, '../../backend/package.json'))
const { Client } = require('pg')
const raw = process.env.ALM_LOCAL_DATABASE_URL
if (!raw) throw new Error('ALM_LOCAL_DATABASE_URL obrigatoria')
const url = new URL(raw)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  || url.pathname !== '/alm_ci_clean') throw new Error('Apenas banco local descartavel alm_ci_clean')
const client = new Client({ connectionString: url.href })
const pepper1 = 'local-disposable-pepper-v1-0123456789abcdef'
const pepper2 = 'local-disposable-pepper-v2-fedcba9876543210'
const requestId = randomUUID()
const incident = 'INC-LOCAL-RECOVERY-TEST'
const operator = 'test-operator'
let userId

try {
  await client.connect()
  const originalHash = await hashPin('12345678', pepper1)
  const originalCodeHash = hashOpaqueToken(createOpaqueToken())
  await client.query('BEGIN')
  await client.query('SET LOCAL ROLE alm_provisioner')
  const { rows: [seed] } = await client.query(
    'SELECT alm.provisionar_primeiro_administrador($1,$2,$3,$4,$5,$6,$7) AS id',
    ['MKADM001', 'Teste Local', originalHash, originalCodeHash,
      'TEST-LOCAL', randomUUID(), new Date(Date.now() + 86400000)])
  userId = seed.id
  await client.query('COMMIT')
  await client.query('BEGIN')
  await client.query("SELECT set_config('app.ator_sistema','test:recovery',true),set_config('app.request_id',$1,true)", [randomUUID()])
  await client.query(`INSERT INTO alm.sessoes
    (usuario_id,token_hash,ocioso_max_segundos,expira_em)
    VALUES($1,$2,900,clock_timestamp()+interval '1 hour')`, [userId, randomBytes(32)])
  const { rows: [credential] } = await client.query(`INSERT INTO alm.credenciais_webauthn
    (usuario_id,credential_id,chave_publica_cose,algoritmo_cose,backup_eligible,
     backup_state,metodo_cadastro)
    VALUES($1,$2,$3,-7,false,false,'ATIVACAO') RETURNING id`,
  [userId, randomBytes(32), randomBytes(64)])
  await client.query(`INSERT INTO alm.sessoes
    (usuario_id,token_hash,ocioso_max_segundos,expira_em,mfa_metodo,mfa_verificado_em,
     credencial_webauthn_id)
    VALUES($1,$2,900,clock_timestamp()+interval '1 hour','WEBAUTHN',clock_timestamp(),$3)`,
  [userId, randomBytes(32), credential.id])
  await client.query(`INSERT INTO alm.fluxos_auth_parcial(usuario_id,token_hash,expira_em)
    VALUES($1,$2,clock_timestamp()+interval '5 minutes')`, [userId, randomBytes(32)])
  await client.query('COMMIT')

  const newHash = await hashPin('87654321', pepper2)
  const newCodeHash = hashOpaqueToken(createOpaqueToken())
  const args = [userId, 'MKADM001', newHash, newCodeHash, 2,
    new Date(Date.now() + 86400000), incident, operator, requestId]
  // Colisao unica depois das revogacoes: tudo deve voltar ao estado anterior.
  await client.query('BEGIN')
  await client.query('SET LOCAL ROLE alm_provisioner')
  await assert.rejects(client.query(
    'SELECT alm.recuperar_primeiro_administrador($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [...args.slice(0, 3), originalCodeHash, ...args.slice(4)]), { code: '23505' })
  await client.query('ROLLBACK')
  const { rows: [before] } = await client.query(`SELECT
    (SELECT pepper_versao FROM alm.credenciais_pin WHERE usuario_id=$1) AS pepper,
    (SELECT count(*)::int FROM alm.autorizacoes_webauthn WHERE usuario_id=$1 AND revogado_em IS NULL) AS open_auth,
    (SELECT count(*)::int FROM alm.sessoes WHERE usuario_id=$1 AND revogada_em IS NULL) AS open_sessions`, [userId])
  assert.deepEqual([before.pepper, before.open_auth, before.open_sessions], [1, 1, 2])

  await client.query('BEGIN')
  await client.query('SET LOCAL ROLE alm_provisioner')
  await client.query('SELECT alm.recuperar_primeiro_administrador($1,$2,$3,$4,$5,$6,$7,$8,$9)', args)
  await client.query('COMMIT')
  await client.query('BEGIN READ ONLY')
  await client.query('SET LOCAL ROLE alm_provisioner')
  const { rows: [checked] } = await client.query(
    'SELECT alm.verificar_recuperacao_primeiro_administrador($1,$2) AS state',
    [requestId, userId])
  await client.query('COMMIT')
  assert.equal(checked.state.safe, true)
  assert.equal(checked.state.authorizationsRevoked, 1)
  assert.equal(checked.state.credentialsRevoked, 1)
  assert.equal(checked.state.sessionsRevoked, 2)
  assert.equal(checked.state.flowsCancelled, 1)

  const { rows: [after] } = await client.query(`SELECT
    (SELECT id FROM alm.usuarios WHERE matricula='MKADM001') AS id,
    (SELECT count(*)::int FROM alm.autorizacoes_webauthn WHERE usuario_id=$1
      AND revogado_ator_sistema=$2) AS system_revocations,
    (SELECT count(*)::int FROM alm.recuperacoes_primeiro_administrador
      WHERE request_id=$3 AND operador_externo=$4) AS audit_count`,
    [userId, `recuperacao:${operator}`, requestId, operator])
  assert.equal(after.id, userId)
  assert.equal(after.system_revocations, 1)
  assert.equal(after.audit_count, 1)
  await client.query('BEGIN')
  await client.query('SET LOCAL ROLE alm_provisioner')
  await assert.rejects(client.query(
    'SELECT alm.recuperar_primeiro_administrador($1,$2,$3,$4,$5,$6,$7,$8,$9)', args),
  { code: 'P0001' })
  await client.query('ROLLBACK')
  console.log('RECUPERACAO LOCAL: rollback, UUID preservado, auditoria, revogacao e retry OK')
} finally {
  await client.query('ROLLBACK').catch(() => {})
  await client.end().catch(() => {})
}
