// Prova local de LOGIN + SET ROLE para ALM (PostgreSQL 17).
// Somente 127.0.0.1:55433/alm_ci_clean. Nunca executa em staging.
// Logins temporarios e senhas geradas em memoria; removidos ao final.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(process.env.ALM_DB_TEST_DEPS
  ? path.join(process.env.ALM_DB_TEST_DEPS, 'package.json') : import.meta.url)
const { Client } = require('pg')

const raw = process.env.ALM_LOCAL_DATABASE_URL
if (!raw) throw new Error('Defina ALM_LOCAL_DATABASE_URL para a instancia isolada')
const url = new URL(raw)
if (url.hostname !== '127.0.0.1' || url.port !== '55433' ||
    url.pathname !== '/alm_ci_clean' || url.username !== 'postgres') {
  throw new Error('Permitido apenas postgres@127.0.0.1:55433/alm_ci_clean')
}
if (!process.env.PGPASSWORD) {
  throw new Error('Defina PGPASSWORD no terminal sem mostrar a senha')
}
if (url.password) throw new Error('Nao inclua senha na URL; use PGPASSWORD')

const names = { api: 'alm_ci_prova_login_api', job: 'alm_ci_prova_login_job' }
const passwords = { api: randomBytes(36).toString('hex'), job: randomBytes(36).toString('hex') }
const common = { host: '127.0.0.1', port: 55433, database: 'alm_ci_clean',
  connectionTimeoutMillis: 10000, query_timeout: 15000 }
const admin = new Client({ ...common, user: 'postgres', password: process.env.PGPASSWORD })
let apiClient
let jobClient
let createdApi = false
let createdJob = false

const check = (condition, message) => assert.ok(condition, message)
async function assertDenied(client, sql, label) {
  try {
    await client.query(sql)
    throw new Error(label + ': ACESSO INDEVIDAMENTE PERMITIDO')
  } catch (err) {
    if (err.code !== '42501') throw err
    console.log('NEGADO CORRETAMENTE:', label)
  }
}

