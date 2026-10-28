import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as authStates from './authStates.js'
import * as authErrors from './authErrors.js'
import * as credentialsInput from './credentialsInput.js'
import * as inputModality from './inputModality.js'
import * as pinKeypad from './pinKeypad.js'
import * as returnTo from './returnTo.js'
import * as webauthnSupport from './webauthnSupport.js'

/**
 * Garantias ESTRUTURAIS da autenticação real, lidas direto do código-fonte
 * (sem comentários). Dizem ONDE cada capacidade perigosa pode existir:
 *
 * - rede só em `authApi.js`; API WebAuthn só em `webauthnBrowser.js` (e a
 *   detecção de suporte em `webauthnSupport.js`);
 * - nada de storage, cookie legível, console, `X-User-Id`, usuários de
 *   demonstração, token no cliente, navegação por código nem acesso ao
 *   store/api de recebimentos dentro desta feature;
 * - só há UM caminho até "autenticado": `sessionManager.readSession` →
 *   `parseSessionUser(GET /auth/me)` → `SESSION_EVENT.RESOLVED`;
 * - permissão só vem da lista `permissoes` do servidor, nunca do nome do perfil.
 *
 * Se uma etapa futura precisar de algo fora destas regras, o teste tem de ser
 * revisto de propósito — é o alarme.
 */
const DIR = fileURLToPath(new URL('.', import.meta.url))
const SOURCE_FILES = readdirSync(DIR)
  .filter((name) => ['.js', '.jsx'].includes(extname(name)) && !name.includes('.test.'))

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

const code = (name) => stripComments(readFileSync(join(DIR, name), 'utf8'))

