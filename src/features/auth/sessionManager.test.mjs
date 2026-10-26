import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthApiError } from './authApi.js'
import { SESSION_STATUS } from './sessionState.js'
import { createSessionManager } from './sessionManager.js'

const API_USER = {
  id: '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01', matricula: '000123', nome: 'Pessoa de Teste', perfil: 'ALMOXARIFADO',
  papeis: ['ALMOXARIFADO'], permissoes: ['recebimentos.read', 'dashboard.read'],
}
const apiError = (kind, status = 400) => new AuthApiError({ status, kind })

function setup(apiOverrides = {}, options = {}) {
  const calls = { getSession: 0, logout: 0, userChanges: [], signedOut: 0 }
  const api = {
    async getSession() { calls.getSession += 1; return API_USER },
    async logout() { calls.logout += 1; return { authenticated: false } },
    ...apiOverrides,
  }
  const manager = createSessionManager({
    api,
    onUserChange: (user) => calls.userChanges.push(user?.id ?? null),
    onSignedOut: () => { calls.signedOut += 1 },
    ...options,
  })
  return { manager, calls }
}

test('começa verificando: ninguém autenticado antes da resposta do servidor', () => {
  const { manager } = setup()
  assert.equal(manager.getState().status, SESSION_STATUS.CHECKING)
  assert.equal(manager.getState().user, null)
})

test('restauração: GET /auth/me válido autentica e entrega o usuário ao store ANTES de liberar o app', async () => {
  const order = []
  const { manager, calls } = setup({}, { onUserChange: () => order.push(`user:${manager.getState().status}`) })
  manager.subscribe(() => order.push(`state:${manager.getState().status}`))
  const user = await manager.check()
  assert.equal(user.matricula, '000123')
  assert.equal(manager.getState().status, SESSION_STATUS.AUTHENTICATED)
  assert.equal(calls.getSession, 1)
  assert.deepEqual(order, ['user:checking', 'state:authenticated'], 'o store recebe o usuário antes do estado autenticado')
})

test('sem sessão (401): anônimo, sem usuário, sem aviso de expiração na primeira visita', async () => {
  const { manager, calls } = setup({ getSession: async () => { throw apiError('unauthorized', 401) } })
  assert.equal(await manager.check(), null)
  const state = manager.getState()
  assert.equal(state.status, SESSION_STATUS.ANONYMOUS)
  assert.equal(state.user, null)
  assert.equal(state.reason, null)
  assert.deepEqual(calls.userChanges, [null])
})

test('corpo inesperado do /auth/me (ex.: backend legado) não autentica', async () => {
  for (const body of [{}, { id: 'USR-001', nome: 'Admin', perfil: 'Administrador' }, null, 'ok', []]) {
    const { manager } = setup({ getSession: async () => body })
    assert.equal(await manager.check(), null)
    assert.equal(manager.getState().status, SESSION_STATUS.ANONYMOUS)
    assert.equal(manager.getState().user, null)
  }
})

test('backend indisponível ou rede fora na verificação inicial: estado "indisponível", sem acesso', async () => {
  for (const kind of ['network', 'unavailable', 'unexpected']) {
    const { manager } = setup({ getSession: async () => { throw apiError(kind, kind === 'network' ? 0 : 503) } })
    await manager.check()
    assert.equal(manager.getState().status, SESSION_STATUS.UNAVAILABLE, kind)
    assert.equal(manager.getState().user, null)
  }
})

test('tentar de novo depois de "indisponível" volta a verificar e pode autenticar', async () => {
  let attempt = 0
  const { manager } = setup({ getSession: async () => { attempt += 1; if (attempt === 1) throw apiError('network', 0); return API_USER } })
  await manager.check()
  assert.equal(manager.getState().status, SESSION_STATUS.UNAVAILABLE)
  const pending = manager.check()
  assert.equal(manager.getState().status, SESSION_STATUS.CHECKING)
  await pending
  assert.equal(manager.getState().status, SESSION_STATUS.AUTHENTICATED)
})

test('readSession (usada pelo login) propaga falha de rede em vez de engolir; 401 vira null', async () => {
  const offline = setup({ getSession: async () => { throw apiError('network', 0) } })
  await assert.rejects(offline.manager.readSession(), (error) => error.kind === 'network')
  assert.equal(offline.manager.getState().status, SESSION_STATUS.CHECKING, 'rede fora não derruba nem concede')
  const denied = setup({ getSession: async () => { throw apiError('unauthorized', 401) } })
  assert.equal(await denied.manager.readSession(), null)
  assert.equal(denied.manager.getState().status, SESSION_STATUS.ANONYMOUS)
})

