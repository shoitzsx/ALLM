import test from 'node:test'
import assert from 'node:assert/strict'
import { ACCESS, decideAccess } from './accessDecision.js'
import { SESSION_STATUS, parseSessionUser } from './sessionState.js'
import { AUTH_ROUTES } from './routeAccess.js'

/**
 * Decisão do porteiro das rotas. Entradas: o estado da sessão (confirmado pelo
 * servidor) e a rota pedida. Saída: o que mostrar. Nada de "modo demonstração":
 * sem sessão confirmada só existem login e ativação de passkey.
 */
const PERMS = {
  ALMOXARIFADO: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'recebimentos.create', 'dashboard.read'],
  PORTARIA: ['catalogos.read', 'chegadas.read', 'chegadas.create'],
}
const userOf = (perfil, permissoes = PERMS[perfil]) => parseSessionUser({
  id: '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01', matricula: '000123', nome: 'Teste', perfil, papeis: [perfil], permissoes,
})
const q = (text = '') => new URLSearchParams(text)
const decide = (status, user, path, query = q()) => decideAccess({ status, user, route: { path, query } })

test('verificando a sessão: nada do app aparece, nem o login', () => {
  for (const path of ['/', '/recebimentos', '/login', '/portaria']) {
    assert.deepEqual(decide(SESSION_STATUS.CHECKING, null, path), { action: ACCESS.LOADING }, path)
  }
})

test('servidor indisponível: aviso com "tentar de novo", sem acesso, em qualquer rota protegida', () => {
  for (const path of ['/', '/recebimentos', '/portaria', '/login']) {
    assert.deepEqual(decide(SESSION_STATUS.UNAVAILABLE, null, path), { action: ACCESS.UNAVAILABLE }, path)
  }
})

test('sem sessão: login e ativação são as únicas telas; o resto vai para o login guardando o destino', () => {
  assert.deepEqual(decide(SESSION_STATUS.ANONYMOUS, null, '/login'), { action: ACCESS.LOGIN })
  assert.deepEqual(decide(SESSION_STATUS.ANONYMOUS, null, AUTH_ROUTES.activate), { action: ACCESS.ACTIVATE })
  assert.deepEqual(decide(SESSION_STATUS.ANONYMOUS, null, '/'), { action: ACCESS.REDIRECT, to: '/login' })
  assert.deepEqual(decide(SESSION_STATUS.ANONYMOUS, null, '/recebimentos'), { action: ACCESS.REDIRECT, to: '/login?returnTo=%2Frecebimentos' })
  assert.deepEqual(decide(SESSION_STATUS.ANONYMOUS, null, '/recebimentos/REC-1', q('q=abc')), { action: ACCESS.REDIRECT, to: '/login?returnTo=%2Frecebimentos%2FREC-1%3Fq%3Dabc' })
  assert.deepEqual(decide(SESSION_STATUS.ANONYMOUS, null, '/portaria/registrar'), { action: ACCESS.REDIRECT, to: '/login?returnTo=%2Fportaria%2Fregistrar' })
})

test('o retorno nunca carrega dado sensível: parâmetro com PIN/matrícula/token é descartado', () => {
  const result = decide(SESSION_STATUS.ANONYMOUS, null, '/recebimentos', q('pin=1234'))
  assert.deepEqual(result, { action: ACCESS.REDIRECT, to: '/login' })
})

test('"autenticado" sem usuário válido NÃO é acesso (estado incoerente cai no login)', () => {
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, null, '/recebimentos'), { action: ACCESS.REDIRECT, to: '/login?returnTo=%2Frecebimentos' })
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, {}, '/'), { action: ACCESS.REDIRECT, to: '/login' })
  assert.deepEqual(decide('qualquer-coisa', userOf('ALMOXARIFADO'), '/'), { action: ACCESS.REDIRECT, to: '/login' })
  assert.deepEqual(decide(undefined, userOf('ALMOXARIFADO'), '/'), { action: ACCESS.REDIRECT, to: '/login' })
})

