// Dependencias de teste podem ser instaladas fora do repo; veja README.md.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
process.on('uncaughtException', error => {
  console.error('FALHA:', error.message, error.code || '', error.where || '')
  process.exitCode = 1
})
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(process.env.ALM_DB_TEST_DEPS
  ? path.join(process.env.ALM_DB_TEST_DEPS, 'package.json') : import.meta.url)
const migrations = path.join(here, '../migrations')
const names = fs.readdirSync(migrations).filter(n => /^\d+.*\.sql$/.test(n)).sort()
const read = name => fs.readFileSync(path.join(migrations, name), 'utf8')
const architecture = fs.readFileSync(path.join(here, '../../ARQUITETURA_TECNICA_ALM.md'), 'utf8').replace(/\r\n/g, '\n')
const section = architecture.split('## 3. Schema PostgreSQL\n')[1].split('\n## 4. ')[0]
const blocks = [...section.matchAll(/```sql\n([\s\S]*?)```/g)].map(m => m[1].trimEnd())
const base = read('20261007160000_alm_v1_base.sql').replace(/\r\n/g, '\n')
assert.equal(base.slice(base.indexOf('BEGIN;')), blocks.join('\n\n') + '\n')
const deltaReference = path.join(here, '../../docs/alm2/sql/001_alm2_delta.sql')
if (fs.existsSync(deltaReference)) {
  assert.equal(read('20261007160100_alm2_delta.sql').replace(/\r\n/g, '\n'),
    fs.readFileSync(deltaReference, 'utf8').replace(/\r\n/g, '\n'))
} else {
  console.log('INFO: referencia docs/alm2/sql/001_alm2_delta.sql ausente nesta branch; comparacao do delta ignorada')
}
let db
let pool
const localMode = process.argv.includes('--local')
const stagingMode = process.argv.includes('--staging')
if (localMode && stagingMode) throw new Error('Use apenas um modo: --local OU --staging')