try {
  await admin.connect()
  const { rows: [p] } = await admin.query(String.raw`
    SELECT current_database() AS db, inet_server_addr()::text AS addr,
           inet_server_port() AS port, current_setting('server_version_num')::int AS version,
           (SELECT count(*) FROM pg_roles WHERE rolname IN ('alm_api','alm_job'))::int AS role_count,
           (SELECT count(*) FROM pg_roles WHERE rolname IN ('alm_ci_prova_login_api','alm_ci_prova_login_job'))::int AS temporary_roles,
           to_regclass('alm.credenciais_pin') IS NOT NULL AS has_pin,
           to_regclass('alm.sessoes') IS NOT NULL AS has_session`)
  check(p.db === 'alm_ci_clean' && p.addr === '127.0.0.1' && p.port === 55433,
    'Conexao nao pertence ao PostgreSQL local isolado')
  check(p.version >= 170000 && p.version < 180000, 'PostgreSQL 17 exigido')
  check(p.role_count === 2 && p.temporary_roles === 0 && p.has_pin && p.has_session,
    'Ambiente nao esta pronto ou sobrou um login temporario; abortado')

  // Escopo local: estes logins sao apenas para a prova e nao possuem segredos persistentes no Git.
  await admin.query("CREATE ROLE alm_ci_prova_login_api LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '" + passwords.api + "'")
  createdApi = true
  await admin.query("CREATE ROLE alm_ci_prova_login_job LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '" + passwords.job + "'")
  createdJob = true
  await admin.query('GRANT alm_api TO alm_ci_prova_login_api WITH ADMIN FALSE, INHERIT FALSE, SET TRUE')
  await admin.query('GRANT alm_job TO alm_ci_prova_login_job WITH ADMIN FALSE, INHERIT FALSE, SET TRUE')

  const { rows: [grants] } = await admin.query(String.raw`
    SELECT pg_has_role('alm_ci_prova_login_api','alm_api','SET') AS api_set,
           pg_has_role('alm_ci_prova_login_api','alm_job','SET') AS api_not_job,
           pg_has_role('alm_ci_prova_login_job','alm_job','SET') AS job_set,
           pg_has_role('alm_ci_prova_login_job','alm_api','SET') AS job_not_api,
           has_schema_privilege('alm_ci_prova_login_api','alm','USAGE') AS api_inherits,
           has_schema_privilege('alm_ci_prova_login_job','alm','USAGE') AS job_inherits`)
  check(grants.api_set && grants.job_set && !grants.api_not_job && !grants.job_not_api &&
    !grants.api_inherits && !grants.job_inherits, 'Falha na separacao dos grants')

  apiClient = new Client({ ...common, user: names.api, password: passwords.api })
  await apiClient.connect()
  const { rows: [apiBefore] } = await apiClient.query('SELECT session_user, current_user')
  check(apiBefore.session_user === names.api && apiBefore.current_user === names.api,
    'Login da API nao foi autenticado como identidade propria')
  await assertDenied(apiClient, 'SELECT count(*) FROM alm.usuarios', 'login API sem SET ROLE nao acessa alm')
  await apiClient.query('BEGIN')
  try {
    await apiClient.query('SET LOCAL ROLE alm_api')
    const { rows: [current] } = await apiClient.query('SELECT session_user, current_user')
    check(current.session_user === names.api && current.current_user === 'alm_api',
      'SET LOCAL ROLE alm_api falhou')
    await apiClient.query('SELECT count(*) FROM alm.usuarios')
    await apiClient.query('SELECT count(*) FROM alm.credenciais_pin')
    console.log('APROVADO: login API real + SET LOCAL ROLE alm_api + SELECT permitido')
  } finally { await apiClient.query('ROLLBACK') }

  jobClient = new Client({ ...common, user: names.job, password: passwords.job })
  await jobClient.connect()
  const { rows: [jobBefore] } = await jobClient.query('SELECT session_user, current_user')
  check(jobBefore.session_user === names.job && jobBefore.current_user === names.job,
    'Login do job nao foi autenticado como identidade propria')
  await assertDenied(jobClient, 'SELECT count(*) FROM alm.usuarios', 'login JOB sem SET ROLE nao acessa alm')
  await jobClient.query('BEGIN')
  try {
    await jobClient.query('SET LOCAL ROLE alm_job')
    const { rows: [current] } = await jobClient.query('SELECT session_user, current_user')
    check(current.session_user === names.job && current.current_user === 'alm_job',
      'SET LOCAL ROLE alm_job falhou')
    await jobClient.query('SELECT id, ultimo_uso_em FROM alm.sessoes LIMIT 1')
    console.log('APROVADO: login JOB real + SET LOCAL ROLE alm_job + SELECT limitado')
    await jobClient.query('SAVEPOINT teste_pin')
    await assertDenied(jobClient, 'SELECT pin_hash FROM alm.credenciais_pin', 'alm_job nao le PIN')
    await jobClient.query('ROLLBACK TO SAVEPOINT teste_pin')
    await jobClient.query('SAVEPOINT teste_token')
    await assertDenied(jobClient, 'SELECT token_hash FROM alm.sessoes', 'alm_job nao le token')
    await jobClient.query('ROLLBACK TO SAVEPOINT teste_token')
  } finally { await jobClient.query('ROLLBACK') }

  console.log('TESTE DE LOGINS TECNICOS APROVADO: sem escrita de negocio, sem mudancas permanentes')
} catch (err) {
  console.error('FALHA TESTE DE LOGINS:', err.message, err.code || '')
  process.exitCode = 1
} finally {
  await apiClient?.end().catch(() => {})
  await jobClient?.end().catch(() => {})
  if (createdApi) {
    try { await admin.query('REVOKE alm_api FROM alm_ci_prova_login_api') } catch (err) { console.error('ATENCAO limpeza api/grant:', err.message); process.exitCode = 1 }
    try { await admin.query('DROP ROLE alm_ci_prova_login_api') } catch (err) { console.error('ATENCAO limpeza api/login:', err.message); process.exitCode = 1 }
  }
  if (createdJob) {
    try { await admin.query('REVOKE alm_job FROM alm_ci_prova_login_job') } catch (err) { console.error('ATENCAO limpeza job/grant:', err.message); process.exitCode = 1 }
    try { await admin.query('DROP ROLE alm_ci_prova_login_job') } catch (err) { console.error('ATENCAO limpeza job/login:', err.message); process.exitCode = 1 }
  }
  await admin.end().catch(() => {})
}
