// Instala TODAS as migrations em um PostgreSQL 17 descartavel e vazio.
// Exige hostname loopback e database dedicado alm_ci_clean; NUNCA usa staging.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(process.env.ALM_DB_TEST_DEPS
  ? path.join(process.env.ALM_DB_TEST_DEPS, 'package.json') : import.meta.url)
const { Client } = require('pg')
const rawUrl = process.env.ALM_LOCAL_DATABASE_URL
if (!rawUrl) throw new Error('Defina ALM_LOCAL_DATABASE_URL para um Postgres descartavel local')
const url = new URL(rawUrl)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/alm_ci_clean') {
  throw new Error('Instalacao limpa permitida apenas em loopback/alm_ci_clean')
}

const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 10000, query_timeout: 30000 })
const migrationsDir = path.join(here, '../migrations')
const migrationNames = fs.readdirSync(migrationsDir)
  .filter(name => /^\d+.*\.sql$/.test(name))
  .sort()

const requiredMigrations = [
  '20261007160000_alm_v1_base.sql',
  '20261007160100_alm2_delta.sql',
  '20261007160200_alm_integridade.sql',
  '20261015010000_alm_chg_rec_atomico.sql',
  '20261015012000_alm_function_search_path_hardening.sql',
  '20261015013000_alm_extensions_schema_hardening.sql',
  '20261015014500_alm_mvp_fk_indexes.sql',
  '20261015021500_alm_mvp_fk_indexes_round2.sql',
  '20261015023000_alm_bloquear_restauracao_purgado.sql',
  '20261015024500_alm_extensions_role_usage.sql',
  '20261015030000_alm_seguranca_auth.sql'
]
for (const required of requiredMigrations) {
  if (!migrationNames.includes(required)) throw new Error('Migration obrigatoria ausente: ' + required)
}

try {
  await client.connect()
  const { rows: [initial] } = await client.query(`
    SELECT current_database() AS db,
           to_regnamespace('alm') IS NOT NULL AS has_alm,
           EXISTS (
             SELECT 1 FROM pg_roles WHERE rolname IN ('alm_api','alm_job')
           ) AS has_alm_roles
  `)
  if (initial.db !== 'alm_ci_clean' || initial.has_alm || initial.has_alm_roles) {
    throw new Error('Banco nao esta vazio: instalacao limpa abortada antes de DDL')
  }

  // Simula apenas pre-requisitos padrao do Supabase no banco local descartavel.
  await client.query('CREATE SCHEMA IF NOT EXISTS extensions')
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions')

  for (const filename of migrationNames) {
    const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
    await client.query(sql)
    console.log('INSTALACAO LIMPA OK:', filename)

    if (filename === '20261007160000_alm_v1_base.sql') {
      await client.query(`BEGIN;
        SELECT set_config('app.ator_sistema','test:v1',true);
        INSERT INTO alm.usuarios (oidc_issuer,oidc_subject,email,nome,perfil)
        VALUES ('test:issuer','v1','v1@example.test','Teste v1','CONSULTA');
        COMMIT;`)
    }
  }

  const { rows: [legacy] } = await client.query(
    "SELECT legado, matricula, versao FROM alm.usuarios WHERE oidc_subject='v1'"
  )
  assert.deepEqual(
    [legacy.legado, legacy.matricula, Number(legacy.versao)],
    [true, null, 1],
    'Usuario v1 deve ser preservado sem alteracao de versao'
  )

  const { rows: [status] } = await client.query(`
    SELECT
      (SELECT count(*)::int FROM pg_tables WHERE schemaname='alm') AS tabelas,
      (SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='alm' AND c.relkind='r' AND c.relrowsecurity) AS tabelas_rls,
      has_schema_privilege('alm_api','extensions','USAGE') AS api_extensions,
      has_schema_privilege('alm_job','extensions','USAGE') AS job_extensions
  `)
  assert.equal(status.tabelas, 28)
  assert.equal(status.tabelas_rls, 28)
  assert.equal(status.api_extensions, true)
  assert.equal(status.job_extensions, true)
  console.log('INSTALACAO LIMPA: 28 tabelas, RLS em 28, roles e legado v1 OK')
  console.log('Proxima etapa: node supabase/tests/run-database.mjs --local')
} catch (err) {
  console.error('FALHA INSTALACAO LIMPA:', err.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