// [padrão, rótulo, arquivos onde é permitido]
const RULES = [
  [/\bfetch\b|fetchImpl|XMLHttpRequest|WebSocket|EventSource|sendBeacon/, 'rede (fetch, XHR, sockets)', ['authApi.js']],
  [/localStorage|sessionStorage|indexedDB|caches\.|document\.cookie|cookieStore/, 'armazenamento do navegador ou cookie legível', []],
  [/navigator\.credentials|\.credentials\??\.(get|create|store)|PublicKeyCredential/, 'API WebAuthn do navegador', ['webauthnBrowser.js', 'webauthnSupport.js']],
  [/console\./, 'registro em console (poderia vazar PIN)', []],
  [/history\.(push|replace)State|window\.location\s*(=|\.(assign|replace|href\s*=|search\s*=|reload))|location\.hash\s*=|\bnavigate\s*\(/, 'navegação por código (PIN na URL)', []],
  [/X-User-Id|setApiUser|DEMO_USERS|DEMO_CURRENT_USER/, 'identidade demonstrativa ou enviada pelo cliente', []],
  [/from\s+['"]\.\.\/\.\.\/(api|store|data)(\.js)?['"]/, 'importação do domínio de recebimentos/API legada', []],
  [/Authorization|Bearer|crypto\./, 'token ou criptografia no cliente', []],
  [/\b(btoa|atob)\(/, 'codificação Base64 (só a do WebAuthn)', ['webauthnBrowser.js']],
]

test('a feature de autenticação existe como arquivos-fonte a varrer', () => {
  for (const name of ['LoginPage.jsx', 'authStates.js', 'authApi.js', 'webauthnBrowser.js', 'sessionState.js', 'sessionManager.js', 'AuthProvider.jsx', 'loginFlow.js', 'routeAccess.js']) {
    assert.ok(SOURCE_FILES.includes(name), `${name} não encontrado`)
  }
  assert.ok(SOURCE_FILES.length >= 15, `só ${SOURCE_FILES.length} arquivos encontrados`)
})

for (const [pattern, label, allowed] of RULES) {
  test(`${label}: só em ${allowed.length ? allowed.join(', ') : 'lugar nenhum da feature'}`, () => {
    for (const name of SOURCE_FILES) {
      if (allowed.includes(name)) continue
      assert.doesNotMatch(code(name), pattern, `${name} contém ${label}`)
    }
  })
}

test('a rede existe de fato onde é permitida (a varredura não está cega)', () => {
  assert.match(code('authApi.js'), /doFetch\(/)
  assert.match(code('webauthnBrowser.js'), /credentials\.get\(/)
  assert.match(code('webauthnBrowser.js'), /credentials\.create\(/)
})

test('o cliente HTTP usa caminho relativo e envia os cookies da sessão (credentials: include)', () => {
  const api = code('authApi.js')
  assert.match(api, /AUTH_API_BASE = '\/api\/v1'/)
  assert.match(api, /credentials: 'include'/)
  assert.doesNotMatch(api, /https?:\/\//, 'nada de host absoluto')
  assert.doesNotMatch(api, /VITE_/, 'a origem da sessão não é configurável')
})

test('nenhuma exportação dos módulos da máquina de telas sugere sessão, token, cookie ou usuário autenticado', () => {
  const names = [authStates, authErrors, credentialsInput, inputModality, pinKeypad, returnTo, webauthnSupport]
    .flatMap((mod) => Object.keys(mod))
  for (const name of names) {
    assert.doesNotMatch(name, /authenticated|autenticad|logged|createSession|setSession|startSession|grantAccess|token|cookie|permiss/i, name)
  }
})

test('só UM caminho cria usuário autenticado: GET /auth/me validado por parseSessionUser', () => {
  // `RESOLVED` só é emitido pelo gerenciador de sessão, depois de validar o corpo.
  for (const name of SOURCE_FILES) {
    if (['sessionManager.js', 'sessionState.js'].includes(name)) continue
    assert.doesNotMatch(code(name), /SESSION_EVENT\.RESOLVED|sessionReducer/, `${name} não pode criar sessão`)
    // Só LER/validar o formato do usuário é permitido ao porteiro das rotas (revalida; não cria nada).
    if (name !== 'accessDecision.js') assert.doesNotMatch(code(name), /parseSessionUser/, `${name} não valida sessão`)
  }
  const manager = code('sessionManager.js')
  assert.match(manager, /parseSessionUser\(payload\)/)
  assert.match(manager, /type: SESSION_EVENT\.RESOLVED, user/)
  assert.equal((manager.match(/SESSION_EVENT\.RESOLVED/g) || []).length, 1)

  // No reducer, "autenticado" só nasce no ramo RESOLVED, depois de validar o usuário.
  const state = code('sessionState.js')
  assert.equal((state.match(/make\(SESSION_STATUS\.AUTHENTICATED/g) || []).length, 1)
  assert.match(state, /case SESSION_EVENT\.RESOLVED: \{\s*const user = parseSessionUser\(event\.user\)\s*return user \? make\(SESSION_STATUS\.AUTHENTICATED, user\)/)
})

test('as telas de acesso não tocam na sessão: só leem o estado e pedem ao fluxo/gerenciador', () => {
  for (const name of ['LoginPage.jsx', 'PasskeyStep.jsx', 'PinKeypad.jsx', 'AuthLayout.jsx']) {
    assert.doesNotMatch(code(name), /SESSION_EVENT|SESSION_STATUS|sessionReducer|parseSessionUser|createSessionManager/, name)
  }
  const provider = code('AuthProvider.jsx')
  assert.doesNotMatch(provider, /RESOLVED/)
  assert.match(provider, /status: session\.status/)
})

test('a tela de login só emite SUBMIT, BACK e RETRY; os demais eventos vêm do fluxo real', () => {
  const login = code('LoginPage.jsx')
  assert.match(login, /type: AUTH_EVENT\.SUBMIT_CREDENTIALS/)
  assert.match(login, /type: AUTH_EVENT\.BACK/)
  assert.match(login, /type: AUTH_EVENT\.RETRY/)
  for (const event of ['SECOND_FACTOR_REQUIRED', 'NO_PASSKEY', 'CREDENTIALS_REJECTED', 'CONNECTION_FAILED', 'SECOND_FACTOR_INTERRUPTED', 'SECOND_FACTOR_FAILED', 'SECOND_FACTOR_UNSUPPORTED']) {
    assert.doesNotMatch(login, new RegExp(`AUTH_EVENT\\.${event}`), `LoginPage não pode fabricar ${event}`)
  }
})

test('sem fluxo real (pré-visualização/sem Provider) o envio só mostra o aviso de ambiente sem acesso', () => {
  const login = code('LoginPage.jsx')
  assert.match(login, /NOT_AVAILABLE_COPY/)
  assert.match(login, /if \(flow\) \{\s*void flow\.start\(\{ matricula, pin: submittedPin \}\)\s*return\s*\}/)
})

test('permissão vem só da lista do servidor: nenhum código compara perfil ou papel para decidir acesso', () => {
  for (const name of SOURCE_FILES) {
    const source = code(name)
    assert.doesNotMatch(source, /\.(perfil|role)\s*(===|!==|==|!=)|\b(perfil|role)\s*(===|!==)|switch\s*\(\s*[\w.]*\.(perfil|papeis)\b/, `${name} decide por perfil`)
    assert.doesNotMatch(source, /papeis\.(includes|some|find|indexOf)\(/, `${name} decide por papel`)
    assert.doesNotMatch(source, /canShow|ROLE_/, name)
    if (name !== 'sessionState.js') {
      assert.doesNotMatch(source, /\b(ADMINISTRADOR|ALMOXARIFADO|PORTARIA|SUPRIMENTOS|CONSULTA)\b/, `${name} cita nome de perfil`)
    }
  }
  // O único uso dos nomes é o rótulo de exibição do perfil.
  assert.match(code('sessionState.js'), /LEGACY_PROFILE_LABEL/)
  assert.match(code('routeAccess.js'), /hasPermission\(user, permission\)/)
})

test('o PIN é limpo do campo ao enviar e só passa por uma constante local até o corpo da requisição', () => {
  const login = code('LoginPage.jsx')
  assert.match(login, /setPin\(''\)/)
  assert.equal((login.match(/submittedPin/g) || []).length, 2, 'declaração + chamada a flow.start')
  // Nada de cópia em ref, window ou globais.
  assert.doesNotMatch(login, /window\.[a-zA-Z_]+\s*=|globalThis\.|pinRef\.current\.value\s*[^=]/)
  // O fluxo nunca guarda nem emite o PIN.
  const flow = code('loginFlow.js')
  assert.equal((flow.match(/\bpin\b/g) || []).length, 2, 'só o parâmetro de start e o repasse à api')
})