test('expiração (401 em qualquer chamada): remove o usuário, limpa o store e avisa "sessão expirou"', async () => {
  const { manager, calls } = setup()
  await manager.check()
  manager.expire()
  const state = manager.getState()
  assert.equal(state.status, SESSION_STATUS.ANONYMOUS)
  assert.equal(state.user, null)
  assert.equal(state.reason, 'expired')
  assert.deepEqual(calls.userChanges, [API_USER.id, null])
})

test('expirar sem sessão ativa não inventa aviso', async () => {
  const { manager } = setup({ getSession: async () => { throw apiError('unauthorized', 401) } })
  await manager.check()
  manager.expire()
  assert.equal(manager.getState().reason, null)
})

test('revalidação em segundo plano: 401 expira; rede fora mantém a sessão atual', async () => {
  let mode = 'ok'
  let now = 1_000_000
  const { manager } = setup({ getSession: async () => {
    if (mode === 'network') throw apiError('network', 0)
    if (mode === 'expired') throw apiError('unauthorized', 401)
    return API_USER
  } }, { now: () => now, minRevalidateMs: 1000 })
  await manager.check()
  mode = 'network'
  now += 5000
  await manager.revalidate()
  assert.equal(manager.getState().status, SESSION_STATUS.AUTHENTICATED, 'queda de rede momentânea não desloga')
  mode = 'expired'
  now += 5000
  await manager.revalidate()
  assert.equal(manager.getState().status, SESSION_STATUS.ANONYMOUS)
  assert.equal(manager.getState().reason, 'expired')
})

test('revalidação não faz nada sem sessão e respeita o intervalo mínimo', async () => {
  let now = 1_000_000
  const { manager, calls } = setup({}, { now: () => now, minRevalidateMs: 30_000 })
  await manager.revalidate()
  assert.equal(calls.getSession, 0, 'sem sessão não consulta')
  await manager.check()
  now += 5_000
  await manager.revalidate()
  assert.equal(calls.getSession, 1, 'consulta recente: não repete')
  now += 31_000
  await manager.revalidate()
  assert.equal(calls.getSession, 2)
})

test('logout: POST /auth/logout, remove o usuário, limpa o store e chama onSignedOut', async () => {
  const { manager, calls } = setup()
  await manager.check()
  const result = await manager.signOut()
  assert.deepEqual(result, { ok: true })
  assert.equal(calls.logout, 1)
  assert.equal(manager.getState().status, SESSION_STATUS.ANONYMOUS)
  assert.equal(manager.getState().user, null)
  assert.equal(calls.signedOut, 1)
  assert.deepEqual(calls.userChanges, [API_USER.id, null])
})

test('logout com sessão já inválida (401) também encerra localmente', async () => {
  const { manager, calls } = setup({ logout: async () => { throw apiError('unauthorized', 401) } })
  await manager.check()
  assert.deepEqual(await manager.signOut(), { ok: true })
  assert.equal(manager.getState().status, SESSION_STATUS.ANONYMOUS)
  assert.equal(calls.signedOut, 1)
})

test('logout que falha por rede/servidor NÃO finge sair: mantém a sessão e informa a falha', async () => {
  for (const kind of ['network', 'unavailable', 'origin_not_allowed']) {
    const { manager, calls } = setup({ logout: async () => { throw apiError(kind, kind === 'network' ? 0 : 503) } })
    await manager.check()
    const result = await manager.signOut()
    assert.deepEqual(result, { ok: false, kind }, kind)
    assert.equal(manager.getState().status, SESSION_STATUS.AUTHENTICATED, kind)
    assert.equal(calls.signedOut, 0)
  }
})

test('assinantes são avisados a cada mudança e param de ser avisados ao cancelar', async () => {
  const { manager } = setup()
  let notified = 0
  const unsubscribe = manager.subscribe(() => { notified += 1 })
  await manager.check()
  const afterCheck = notified
  assert.ok(afterCheck >= 1)
  unsubscribe()
  manager.expire()
  assert.equal(notified, afterCheck)
})

test('o gerenciador não toca em storage nem guarda dado sensível fora do estado em memória', async () => {
  const touched = []
  const guard = new Proxy({}, { get: (_t, prop) => { touched.push(String(prop)); return () => null } })
  const previous = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage }
  globalThis.localStorage = guard
  globalThis.sessionStorage = guard
  try {
    const { manager } = setup()
    await manager.check()
    await manager.signOut()
  } finally {
    globalThis.localStorage = previous.localStorage
    globalThis.sessionStorage = previous.sessionStorage
  }
  assert.deepEqual(touched, [])
})
