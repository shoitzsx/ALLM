import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AREAS,
  AREA_CONFIG,
  ROUTES,
  getAreaForPath,
  getMobileNavItems,
  getNavItems,
  isRouteActive,
} from './navigation.js'

// Fase 1 — contrato da navegação por área. O comportamento real (cliques, voltar/avançar,
// recarregar, menu "Mais") é verificado no navegador; aqui fica o contrato que os três
// componentes de layout (Sidebar, MobileNav, MobileHeader) leem.

const route = (path) => ({ path, query: new URLSearchParams() })
const paths = (items) => items.map((item) => item.path)

test('rotas legadas continuam com o mesmo endereço', () => {
  assert.equal(ROUTES.dashboard, '/')
  assert.equal(ROUTES.receipts, '/recebimentos')
  assert.equal(ROUTES.newReceipt, '/novo')
  assert.equal(ROUTES.pending, '/pendencias')
  assert.equal(ROUTES.nfeReader, '/leitura-automatica')
  assert.equal(ROUTES.portaria, '/portaria')
  assert.equal(ROUTES.visualizacao, '/visualizacao')
  assert.equal(ROUTES.login, '/login')
})

test('cada rota pertence a uma única área: Portaria só sob /portaria, o resto é Almoxarifado', () => {
  for (const path of ['/', '/recebimentos', '/recebimentos/REC-1', '/novo', '/pendencias', '/leitura-automatica', '/visualizacao', '/rota-inexistente']) {
    assert.equal(getAreaForPath(path), AREAS.almoxarifado, path)
  }
  for (const path of ['/portaria', '/portaria/registrar', '/portaria/qualquer']) {
    assert.equal(getAreaForPath(path), AREAS.portaria, path)
  }
  // prefixo parecido não é a Portaria
  assert.equal(getAreaForPath('/portarias'), AREAS.almoxarifado)
})

test('menu do Almoxarifado: os cinco fluxos na ordem combinada, mais a Leitura automática (beta), sem nada da Portaria', () => {
  const items = getNavItems(AREAS.almoxarifado)
  assert.deepEqual(paths(items), ['/', '/recebimentos', '/novo', '/pendencias', '/visualizacao', '/leitura-automatica'])
  assert.deepEqual(items.map((item) => item.label), ['Visão geral', 'Recebimentos', 'Novo recebimento', 'Pendências', 'Visualização', 'Leitura automática'])
  assert.equal(items.find((item) => item.path === '/leitura-automatica').beta, true)
  assert.ok(items.every((item) => getAreaForPath(item.path) === AREAS.almoxarifado))
})

test('menu da Portaria: só o que existe hoje (painel e registro de chegada), sem nada do Almoxarifado', () => {
  const items = getNavItems(AREAS.portaria)
  assert.deepEqual(paths(items), ['/portaria', '/portaria/registrar'])
  assert.deepEqual(items.map((item) => item.label), ['Painel do dia', 'Registrar chegada'])
  assert.ok(items.every((item) => getAreaForPath(item.path) === AREAS.portaria))
})

test('nenhum menu repete destino, e toda rota legada (fora o login) aparece em exatamente um menu', () => {
  const all = [...getNavItems(AREAS.almoxarifado), ...getNavItems(AREAS.portaria)]
  assert.equal(new Set(paths(all)).size, all.length)
  for (const [name, path] of Object.entries(ROUTES)) {
    if (name === 'login') continue
    assert.equal(all.filter((item) => item.path === path).length, 1, `${name} (${path})`)
  }
  assert.equal(all.some((item) => item.path === ROUTES.login), false)
})

test('cada área sabe para onde trocar e qual é a sua página inicial', () => {
  assert.equal(AREA_CONFIG[AREAS.almoxarifado].home, '/')
  assert.equal(AREA_CONFIG[AREAS.portaria].home, '/portaria')
  assert.equal(AREA_CONFIG[AREAS.almoxarifado].switchTo, AREAS.portaria)
  assert.equal(AREA_CONFIG[AREAS.portaria].switchTo, AREAS.almoxarifado)
  assert.notEqual(AREA_CONFIG[AREAS.almoxarifado].label, AREA_CONFIG[AREAS.portaria].label)
})

test('barra inferior: no máximo quatro destinos fixos + "Mais"; o resto vai para "Mais", sem repetir', () => {
  const almox = getMobileNavItems(AREAS.almoxarifado)
  assert.deepEqual(paths(almox.primary), ['/', '/recebimentos', '/novo', '/pendencias'])
  assert.deepEqual(paths(almox.more), ['/visualizacao', '/leitura-automatica'])
  const portaria = getMobileNavItems(AREAS.portaria)
  assert.deepEqual(paths(portaria.primary), ['/portaria', '/portaria/registrar'])
  assert.deepEqual(paths(portaria.more), [])
  for (const area of [AREAS.almoxarifado, AREAS.portaria]) {
    const { primary, more } = getMobileNavItems(area)
    assert.ok(primary.length <= 4)
    assert.equal(primary.length + more.length, getNavItems(area).length)
    assert.equal(new Set([...paths(primary), ...paths(more)]).size, getNavItems(area).length)
  }
})

test('a ação principal de cada área (Novo recebimento / Registrar chegada) fica fixa na barra inferior', () => {
  assert.ok(getMobileNavItems(AREAS.almoxarifado).primary.some((item) => item.path === '/novo' && item.primaryAction))
  assert.ok(getMobileNavItems(AREAS.portaria).primary.some((item) => item.path === '/portaria/registrar' && item.primaryAction))
})

test('item ativo: Recebimentos cobre o detalhe; Painel do dia e Registrar chegada não se acendem juntos', () => {
  assert.equal(isRouteActive(route('/recebimentos/REC-1'), '/recebimentos'), true)
  assert.equal(isRouteActive(route('/'), '/'), true)
  assert.equal(isRouteActive(route('/novo'), '/'), false)
  assert.equal(isRouteActive(route('/portaria'), '/portaria'), true)
  assert.equal(isRouteActive(route('/portaria/registrar'), '/portaria'), false)
  assert.equal(isRouteActive(route('/portaria/registrar'), '/portaria/registrar'), true)
  for (const area of [AREAS.almoxarifado, AREAS.portaria]) {
    for (const item of getNavItems(area)) {
      const activos = getNavItems(area).filter((other) => isRouteActive(route(item.path), other.path))
      assert.deepEqual(paths(activos), [item.path], `ao abrir ${item.path}`)
    }
  }
})
