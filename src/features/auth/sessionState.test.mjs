import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_EVENT,
  SESSION_STATUS,
  createInitialSession,
  hasPermission,
  parseSessionUser,
  sessionReducer,
  toStoreUser,
} from './sessionState.js'

/** Formato REAL de GET /auth/me (backend/auth/postgresAuth.mjs → publicUser). */
const apiUser = (overrides = {}) => ({
  id: '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01',
  matricula: '000123',
  nome: 'Pessoa de Teste',
  perfil: 'ALMOXARIFADO',
  papeis: ['ALMOXARIFADO'],
  permissoes: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'recebimentos.create'],
  ...overrides,
})

test('usuário válido do /auth/me é aceito como veio, com permissões do servidor', () => {
  const user = parseSessionUser(apiUser())
  assert.equal(user.id, '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01')
  assert.equal(user.matricula, '000123', 'zeros à esquerda preservados (texto)')
  assert.equal(user.perfil, 'ALMOXARIFADO')
  assert.deepEqual(user.permissoes, ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'recebimentos.create'])
  assert.ok(Object.isFrozen(user) && Object.isFrozen(user.permissoes) && Object.isFrozen(user.papeis))
})

test('corpo fora do contrato nunca vira usuário (e portanto nunca vira acesso)', () => {
  const invalid = [
    null, undefined, 'x', 42, [], {},
    apiUser({ id: '' }), apiUser({ id: 123 }), apiUser({ id: 'não-uuid' }),
    apiUser({ matricula: 123 }), apiUser({ nome: '' }), apiUser({ perfil: '' }), apiUser({ perfil: 7 }),
    apiUser({ papeis: 'x' }), apiUser({ papeis: [1] }),
    apiUser({ permissoes: 'recebimentos.read' }), apiUser({ permissoes: null }), apiUser({ permissoes: [{}] }),
    { id: '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01', nome: 'Legado', perfil: 'Administrador' }, // formato do backend legado (X-User-Id)
  ]
  for (const value of invalid) assert.equal(parseSessionUser(value), null, JSON.stringify(value)?.slice(0, 80))
})

test('permissões desconhecidas ou malformadas são descartadas; nada é inventado', () => {
  const user = parseSessionUser(apiUser({ permissoes: ['recebimentos.read', 'ADMIN!!', '', 'x'.repeat(100), 'recebimentos.read'] }))
  assert.deepEqual(user.permissoes, ['recebimentos.read'])
})

test('o nome do perfil NÃO concede nada: só a lista de permissões do servidor vale', () => {
  const admin = parseSessionUser(apiUser({ perfil: 'ADMINISTRADOR', papeis: ['ADMINISTRADOR'], permissoes: [] }))
  assert.equal(hasPermission(admin, 'recebimentos.read'), false)
  assert.equal(hasPermission(admin, 'authenticators.manage'), false)
  const portaria = parseSessionUser(apiUser({ perfil: 'PORTARIA', papeis: ['PORTARIA'], permissoes: ['chegadas.read', 'chegadas.create'] }))
  assert.equal(hasPermission(portaria, 'chegadas.create'), true)
  assert.equal(hasPermission(portaria, 'recebimentos.read'), false)
  assert.equal(hasPermission(null, 'chegadas.read'), false)
  assert.equal(hasPermission(portaria, ''), false)
  assert.equal(hasPermission(portaria, undefined), false)
})

test('sessão começa verificando: ninguém está autenticado até o servidor confirmar', () => {
  const state = createInitialSession()
  assert.equal(state.status, SESSION_STATUS.CHECKING)
  assert.equal(state.user, null)
  assert.equal(state.reason, null)
})

test('só RESOLVED com usuário válido autentica; usuário inválido derruba para anônimo', () => {
  const ok = sessionReducer(createInitialSession(), { type: SESSION_EVENT.RESOLVED, user: apiUser() })
  assert.equal(ok.status, SESSION_STATUS.AUTHENTICATED)
  assert.equal(ok.user.matricula, '000123')
  for (const user of [null, undefined, {}, apiUser({ permissoes: 'x' }), 'admin']) {
    const state = sessionReducer(createInitialSession(), { type: SESSION_EVENT.RESOLVED, user })
    assert.equal(state.status, SESSION_STATUS.ANONYMOUS, JSON.stringify(user))
    assert.equal(state.user, null)
  }
})

