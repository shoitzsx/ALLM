import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTH_ROUTES, PUBLIC_PATHS, canAccessPath, homePathFor, isPublicPath, requiredPermission } from './routeAccess.js'
import { parseSessionUser } from './sessionState.js'
import { AREAS, AREA_CONFIG, ROUTES } from '../../layout/navigation.js'

/**
 * Isolamento de permissões na interface. É só a camada de apresentação:
 * o backend recusa de verdade (403) cada operação sem permissão. Aqui as
 * telas deixam de aparecer/abrir para quem o servidor não autorizou.
 * Permissões conferidas contra backend/auth/postgresAuth.mjs (capabilityMap).
 */
const PROFILES = {
  ADMINISTRADOR: ['catalogos.read', 'authenticators.manage', 'usuarios.read', 'chegadas.read', 'chegadas.create', 'recebimentos.read', 'recebimentos.create', 'recebimentos.update', 'anexos.read', 'anexos.write', 'dashboard.read'],
  ALMOXARIFADO: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'recebimentos.create', 'recebimentos.update', 'anexos.read', 'anexos.write', 'dashboard.read'],
  PORTARIA: ['catalogos.read', 'chegadas.read', 'chegadas.create'],
  SUPRIMENTOS: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'anexos.read', 'dashboard.read'],
  CONSULTA: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'anexos.read', 'dashboard.read'],
}
const userOf = (perfil, permissoes = PROFILES[perfil]) => parseSessionUser({
  id: '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01', matricula: '000123', nome: 'Teste', perfil, papeis: [perfil], permissoes,
})

test('rotas públicas: só login e ativação de passkey; todo o resto exige sessão', () => {
  assert.deepEqual([...PUBLIC_PATHS].sort(), ['/ativar-passkey', '/login'])
  assert.equal(isPublicPath(ROUTES.login), true)
  assert.equal(isPublicPath(AUTH_ROUTES.activate), true)
  for (const path of ['/', '/recebimentos', '/recebimentos/REC-1', '/novo', '/pendencias', '/leitura-automatica', '/portaria', '/portaria/registrar', '/visualizacao', AUTH_ROUTES.devices, '/qualquer']) {
    assert.equal(isPublicPath(path), false, path)
  }
})

test('cada tela de dados exige a permissão do endpoint que a alimenta', () => {
  assert.equal(requiredPermission(ROUTES.dashboard), 'dashboard.read')
  assert.equal(requiredPermission(ROUTES.receipts), 'recebimentos.read')
  assert.equal(requiredPermission('/recebimentos/REC-2026-0001'), 'recebimentos.read')
  assert.equal(requiredPermission(ROUTES.newReceipt), 'recebimentos.create')
  assert.equal(requiredPermission(ROUTES.pending), 'recebimentos.read')
  assert.equal(requiredPermission(ROUTES.visualizacao), 'recebimentos.read')
  assert.equal(requiredPermission(ROUTES.nfeReader), 'recebimentos.create')
  assert.equal(requiredPermission(ROUTES.portaria), 'chegadas.read')
  assert.equal(requiredPermission(ROUTES.portariaRegistrar), 'chegadas.create')
  assert.equal(requiredPermission('/portaria/outra'), 'chegadas.read')
  assert.equal(requiredPermission(AUTH_ROUTES.devices), null, 'qualquer usuário autenticado gerencia os PRÓPRIOS dispositivos')
})

test('Portaria não entra no Almoxarifado e o Almoxarifado não registra chegadas', () => {
  const portaria = userOf('PORTARIA')
  for (const path of ['/', '/recebimentos', '/recebimentos/REC-1', '/novo', '/pendencias', '/visualizacao', '/leitura-automatica']) {
    assert.equal(canAccessPath(portaria, path), false, `Portaria não deve abrir ${path}`)
  }
  assert.equal(canAccessPath(portaria, ROUTES.portaria), true)
  assert.equal(canAccessPath(portaria, ROUTES.portariaRegistrar), true)

  const almox = userOf('ALMOXARIFADO')
  assert.equal(canAccessPath(almox, ROUTES.dashboard), true)
  assert.equal(canAccessPath(almox, ROUTES.newReceipt), true)
  assert.equal(canAccessPath(almox, ROUTES.portaria), true, 'pode ver o painel (chegadas.read)')
  assert.equal(canAccessPath(almox, ROUTES.portariaRegistrar), false, 'não tem chegadas.create')
})

