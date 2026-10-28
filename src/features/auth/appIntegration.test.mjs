import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Pontos de integração FORA da feature (src/api.js, src/App.jsx, layout), lidos
 * do código-fonte: a identidade vem da sessão do servidor, o app autenticado
 * só monta atrás do porteiro e o menu respeita as permissões.
 */
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

test('api.js: sem X-User-Id nem usuário em storage; cookies da sessão sempre; 401 avisa o Provider', () => {
  const api = strip(read('../../api.js'))
  assert.doesNotMatch(api, /X-User-Id|setApiUser|localStorage|sessionStorage|USER_KEY/)
  assert.match(api, /credentials: 'include'/)
  // O 401 só encerra a sessão se a requisição é da geração atual (ver storeSessionIsolation.test.mjs).
  assert.match(api, /if \(response\.status === 401 && generation === sessionGeneration\) unauthorizedHandler\?\.\(\)/)
  assert.match(api, /export function setUnauthorizedHandler\(handler\)/)
})

test('App.jsx: o app autenticado só monta dentro do porteiro (AccessGate), com o Provider acima', () => {
  const app = strip(read('../../App.jsx'))
  assert.match(app, /<AuthProvider onUserChange=\{handleSessionUser\}>/)
  assert.match(app, /<AccessGate[\s\S]*renderApp=\{\(\) => <AuthenticatedApp route=\{route\} theme=\{theme\} toggleTheme=\{toggleTheme\} \/>\}/)
  assert.equal((app.match(/<AuthenticatedApp\b/g) || []).length, 1, 'AuthenticatedApp só é montado pelo porteiro')
  assert.equal((app.match(/<LoginPage\b/g) || []).length, 1)
  assert.match(app, /renderLogin=\{\(\) => <LoginPage \/>\}/)
  assert.match(app, /renderActivate=\{\(\) => <ActivatePasskeyPage \/>\}/)
  // O Provider fica DENTRO do de notificações e ACIMA de qualquer tela.
  assert.ok(app.indexOf('<NotificationsProvider>') < app.indexOf('<AuthProvider'))
  assert.ok(app.indexOf('<AuthProvider') < app.indexOf('<AccessGate'))
})

test('App.jsx: o usuário do store vem da sessão (toStoreUser) e os dados somem ao sair', () => {
  const app = strip(read('../../App.jsx'))
  assert.match(app, /setCurrentUser\(toStoreUser\(user\)\)/)
  assert.match(app, /if \(!user\) \{[\s\S]*resetDemoData\(\)/)
  assert.match(app, /void retryInitialLoad\(\)/)
  assert.match(app, /setUnauthorizedHandler\(expireSession\)/)
  assert.doesNotMatch(app, /DEMO_CURRENT_USER|DEMO_USERS/)
})

test('App.jsx: "Meus dispositivos" e o menu respeitam a sessão; sair avisa quando falha', () => {
  const app = strip(read('../../App.jsx'))
  assert.match(app, /AUTH_ROUTES\.devices/)
  assert.match(app, /canAccess: \(path\) => canAccessPath\(auth\.user, path\)/)
  assert.match(app, /<UserMenu/)
  assert.match(app, /pushToast\('Não foi possível sair'/)
  assert.doesNotMatch(app, /Perfil demonstrativo|autenticação corporativa será conectada/)
})

test('menus: Sidebar e MobileNav escondem o que a sessão não libera; sem o filtro tudo aparece como antes', () => {
  const sidebar = strip(read('../../layout/Sidebar.jsx'))
  const mobile = strip(read('../../layout/MobileNav.jsx'))
  for (const source of [sidebar, mobile]) {
    assert.match(source, /canAccess = \(\) => true/)
    assert.match(source, /canAccess\(other\.home\)/)
  }
  assert.match(sidebar, /\.filter\(\(item\) => canAccess\(item\.path\)\)/)
  assert.match(mobile, /primary\.filter\(\(item\) => canAccess\(item\.path\)\)/)
  assert.match(mobile, /more\.filter\(\(item\) => canAccess\(item\.path\)\)/)
})

test('o frontend não envia mais X-User-Id em lugar nenhum (identidade só pela sessão do servidor)', () => {
  for (const file of ['../../api.js', '../../App.jsx', '../../store.js', '../../layout/Sidebar.jsx', '../../layout/MobileNav.jsx', '../../layout/navigation.js']) {
    assert.doesNotMatch(strip(read(file)), /X-User-Id/, file)
  }
})