test('nenhum outro evento cria usuário autenticado', () => {
  for (const type of [SESSION_EVENT.NONE, SESSION_EVENT.UNAVAILABLE, SESSION_EVENT.CHECKING, SESSION_EVENT.SIGNED_OUT, SESSION_EVENT.EXPIRED, 'qualquer', undefined]) {
    const state = sessionReducer(createInitialSession(), { type, user: apiUser() })
    assert.notEqual(state.status, SESSION_STATUS.AUTHENTICATED, String(type))
    assert.equal(state.user, null)
  }
})

test('sessão encerrada, expirada ou sem cookie remove o usuário; expiração só vale se estava autenticado', () => {
  const authed = sessionReducer(createInitialSession(), { type: SESSION_EVENT.RESOLVED, user: apiUser() })
  const expired = sessionReducer(authed, { type: SESSION_EVENT.EXPIRED })
  assert.equal(expired.status, SESSION_STATUS.ANONYMOUS)
  assert.equal(expired.user, null)
  assert.equal(expired.reason, 'expired')
  const none = sessionReducer(authed, { type: SESSION_EVENT.NONE })
  assert.equal(none.user, null)
  assert.equal(none.reason, 'expired', 'perdeu a sessão que tinha → mostra "sua sessão expirou"')
  const firstVisit = sessionReducer(createInitialSession(), { type: SESSION_EVENT.NONE })
  assert.equal(firstVisit.reason, null, 'quem nunca entrou não vê "expirou"')
  const alreadyAnonymousExpired = sessionReducer(firstVisit, { type: SESSION_EVENT.EXPIRED })
  assert.equal(alreadyAnonymousExpired.reason, null)
  const out = sessionReducer(authed, { type: SESSION_EVENT.SIGNED_OUT })
  assert.equal(out.status, SESSION_STATUS.ANONYMOUS)
  assert.equal(out.reason, 'signed_out')
})

test('backend indisponível ao verificar a sessão: NÃO autentica e NÃO mantém usuário', () => {
  const authed = sessionReducer(createInitialSession(), { type: SESSION_EVENT.RESOLVED, user: apiUser() })
  const down = sessionReducer(authed, { type: SESSION_EVENT.UNAVAILABLE })
  assert.equal(down.status, SESSION_STATUS.UNAVAILABLE)
  assert.equal(down.user, null)
})

test('estados são imutáveis e eventos desconhecidos devolvem o mesmo estado', () => {
  const state = createInitialSession()
  assert.ok(Object.isFrozen(state))
  assert.equal(sessionReducer(state, { type: 'sem-sentido' }), state)
  assert.equal(sessionReducer(state, undefined), state)
})

test('usuário no formato do store local: perfil legível, id e nome da sessão, permissões do servidor', () => {
  const user = parseSessionUser(apiUser({ perfil: 'ADMINISTRADOR', papeis: ['ADMINISTRADOR'] }))
  const local = toStoreUser(user)
  assert.equal(local.id, user.id)
  assert.equal(local.nome, 'Pessoa de Teste')
  assert.equal(local.name, 'Pessoa de Teste')
  assert.equal(local.perfil, 'Administrador')
  assert.equal(local.role, 'Administrador')
  assert.deepEqual(local.permissoes, user.permissoes)
  assert.equal(toStoreUser(parseSessionUser(apiUser({ perfil: 'CONSULTA' }))).perfil, 'Consulta')
  assert.equal(toStoreUser(parseSessionUser(apiUser({ perfil: 'PORTARIA' }))).perfil, 'Portaria')
  assert.equal(toStoreUser(parseSessionUser(apiUser({ perfil: 'NOVO_PERFIL' }))).perfil, 'Novo_perfil', 'perfil desconhecido só é exibido, não ganha poder')
  assert.equal(toStoreUser(null), null)
})