test('Suprimentos e Consulta leem, mas não criam', () => {
  for (const perfil of ['SUPRIMENTOS', 'CONSULTA']) {
    const user = userOf(perfil)
    assert.equal(canAccessPath(user, ROUTES.receipts), true, perfil)
    assert.equal(canAccessPath(user, ROUTES.dashboard), true, perfil)
    assert.equal(canAccessPath(user, ROUTES.newReceipt), false, perfil)
    assert.equal(canAccessPath(user, ROUTES.nfeReader), false, perfil)
    assert.equal(canAccessPath(user, ROUTES.portariaRegistrar), false, perfil)
  }
})

test('o nome do perfil não abre nada: sem permissões, nem o ADMINISTRADOR entra', () => {
  const admin = userOf('ADMINISTRADOR', [])
  for (const path of [ROUTES.dashboard, ROUTES.receipts, ROUTES.newReceipt, ROUTES.portaria, ROUTES.portariaRegistrar]) {
    assert.equal(canAccessPath(admin, path), false, path)
  }
  assert.equal(canAccessPath(admin, AUTH_ROUTES.devices), true, 'autenticado ainda gerencia os próprios dispositivos')
  assert.equal(homePathFor(admin), null)
})

test('sem sessão nada é acessível, exceto as rotas públicas', () => {
  for (const path of ['/', '/recebimentos', '/portaria', AUTH_ROUTES.devices]) assert.equal(canAccessPath(null, path), false, path)
  assert.equal(canAccessPath(null, ROUTES.login), true)
  assert.equal(canAccessPath(null, AUTH_ROUTES.activate), true)
})

test('rota desconhecida exige sessão mas não dados (a tela "não encontrada" não vaza nada)', () => {
  assert.equal(requiredPermission('/rota-que-nao-existe'), null)
  assert.equal(canAccessPath(userOf('PORTARIA'), '/rota-que-nao-existe'), true)
  assert.equal(canAccessPath(null, '/rota-que-nao-existe'), false)
})

test('página inicial depende do que o servidor autorizou', () => {
  assert.equal(homePathFor(userOf('ADMINISTRADOR')), ROUTES.dashboard)
  assert.equal(homePathFor(userOf('ALMOXARIFADO')), ROUTES.dashboard)
  assert.equal(homePathFor(userOf('CONSULTA')), ROUTES.dashboard)
  assert.equal(homePathFor(userOf('PORTARIA')), ROUTES.portaria)
  assert.equal(homePathFor(userOf('X', ['recebimentos.read'])), ROUTES.receipts)
  assert.equal(homePathFor(userOf('X', ['catalogos.read'])), null)
  assert.equal(homePathFor(null), null)
})

test('cada área do menu só é acessível a quem tem a permissão da sua página inicial', () => {
  const portaria = userOf('PORTARIA')
  assert.equal(canAccessPath(portaria, AREA_CONFIG[AREAS.portaria].home), true)
  assert.equal(canAccessPath(portaria, AREA_CONFIG[AREAS.almoxarifado].home), false)
  const almox = userOf('ALMOXARIFADO')
  assert.equal(canAccessPath(almox, AREA_CONFIG[AREAS.almoxarifado].home), true)
  assert.equal(canAccessPath(almox, AREA_CONFIG[AREAS.portaria].home), true)
})

test('todo item de menu tem uma regra explícita (nada fica aberto por esquecimento)', () => {
  const items = [...AREA_CONFIG[AREAS.almoxarifado].items, ...AREA_CONFIG[AREAS.portaria].items]
  for (const item of items) {
    assert.match(String(requiredPermission(item.path)), /^[a-z]+\.[a-z]+$/, `${item.path} sem permissão exigida`)
  }
})

test('caminhos com enfeites (barra final, consulta, maiúsculas) não escapam da regra', () => {
  const portaria = userOf('PORTARIA')
  assert.equal(canAccessPath(portaria, '/recebimentos/'), false)
  assert.equal(canAccessPath(portaria, '/recebimentos?x=1'), false)
  assert.equal(canAccessPath(portaria, '/novo/'), false)
  assert.equal(canAccessPath(null, '/login/'), true)
  assert.equal(canAccessPath(null, '/loginx'), false)
  assert.equal(canAccessPath(portaria, '/portaria/registrar?x=1'), true)
})
