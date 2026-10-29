// Isolamento entre sessões: uma resposta que chega DEPOIS do logout/troca de usuário
// não pode alterar o que o usuário atual vê. Roda o store e o api.js REAIS (compilados em
// memória com esbuild, como os testes de src/features/auth/) contra um `fetch` controlado,
// para decidir quando cada resposta "chega".
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url))).replaceAll('\\', '/')

async function loadStore() {
  const result = await build({
    stdin: {
      contents: `export * from '${ROOT}/src/store.js'\nexport { api, setUnauthorizedHandler } from '${ROOT}/src/api.js'`,
      resolveDir: ROOT,
      sourcefile: 'entry.js',
      loader: 'js',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
  })
  const dir = mkdtempSync(join(tmpdir(), 'alm-store-test-'))
  try {
    const file = join(dir, 'bundle.cjs')
    writeFileSync(file, result.outputFiles[0].text)
    return createRequire(import.meta.url)(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// `fetch` controlado: cada chamada fica pendente até o teste resolvê-la.
const pending = []
globalThis.fetch = (url, init) => new Promise((resolveFetch) => {
  pending.push({ url: String(url), init, respond: (status, body) => resolveFetch(new Response(JSON.stringify(body), { status })) })
})

const tick = () => new Promise((resolveTick) => setImmediate(resolveTick))
async function request(pattern) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const index = pending.findIndex((entry) => pattern.test(entry.url))
    if (index >= 0) return pending.splice(index, 1)[0]
    await tick()
  }
  throw new Error(`requisição não apareceu: ${pattern}`)
}

const store = await loadStore()
const { api, setUnauthorizedHandler, getStoreSnapshot, resetDemoData, retryInitialLoad, setCurrentUser, storeActions, hydrateRecebimentosFromApi } = store

const USER_A = { id: '11111111-1111-4111-8111-111111111111', nome: 'Ana Almoxarifado', perfil: 'Administrador' }
const USER_B = { id: '22222222-2222-4222-8222-222222222222', nome: 'Bruno Portaria', perfil: 'Administrador' }
const page = (ids, totalPages = 1) => ({ data: ids.map((id) => ({ id, protocolo: id })), pagination: { totalPages } })
const ids = () => getStoreSnapshot().recebimentos.map((entry) => entry.id)
const LIST = /\/recebimentos\?/

test.beforeEach(async () => {
  pending.length = 0
  resetDemoData()
  setUnauthorizedHandler(null)
  await tick()
})

test('criação publica apenas o REC confirmado pelo servidor, sem inventar ID, protocolo ou status', async () => {
  setCurrentUser(USER_A)
  const input = { pedido: 'PED-123', fornecedor: 'Fornecedor', tipo: 'Estoque', rascunho: true }
  const saving = storeActions.createRecebimento(input)
  const post = await request(/\/recebimentos$/)
  assert.equal(post.init.method, 'POST')
  const body = JSON.parse(post.init.body)
  assert.equal(body.pedido, input.pedido)
  assert.equal(body.rascunho, true)
  assert.equal(Object.hasOwn(body, 'id'), false)
  assert.equal(Object.hasOwn(body, 'protocolo'), false)
  assert.deepEqual(ids(), [], 'nenhum REC aparece antes da confirmação')

  const confirmed = { id: 'server-id', protocolo: 'REC-SERVIDOR', status: 'Em digitação', pedido: input.pedido }
  post.respond(201, confirmed)
  const refresh = await request(/\/recebimentos\/server-id$/)
  assert.deepEqual(getStoreSnapshot().recebimentos, [confirmed])
  refresh.respond(200, confirmed)
  assert.deepEqual(await saving, confirmed)
  assert.deepEqual(getStoreSnapshot().recebimentos, [confirmed])
})

test('criação rejeitada não publica REC e conserva o erro da API', async () => {
  setCurrentUser(USER_A)
  const saving = storeActions.createRecebimento({ pedido: 'PED-123' })
  const post = await request(/\/recebimentos$/)
  assert.deepEqual(ids(), [])
  post.respond(422, { error: { code: 'INVALID_INPUT', message: 'Dados inválidos' } })
  await assert.rejects(saving, (error) => {
    assert.equal(error.message, 'Dados inválidos')
    assert.equal(error.code, 'INVALID_INPUT')
    assert.equal(error.createdReceipt, undefined)
    return true
  })
  assert.deepEqual(ids(), [])
  assert.equal(pending.length, 0, 'sem releitura de um REC que não foi criado')
})

test('criação continua bloqueada para o perfil Consulta antes de chamar a API', () => {
  setCurrentUser({ ...USER_A, perfil: 'Consulta' })
  assert.throws(() => storeActions.createRecebimento({ pedido: 'PED-123' }),
    /O perfil Consulta não pode alterar recebimentos/)
  assert.deepEqual(ids(), [])
  assert.equal(pending.length, 0)
})

test('hidratação normal: o usuário atual recebe a própria lista (várias páginas)', async () => {
  setCurrentUser(USER_A)
  const loading = retryInitialLoad()
  const first = await request(LIST)
  first.respond(200, page(['REC-A1'], 2))
  const second = await request(/page=2/)
  second.respond(200, page(['REC-A2'], 2))
  await loading
  assert.deepEqual(ids().sort(), ['REC-A1', 'REC-A2'])
  assert.equal(getStoreSnapshot().initialLoadStatus, 'ready')
})

test('hidratação normal: falha do servidor do usuário atual continua aparecendo como erro', async () => {
  setCurrentUser(USER_A)
  const loading = retryInitialLoad()
  ;(await request(LIST)).respond(500, { error: { message: 'x' } })
  await loading
  assert.equal(getStoreSnapshot().initialLoadStatus, 'error')
  assert.deepEqual(ids(), [])
})

test('revalidar a MESMA sessão (mesmo usuário) não invalida a hidratação em andamento', async () => {
  setCurrentUser(USER_A)
  const loading = retryInitialLoad()
  const first = await request(LIST)
  setCurrentUser({ ...USER_A }) // GET /auth/me de novo ao voltar para a aba
  first.respond(200, page(['REC-A1']))
  await loading
  assert.deepEqual(ids(), ['REC-A1'])
  assert.equal(getStoreSnapshot().initialLoadStatus, 'ready')
})

test('A inicia, A sai, B entra, a resposta antiga de A chega DEPOIS: nada de A é publicado e B continua funcionando', async () => {
  setCurrentUser(USER_A)
  const loadingA = retryInitialLoad()
  const requestA = await request(LIST)

  resetDemoData() // logout/expiração de A
  setCurrentUser(USER_B)
  const loadingB = retryInitialLoad()
  const requestB = await request(LIST)

  requestA.respond(200, page(['REC-DE-A']))
  await loadingA
  assert.deepEqual(ids(), [], 'dados de A não podem aparecer para B')
  assert.equal(getStoreSnapshot().initialLoadStatus, 'loading', 'a carga de B ainda não terminou: o estado de A não a encerra')

  requestB.respond(200, page(['REC-DE-B']))
  await loadingB
  assert.deepEqual(ids(), ['REC-DE-B'])
  assert.equal(getStoreSnapshot().initialLoadStatus, 'ready')
})

test('resposta antiga de A chegando DEPOIS da de B não sobrescreve a lista de B', async () => {
  setCurrentUser(USER_A)
  const loadingA = retryInitialLoad()
  const requestA = await request(LIST)
  resetDemoData()
  setCurrentUser(USER_B)
  const loadingB = retryInitialLoad()
  ;(await request(LIST)).respond(200, page(['REC-DE-B']))
  await loadingB
  requestA.respond(200, page(['REC-DE-A']))
  await loadingA
  assert.deepEqual(ids(), ['REC-DE-B'])
})

test('A sai e ninguém entra: a resposta tardia de A não restaura dados num estado já limpo', async () => {
  setCurrentUser(USER_A)
  const loadingA = retryInitialLoad()
  const requestA = await request(LIST)
  resetDemoData()
  requestA.respond(200, page(['REC-DE-A']))
  await loadingA
  assert.deepEqual(ids(), [])
  assert.notEqual(getStoreSnapshot().initialLoadStatus, 'ready')
})

test('segunda página de A que chega depois do logout também é descartada', async () => {
  setCurrentUser(USER_A)
  const loadingA = retryInitialLoad()
  ;(await request(LIST)).respond(200, page(['REC-A1'], 2))
  const secondPage = await request(/page=2/)
  resetDemoData()
  setCurrentUser(USER_B)
  secondPage.respond(200, page(['REC-A2'], 2))
  await loadingA
  assert.deepEqual(ids(), [])
})

test('erro tardio de A não marca como falha a carga de B', async () => {
  setCurrentUser(USER_A)
  const loadingA = retryInitialLoad()
  const requestA = await request(LIST)
  resetDemoData()
  setCurrentUser(USER_B)
  const loadingB = retryInitialLoad()
  ;(await request(LIST)).respond(200, page(['REC-DE-B']))
  await loadingB
  requestA.respond(500, { error: { message: 'x' } })
  await loadingA
  assert.equal(getStoreSnapshot().initialLoadStatus, 'ready')
  assert.equal(getStoreSnapshot().initialLoadError, null)
  assert.deepEqual(ids(), ['REC-DE-B'])
})

test('troca de usuário sem passar pelo logout também invalida a resposta antiga', async () => {
  setCurrentUser(USER_A)
  const loadingA = retryInitialLoad()
  const requestA = await request(LIST)
  setCurrentUser(USER_B)
  requestA.respond(200, page(['REC-DE-A']))
  await loadingA
  assert.deepEqual(ids(), [])
})

test('depois do logout a hidratação não reaproveita a promessa da sessão anterior', async () => {
  setCurrentUser(USER_A)
  void hydrateRecebimentosFromApi()
  const requestA = await request(LIST)
  resetDemoData()
  setCurrentUser(USER_B)
  const loadingB = hydrateRecebimentosFromApi() // sem retryInitialLoad: precisa buscar de novo
  const requestB = await request(LIST)
  requestB.respond(200, page(['REC-DE-B']))
  await loadingB
  requestA.respond(200, page(['REC-DE-A']))
  await tick()
  assert.deepEqual(ids(), ['REC-DE-B'])
})

test('atualização de um recebimento: a releitura tardia de A não é publicada para B', async () => {
  setCurrentUser(USER_A)
  store.replaceRecebimentos([{ id: 'REC-1', protocolo: 'REC-1', status: 'Digitação', itens: [], anexos: [], historicoAlteracoes: [] }])
  const syncing = storeActions.updateRecebimento('REC-1', { observacoes: 'A mexeu' })
  ;(await request(/\/recebimentos\/REC-1$/)).respond(200, {}) // PATCH confirmado
  const refreshA = await request(/\/recebimentos\/REC-1$/) // GET de releitura, ainda pendente
  resetDemoData()
  setCurrentUser(USER_B)
  store.replaceRecebimentos([{ id: 'REC-1', protocolo: 'REC-1', status: 'Digitação', itens: [], anexos: [], historicoAlteracoes: [], observacoes: 'versão de B' }])
  refreshA.respond(200, { id: 'REC-1', protocolo: 'REC-1', observacoes: 'versão de A' })
  await syncing
  assert.equal(getStoreSnapshot().recebimentos[0].observacoes, 'versão de B')
})

test('401 tardio de uma requisição da sessão anterior não derruba a sessão atual', async () => {
  let expirations = 0
  setUnauthorizedHandler(() => { expirations += 1 })
  setCurrentUser(USER_A)
  const oldCall = api.listRecebimentos({}).catch(() => {})
  const oldRequest = await request(LIST)
  resetDemoData()
  setCurrentUser(USER_B)
  oldRequest.respond(401, { error: { code: 'UNAUTHORIZED' } })
  await oldCall
  assert.equal(expirations, 0, 'o 401 era da sessão de A')

  const currentCall = api.listRecebimentos({}).catch(() => {})
  ;(await request(LIST)).respond(401, { error: { code: 'UNAUTHORIZED' } })
  await currentCall
  assert.equal(expirations, 1, 'um 401 da sessão atual continua encerrando a sessão')
})