if (localMode || stagingMode) {
  let url
  if (localMode) {
    url = new URL(process.env.ALM_LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Somente banco LOCAL permitido em --local')
  } else {
    const projectRef = 'uxfstabcpvmujvzijyqw'
    const directHost = 'db.' + projectRef + '.supabase.co'
    const poolerHost = process.env.ALM_STAGING_DB_HOST
    const password = process.env.ALM_STAGING_DB_PASSWORD
    if (!password) throw new Error('Defina ALM_STAGING_DB_PASSWORD sem colocar a senha no comando')
    if (!poolerHost) throw new Error('Defina ALM_STAGING_DB_HOST com o host do Session pooler copiado do painel Supabase')
    if (!/^[a-z0-9.-]+\.pooler\.supabase\.com$/i.test(poolerHost)) {
      throw new Error('ALM_STAGING_DB_HOST deve ser um host oficial *.pooler.supabase.com')
    }
    url = new URL('postgresql://postgres.' + projectRef + '@' + poolerHost + ':5432/postgres')
    url.password = password
    url.searchParams.set('uselibpqcompat', 'true')
    url.searchParams.set('sslmode', 'require')
    if (url.hostname === directHost || url.pathname !== '/postgres') {
      throw new Error('Destino de staging inesperado; teste abortado')
    }
  }
  const { Pool } = require('pg')
  pool = new Pool({ connectionString: url.href, connectionTimeoutMillis: 10000, query_timeout: 20000 })
  const client = await pool.connect()
  db = { query: async sql => client.query(sql), close: async () => { client.release(); await pool.end() } }
  console.log(localMode
    ? 'LOCAL: migrations devem estar aplicadas por supabase db reset --local'
    : 'STAGING: Almoxarifado ALM; migrations ja devem estar aplicadas')
} else {
  const { PGlite } = require('@electric-sql/pglite')
  const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
  const { unaccent } = require('@electric-sql/pglite/contrib/unaccent')
  const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm')
  db = new PGlite({ extensions: { pgcrypto, unaccent, pg_trgm } })
  for (const name of names) {
    await db.exec(read(name))
    console.log('Migration OK:', name)
    if (name.includes('v1_base')) {
      await db.exec(`BEGIN; SELECT set_config('app.ator_sistema','test:v1',true);
        INSERT INTO alm.usuarios (oidc_issuer,oidc_subject,email,nome,perfil)
        VALUES ('test:issuer','v1','v1@example.test','Teste v1','CONSULTA'); COMMIT;`)
    }
  }
  const old = (await db.query("SELECT legado, matricula, versao FROM alm.usuarios WHERE oidc_subject='v1'")).rows[0]
  assert.equal(old.legado, true)
  assert.equal(old.matricula, null)
  assert.equal(Number(old.versao), 1)
  console.log('OK: usuario v1 preservado, sem matricula e sem bump de versao')
}
try {
  console.log((await db.query('SELECT version()')).rows)
  console.log('Extensoes:', (await db.query(`SELECT e.extname,n.nspname FROM pg_extension e
    JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('unaccent','pg_trgm','pgcrypto') ORDER BY 1`)).rows)
  let sql = fs.readFileSync(path.join(here, 'database.sql'), 'utf8')
  if (stagingMode) {
    // O usuario postgres do Session pooler nao pode SET ROLE para alm_api/alm_job.
    // Em staging preservamos os testes de schema/comportamento e pulamos somente
    // os blocos que exercitam privilegios por troca de role. Esses grants continuam
    // validados pelo catalogo; o runner local continua exercitando SET ROLE de fato.
    sql = sql.replace(
      /SET LOCAL ROLE alm_api;[\s\S]*?SELECT pg_temp\.ok\('job controla espelho',[\s\S]*?\);\r?\n/,
      ''
    )
    sql = sql.replace(
      /CREATE ROLE alm_test_sem_policy NOLOGIN;[\s\S]*?RESET ROLE;\r?\n/,
      ''
    )
    console.log('STAGING: blocos SET ROLE ignorados; privilegios seguem validados por catalogo')
  }
  const results = db.exec ? await db.exec(sql) : await db.query(sql)
  for (const result of Array.isArray(results) ? results : [results]) {
    if (result.rows?.[0]?.testes_aprovados) console.log('TESTES SQL APROVADOS:', result.rows[0].testes_aprovados)
  }
  if (pool) {
    // Duas conexoes reais: uma disputa o mesmo numerador enquanto a outra
    // segura o lock. Ano reservado deve estar vazio; remove somente fixture.
    const a = await pool.connect()
    const b = await pool.connect()
    let ownsFixture = false
    try {
      assert.equal((await a.query('SELECT 1 FROM alm.recebimento_numeradores WHERE ano=9997')).rowCount, 0)
      ownsFixture = true
      await a.query(localMode ? 'BEGIN; SET LOCAL ROLE alm_api' : 'BEGIN')
      const first = (await a.query('SELECT alm.proximo_codigo_recebimento(9997::smallint) AS codigo')).rows[0].codigo
      await b.query(localMode ? 'BEGIN; SET LOCAL ROLE alm_job' : 'BEGIN')
      let finished = false
      const next = b.query('SELECT alm.proximo_codigo_recebimento(9997::smallint) AS codigo').then(r => { finished = true; return r })
      await new Promise(r => setTimeout(r, 150))
      assert.equal(finished, false, 'segunda conexao deve aguardar o lock')
      await a.query('COMMIT')
      const second = (await next).rows[0].codigo
      await b.query('COMMIT')
      assert.equal(first, 'REC-9997-000001')
      assert.equal(second, 'REC-9997-000002')
      console.log('CONCORRENCIA: lock e dois codigos distintos aprovados')
    } finally {
      await a.query('ROLLBACK'); await b.query('ROLLBACK')
      if (ownsFixture) await a.query('DELETE FROM alm.recebimento_numeradores WHERE ano=9997')
      a.release(); b.release()
    }
  } else console.log('CONCORRENCIA REAL: pendente; PGlite usa uma conexao, execute --local ou --staging')
} finally { await db.close() }