test('com sessão e permissão: o app abre', () => {
  const almox = userOf('ALMOXARIFADO')
  for (const path of ['/', '/recebimentos', '/recebimentos/REC-1', '/novo', '/pendencias', '/portaria', AUTH_ROUTES.devices, '/rota-inexistente']) {
    assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, almox, path), { action: ACCESS.APP }, path)
  }
})

test('isolamento: Portaria cai na própria área quando pede o Almoxarifado; Almoxarifado não registra chegada', () => {
  const portaria = userOf('PORTARIA')
  for (const path of ['/', '/recebimentos', '/novo', '/pendencias', '/visualizacao', '/leitura-automatica']) {
    assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, portaria, path), { action: ACCESS.REDIRECT, to: '/portaria' }, path)
  }
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, portaria, '/portaria/registrar'), { action: ACCESS.APP })
  const almox = userOf('ALMOXARIFADO')
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, almox, '/portaria/registrar'), { action: ACCESS.REDIRECT, to: '/' })
})

test('conta sem nenhuma permissão de tela: "sem acesso" (e continua podendo ver os próprios dispositivos)', () => {
  const empty = userOf('ADMINISTRADOR', [])
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, empty, '/'), { action: ACCESS.DENIED })
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, empty, '/portaria'), { action: ACCESS.DENIED })
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, empty, AUTH_ROUTES.devices), { action: ACCESS.APP })
})

test('/login com sessão válida entra no destino de retorno permitido, ou na página inicial', () => {
  const almox = userOf('ALMOXARIFADO')
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, almox, '/login'), { action: ACCESS.REDIRECT, to: '/' })
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, almox, '/login', q('returnTo=%2Frecebimentos%2FREC-1')), { action: ACCESS.REDIRECT, to: '/recebimentos/REC-1' })
  // Destino que a conta não pode abrir → página inicial dela.
  const portaria = userOf('PORTARIA')
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, portaria, '/login', q('returnTo=%2Frecebimentos')), { action: ACCESS.REDIRECT, to: '/portaria' })
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, portaria, '/login'), { action: ACCESS.REDIRECT, to: '/portaria' })
  // Sem página inicial: meus dispositivos.
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, userOf('X', []), '/login'), { action: ACCESS.REDIRECT, to: AUTH_ROUTES.devices })
})

test('retorno hostil é ignorado: externo, javascript:, protocolo relativo, de volta ao login', () => {
  const almox = userOf('ALMOXARIFADO')
  for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/login', '/%2Fevil.example', '\\evil']) {
    const result = decide(SESSION_STATUS.AUTHENTICATED, almox, '/login', q(`returnTo=${encodeURIComponent(bad)}`))
    assert.deepEqual(result, { action: ACCESS.REDIRECT, to: '/' }, bad)
  }
})

test('ativação de passkey é sempre acessível, com ou sem sessão (mas nunca durante a verificação nem sem checar)', () => {
  assert.deepEqual(decide(SESSION_STATUS.AUTHENTICATED, userOf('ALMOXARIFADO'), AUTH_ROUTES.activate), { action: ACCESS.ACTIVATE })
  assert.deepEqual(decide(SESSION_STATUS.ANONYMOUS, null, AUTH_ROUTES.activate), { action: ACCESS.ACTIVATE })
})

test('depois de SAIR por vontade própria o login abre limpo (sem returnTo); expiração continua guardando o destino', () => {
  const out = decideAccess({ status: SESSION_STATUS.ANONYMOUS, user: null, route: { path: '/recebimentos', query: q() }, reason: 'signed_out' })
  assert.deepEqual(out, { action: ACCESS.REDIRECT, to: '/login' })
  const expired = decideAccess({ status: SESSION_STATUS.ANONYMOUS, user: null, route: { path: '/recebimentos', query: q() }, reason: 'expired' })
  assert.deepEqual(expired, { action: ACCESS.REDIRECT, to: '/login?returnTo=%2Frecebimentos' })
  // O login em si continua sendo o login.
  assert.deepEqual(decideAccess({ status: SESSION_STATUS.ANONYMOUS, user: null, route: { path: '/login', query: q() }, reason: 'signed_out' }), { action: ACCESS.LOGIN })
})
