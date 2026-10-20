// ALM N-2 integration: SOMENTE PostgreSQL 17 em 127.0.0.1/alm_ci_clean.
// Pressupoe 11 migrations do PR #2 + N-2 incremental. CRIA FIXTURES.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { test } from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const req = createRequire(process.env.ALM_DB_TEST_DEPS
  ? path.join(process.env.ALM_DB_TEST_DEPS, 'package.json') : import.meta.url)
const { Client } = req('pg')
const raw = process.env.ALM_LOCAL_DATABASE_URL
if (!raw || process.env.ALM_DB_TEST_DISPOSABLE !== 'YES') {
  throw new Error('ALM_LOCAL_DATABASE_URL e ALM_DB_TEST_DISPOSABLE=YES obrigatorios')
}
const url = new URL(raw)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/alm_ci_clean' || url.username !== 'postgres') {
  throw new Error('PERIGO: somente postgres@loopback/alm_ci_clean e permitido')
}
if (url.password) throw new Error('Nao informe senha na URL; use PGPASSWORD')
if (!process.env.PGPASSWORD) throw new Error('PGPASSWORD obrigatorio (somente credencial local)')
const connection = {
  host: url.hostname === '[::1]' ? '::1' : url.hostname,
  port: Number(url.port || 5432), database: 'alm_ci_clean',
  user: 'postgres', password: process.env.PGPASSWORD,
  connectionTimeoutMillis: 5000, query_timeout: 10000,
}
const client = () => new Client(connection)
const bytes = (n = 32) => randomBytes(n)
const actorSystem = async (c) => {
  await c.query("SELECT set_config('app.ator_sistema','test:n2',true),set_config('app.usuario_id','',true),set_config('app.request_id',$1,true)", [randomUUID()])
}
const actorHuman = async (c, userId) => {
  await c.query("SELECT set_config('app.usuario_id',$1,true),set_config('app.ator_sistema','',true),set_config('app.request_id',$2,true)", [userId,randomUUID()])
}
const tx = async (c, who = 'alm_api') => { await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${who}`) }
const withConnection = async (fn) => {
  const c = client(); await c.connect()
  try { return await fn(c) } finally { await c.end() }
}
const expectCode = async (fn, codes) => {
  await assert.rejects(fn, e => codes.includes(e.code), `SQLSTATE esperado: ${codes}`)
}
let fixture
async function init() {
  await withConnection(async c => {
    const res = await c.query(`SELECT current_database() AS db,
      current_setting('server_version_num')::int AS version,
      to_regclass('alm.credenciais_webauthn') IS NOT NULL AS n2`)
    const s = res.rows[0]
    assert.equal(s.db,'alm_ci_clean')
    assert.ok(s.version >= 170000 && s.version < 180000)
    assert.equal(s.n2,true,'migration N-2 ainda nao instalada')
    await tx(c); await actorSystem(c)
    try {
      const mk = async () => {
        const r=await c.query(`INSERT INTO alm.usuarios(matricula,nome,perfil)
         VALUES($1,'Teste N2','ALMOXARIFADO') RETURNING id`,
         [`T${String(Date.now()).slice(-8)}${Math.floor(Math.random()*1000)}`])
        return r.rows[0].id
      }
      const a=await mk(), b=await mk()
      const cred=await c.query(`INSERT INTO alm.credenciais_webauthn
       (usuario_id,credential_id,chave_publica_cose,algoritmo_cose,backup_eligible,
        backup_state,metodo_cadastro)
       VALUES($1,$2,$3,-7,false,false,'ATIVACAO') RETURNING id`,[a,bytes(),bytes(64)])
      const flowToken=bytes()
      const flow=await c.query(`INSERT INTO alm.fluxos_auth_parcial(usuario_id,token_hash,expira_em)
       VALUES($1,$2,clock_timestamp()+interval '5 minutes') RETURNING id`,[a,flowToken])
      const challenge=await c.query(`INSERT INTO alm.desafios_webauthn
       (usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,
        fluxo_parcial_id,rp_id,origem_esperada,expira_em)
       VALUES($1,'AUTENTICACAO',$2,$3,$4,'alm.example.test','https://alm.example.test',
        clock_timestamp()+interval '5 minutes') RETURNING id`,[a,bytes(),flowToken,flow.rows[0].id])
      fixture={a,b,cred:cred.rows[0].id,flow:flow.rows[0].id,
        token:flowToken,challenge:challenge.rows[0].id}
      await c.query('COMMIT')
    } catch(e){await c.query('ROLLBACK');throw e}
  })
}
// Os testes individuais dependem de fixture de instalacao.
await init()

test('estrutura e RLS das quatro tabelas N-2', async () => withConnection(async c => {
  const r=await c.query(`SELECT relname,relrowsecurity FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='alm' AND relname IN
     ('credenciais_webauthn','desafios_webauthn','fluxos_auth_parcial','autorizacoes_webauthn')`)
  assert.equal(r.rowCount,4)
  assert.ok(r.rows.every(x=>x.relrowsecurity))
}))

test('fluxo parcial nao representa sessao final (sem insercao implicita)', async () => withConnection(async c => {
  const r=await c.query('SELECT count(*)::int AS n FROM alm.sessoes WHERE usuario_id=$1',[fixture.a])
  assert.equal(r.rows[0].n,0)
  const f=await c.query('SELECT id,consumido_em FROM alm.fluxos_auth_parcial WHERE id=$1',[fixture.flow])
  assert.equal(f.rowCount,1)
  assert.equal(f.rows[0].consumido_em,null)
}))

test('constraint revogacao, duplicidade e titular vinculados', async () => withConnection(async c => {
  await tx(c); await actorSystem(c)
  try {
    await c.query('SAVEPOINT s1')
    await expectCode(()=>c.query(`UPDATE alm.credenciais_webauthn
      SET revogado_em=clock_timestamp(),motivo_revogacao='teste'
      WHERE id=$1`,[fixture.cred]),['23514','P0001'])
    await c.query('ROLLBACK TO SAVEPOINT s1')
    await c.query('SAVEPOINT s2')
    await expectCode(()=>c.query(`INSERT INTO alm.desafios_webauthn
      (usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,
       fluxo_parcial_id,rp_id,origem_esperada,expira_em)
      VALUES($1,'AUTENTICACAO',$2,$3,$4,'alm.example.test',
       'https://alm.example.test',clock_timestamp()+interval '1 minute')`,
      [fixture.b,bytes(),fixture.token,fixture.flow]),['23503'])
    await c.query('ROLLBACK TO SAVEPOINT s2')
    await c.query('SAVEPOINT s3')
    const old = await c.query('SELECT credential_id FROM alm.credenciais_webauthn WHERE id=$1',[fixture.cred])
    await expectCode(()=>c.query(`INSERT INTO alm.credenciais_webauthn
       (usuario_id,credential_id,chave_publica_cose,algoritmo_cose,
        backup_eligible,backup_state,metodo_cadastro)
       VALUES($1,$2,$3,-7,false,false,'ATIVACAO')`,
       [fixture.b,old.rows[0].credential_id,bytes(70)]),['23505'])
    await c.query('ROLLBACK TO SAVEPOINT s3')
    await c.query('SAVEPOINT s4')
    await expectCode(()=>c.query(`INSERT INTO alm.credenciais_webauthn
       (usuario_id,credential_id,chave_publica_cose,algoritmo_cose,
        backup_eligible,backup_state,metodo_cadastro)
       VALUES($1,$2,$3,-7,false,true,'ATIVACAO')`,
       [fixture.b,bytes(),bytes(70)]),['23514'])
    await c.query('ROLLBACK TO SAVEPOINT s4')
  } finally {await c.query('ROLLBACK')}
}))

test('desafio consumido atomicamente apenas uma vez em duas conexoes', async () => {
  const c1=client(),c2=client(); await Promise.all([c1.connect(),c2.connect()])
  const q=`UPDATE alm.desafios_webauthn SET consumido_em=clock_timestamp()
     WHERE id=$1 AND vinculo_fluxo_hash=$2 AND consumido_em IS NULL
       AND expira_em>clock_timestamp() RETURNING id`
  try {
    await Promise.all([tx(c1),tx(c2)])
    const r1=await c1.query(q,[fixture.challenge,fixture.token])
    const attempt2=c2.query(q,[fixture.challenge,fixture.token])
    await new Promise(resolve=>setTimeout(resolve,100))
    await c1.query('COMMIT')
    const r2=await attempt2
    assert.deepEqual([r1.rowCount,r2.rowCount].sort(),[0,1])
    await c2.query('ROLLBACK')
  } finally {await Promise.allSettled([c1.query('ROLLBACK'),c2.query('ROLLBACK')]);
    await Promise.all([c1.end(),c2.end()])}
})

test('grants: alm_job nao le material WebAuthn; alm_api nao apaga', async () => withConnection(async c => {
  await tx(c,'alm_job')
  try {
    await expectCode(()=>c.query('SELECT credential_id FROM alm.credenciais_webauthn'),['42501'])
  } finally {await c.query('ROLLBACK')}
  await tx(c)
  try {
    await expectCode(()=>c.query('DELETE FROM alm.credenciais_webauthn WHERE id=$1',[fixture.cred]),['42501'])
  } finally {await c.query('ROLLBACK')}
}))

test('revogacao concorre com criacao MFA e invalida sessao atomica', async () => {
  const a=client(),b=client();await Promise.all([a.connect(),b.connect()]);let sessao
  try {
    await tx(a); await actorHuman(a,fixture.a)
    await a.query('SELECT id FROM alm.credenciais_webauthn WHERE id=$1 FOR UPDATE',[fixture.cred])
    const s=await a.query(`INSERT INTO alm.sessoes
      (usuario_id,token_hash,ocioso_max_segundos,expira_em,mfa_metodo,
       mfa_verificado_em,credencial_webauthn_id)
      VALUES($1,$2,900,clock_timestamp()+interval '1 hour',
       'WEBAUTHN',clock_timestamp(),$3) RETURNING id`,
       [fixture.a,bytes(),fixture.cred])
    sessao=s.rows[0].id
    await tx(b); await actorHuman(b,fixture.a)
    // Promise de UPDATE fica bloqueada na credencial ate COMMIT da sessao.
    let finished=false
    const revocation=b.query(`UPDATE alm.credenciais_webauthn
      SET revogado_em=clock_timestamp(),revogado_por=$1,
          motivo_revogacao='teste concorrencia'
      WHERE id=$2 AND revogado_em IS NULL RETURNING id`,
      [fixture.a,fixture.cred]).then(r=>{finished=true;return r})
    await new Promise(resolve=>setTimeout(resolve,150))
    assert.equal(finished,false)
    await a.query('COMMIT')
    assert.equal((await revocation).rowCount,1)
    await b.query('COMMIT')
    const r=await b.query('SELECT revogada_em FROM alm.sessoes WHERE id=$1',[sessao])
    assert.ok(r.rows[0].revogada_em)
  } finally {await Promise.allSettled([a.query('ROLLBACK'),b.query('ROLLBACK')]);
    await Promise.all([a.end(),b.end()])}
})

test('auditoria de credencial nao copia COSE / credential ID', async () => withConnection(async c => {
  const r=await c.query(`SELECT dados_antes::text AS antes,dados_depois::text AS depois
    FROM alm.historico_alteracoes
    WHERE entidade='alm.credenciais_webauthn' AND entidade_id=$1`,[fixture.cred])
  assert.ok(r.rowCount>=1)
  for(const row of r.rows){const s=JSON.stringify(row);assert.ok(!s.includes('chave_publica_cose'));
    assert.ok(!s.includes('credential_id'));assert.ok(!s.includes('token_hash'))}
}))

test('desafio nao aceita hash de cookie parcial alheio', async () => withConnection(async c => {
  await tx(c); await actorSystem(c)
  try {
    await c.query('SAVEPOINT outro_cookie')
    await expectCode(()=>c.query(`INSERT INTO alm.desafios_webauthn
       (usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,fluxo_parcial_id,
        rp_id,origem_esperada,expira_em)
       VALUES($1,'AUTENTICACAO',$2,$3,$4,'alm.example.test',
        'https://alm.example.test',clock_timestamp()+interval '1 minute')`,
        [fixture.a,bytes(),bytes(),fixture.flow]),['23503'])
    await c.query('ROLLBACK TO SAVEPOINT outro_cookie')
  } finally {await c.query('ROLLBACK')}
}))

test('imutabilidade por privilegio minimo e trigger; revogacao irreversivel', async () => {
  await withConnection(async c => {
    await tx(c); await actorHuman(c,fixture.a)
    try {
      // GRANT por coluna barra UPDATE antes do BEFORE UPDATE trigger.
      await c.query('SAVEPOINT privil_minimo')
      await expectCode(()=>c.query(`UPDATE alm.credenciais_webauthn
         SET chave_publica_cose=$1 WHERE id=$2`,[bytes(40),fixture.cred]),['42501'])
      await c.query('ROLLBACK TO SAVEPOINT privil_minimo')

      // alm_api pode atualizar campos de revogacao, mas nao reativar.
      await c.query('SAVEPOINT reativar')
      await expectCode(()=>c.query(`UPDATE alm.credenciais_webauthn
         SET revogado_em=NULL,revogado_por=NULL,motivo_revogacao=NULL WHERE id=$1`,
         [fixture.cred]),['P0001'])
      await c.query('ROLLBACK TO SAVEPOINT reativar')
    } finally {await c.query('ROLLBACK')}
  })

  await withConnection(async c => {
    // Usuario postgres SOMENTE no banco descartavel: testa trigger sem o
    // bloqueio antecipado dos grants por coluna de alm_api.
    await c.query('BEGIN'); await actorHuman(c,fixture.a)
    try {
      const { rows: [p] } = await c.query(`SELECT has_column_privilege(
        current_user,'alm.credenciais_webauthn','chave_publica_cose','UPDATE') AS pode_update`)
      assert.equal(p.pode_update,true,'postgres local deve poder exercitar o trigger')
      await c.query('SAVEPOINT imutavel')
      await expectCode(()=>c.query(`UPDATE alm.credenciais_webauthn
         SET chave_publica_cose=$1 WHERE id=$2`,[bytes(40),fixture.cred]),['P0001'])
      await c.query('ROLLBACK TO SAVEPOINT imutavel')
    } finally {await c.query('ROLLBACK')}
  })
})

test('registro vincula desafio ao hash de autorizacao', async () => withConnection(async c => {
  await tx(c); await actorSystem(c)
  try {
    const codeHash=bytes()
    const { rows:[auth] }=await c.query(
      `INSERT INTO alm.autorizacoes_webauthn
       (usuario_id,finalidade,codigo_hash,autorizacao_externa,expira_em)
       VALUES($1,'ATIVACAO',$2,'processo-rh-aprovado',clock_timestamp()+interval '5 minutes')
       RETURNING id`,[fixture.a,codeHash])
    const { rows:[challenge] }=await c.query(
      `INSERT INTO alm.desafios_webauthn
       (usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,
        autorizacao_id,rp_id,origem_esperada,expira_em)
       VALUES($1,'REGISTRO',$2,$3,$4,'alm.example.test',
         'https://alm.example.test',clock_timestamp()+interval '5 minutes') RETURNING id`,
      [fixture.a,bytes(),codeHash,auth.id])
    assert.ok(challenge.id)
    await c.query('SAVEPOINT hash_incorreto')
    await expectCode(()=>c.query(
      `INSERT INTO alm.desafios_webauthn
       (usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,
        autorizacao_id,rp_id,origem_esperada,expira_em)
       VALUES($1,'REGISTRO',$2,$3,$4,'alm.example.test',
         'https://alm.example.test',clock_timestamp()+interval '5 minutes')`,
      [fixture.a,bytes(),bytes(),auth.id]),['23503'])
    await c.query('ROLLBACK TO SAVEPOINT hash_incorreto')
  } finally {await c.query('ROLLBACK')}
}))

test('consumo de desafio e fluxo expirados e proibido por trigger', async () => withConnection(async c => {
  await tx(c); await actorSystem(c)
  try {
    const flowToken=bytes()
    const { rows:[flow] }=await c.query(
      `INSERT INTO alm.fluxos_auth_parcial(usuario_id,token_hash,expira_em)
       VALUES($1,$2,clock_timestamp()+interval '0.1 seconds') RETURNING id`,
      [fixture.a,flowToken])
    const { rows:[challenge] }=await c.query(
      `INSERT INTO alm.desafios_webauthn
       (usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,fluxo_parcial_id,
        rp_id,origem_esperada,expira_em)
       VALUES($1,'AUTENTICACAO',$2,$3,$4,'alm.example.test',
        'https://alm.example.test',clock_timestamp()+interval '0.1 seconds') RETURNING id`,
      [fixture.a,bytes(),flowToken,flow.id])
    await new Promise(resolve=>setTimeout(resolve,240))
    await c.query('SAVEPOINT expirado_fluxo')
    await expectCode(()=>c.query(
      'UPDATE alm.fluxos_auth_parcial SET consumido_em=clock_timestamp() WHERE id=$1',
      [flow.id]),['P0001'])
    await c.query('ROLLBACK TO SAVEPOINT expirado_fluxo')
    await c.query('SAVEPOINT expirado_desafio')
    await expectCode(()=>c.query(
      'UPDATE alm.desafios_webauthn SET consumido_em=clock_timestamp() WHERE id=$1',
      [challenge.id]),['P0001'])
    await c.query('ROLLBACK TO SAVEPOINT expirado_desafio')
  } finally {await c.query('ROLLBACK')}
}))

test('revogacao proibe criar sessao MFA posterior', async () => withConnection(async c => {
  await tx(c); await actorHuman(c,fixture.a)
  try {
    const { rows:[row] }=await c.query(
      'SELECT revogado_em FROM alm.credenciais_webauthn WHERE id=$1',
      [fixture.cred])
    assert.ok(row.revogado_em,'teste depende da revogacao no teste de concorrencia')
    await c.query('SAVEPOINT nova_sessao')
    await expectCode(()=>c.query(
      `INSERT INTO alm.sessoes
       (usuario_id,token_hash,ocioso_max_segundos,expira_em,
        mfa_metodo,mfa_verificado_em,credencial_webauthn_id)
       VALUES($1,$2,900,clock_timestamp()+interval '1 hour',
        'WEBAUTHN',clock_timestamp(),$3)`,
      [fixture.a,bytes(),fixture.cred]),['P0001'])
    await c.query('ROLLBACK TO SAVEPOINT nova_sessao')
  } finally {await c.query('ROLLBACK')}
}))
