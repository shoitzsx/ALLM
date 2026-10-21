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
 * Evidência estrutural de que a N-2.1 não cria sessão: o código-fonte da
 * feature (sem comentários) não toca em nenhuma API capaz de autenticar,
 * guardar credencial, falar com servidor ou colocar dados na URL. Se alguém
 * precisar de uma delas numa etapa futura, este teste tem de ser revisto de
 * propósito — é o alarme.
 */
const DIR = fileURLToPath(new URL('.', import.meta.url))
const SOURCE_FILES = readdirSync(DIR)
  .filter((name) => ['.js', '.jsx'].includes(extname(name)) && !name.includes('.test.'))

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

const FORBIDDEN = [
  [/\bfetch\s*\(/, 'chamada de rede (fetch)'],
  [/XMLHttpRequest|WebSocket|EventSource|sendBeacon/, 'outro canal de rede'],
  [/localStorage|sessionStorage|indexedDB|caches\./, 'armazenamento no navegador'],
  [/document\.cookie|cookieStore/, 'cookie'],
  [/navigator\.credentials|\.credentials\.(get|create|store)|PublicKeyCredential\.|new PublicKeyCredential/, 'cerimônia WebAuthn'],
  [/console\./, 'registro em console (poderia vazar PIN)'],
  [/history\.(push|replace)State|window\.location\s*(=|\.(assign|replace|href\s*=|search\s*=))|location\.hash\s*=/, 'navegação por código (PIN na URL)'],
  [/\bnavigate\s*\(/, 'navegação por código'],
  [/X-User-Id|setApiUser|DEMO_USERS|DEMO_CURRENT_USER|currentUser/, 'identidade demonstrativa'],
  [/from\s+['"]\.\.\/\.\.\/(api|store|data)(\.js)?['"]/, 'importação do domínio/API'],
  [/Authorization|Bearer|btoa\(|atob\(|crypto\./, 'token ou criptografia no cliente'],
]

test('a feature de autenticação existe como arquivos-fonte a varrer', () => {
  assert.ok(SOURCE_FILES.length >= 9, `só ${SOURCE_FILES.length} arquivos encontrados`)
  assert.ok(SOURCE_FILES.includes('LoginPage.jsx') && SOURCE_FILES.includes('authStates.js'))
})

for (const [pattern, label] of FORBIDDEN) {
  test(`nenhum arquivo da N-2.1 usa: ${label}`, () => {
    for (const name of SOURCE_FILES) {
      const code = stripComments(readFileSync(join(DIR, name), 'utf8'))
      assert.doesNotMatch(code, pattern, `${name} contém ${label}`)
    }
  })
}

test('nenhuma exportação sugere sessão, token, cookie ou usuário autenticado', () => {
  const names = [authStates, authErrors, credentialsInput, inputModality, pinKeypad, returnTo, webauthnSupport]
    .flatMap((mod) => Object.keys(mod))
  for (const name of names) {
    assert.doesNotMatch(name, /authenticated|autenticad|logged|createSession|setSession|startSession|grantAccess|token|cookie|permiss/i, name)
  }
})

test('nenhum módulo da feature decide permissão a partir do nome de um perfil', () => {
  for (const name of SOURCE_FILES) {
    const code = stripComments(readFileSync(join(DIR, name), 'utf8'))
    assert.doesNotMatch(code, /Administrador|ADMINISTRADOR|Almoxarifado\b.*perfil|Suprimentos|PORTARIA|canShow|can\(|hasPermission|ROLE_/, `${name} parece tratar perfis`)
  }
})

test('o único caminho de "saída" da tela de credenciais é o aviso de ambiente sem acesso', () => {
  const login = stripComments(readFileSync(join(DIR, 'LoginPage.jsx'), 'utf8'))
  // O envio só dispara SUBMIT e, depois do atraso de demonstração, BACK.
  assert.match(login, /type: AUTH_EVENT\.SUBMIT_CREDENTIALS/)
  assert.match(login, /type: AUTH_EVENT\.BACK/)
  for (const event of ['SECOND_FACTOR_REQUIRED', 'NO_PASSKEY', 'CREDENTIALS_REJECTED', 'CONNECTION_FAILED', 'SECOND_FACTOR_INTERRUPTED', 'SECOND_FACTOR_FAILED']) {
    assert.doesNotMatch(login, new RegExp(`AUTH_EVENT\\.${event}`), `LoginPage não pode emitir ${event} sem servidor`)
  }
  assert.match(login, /NOT_AVAILABLE_COPY/)
})

test('o PIN é limpo do campo ao enviar e nunca é copiado para outro estado', () => {
  const login = stripComments(readFileSync(join(DIR, 'LoginPage.jsx'), 'utf8'))
  assert.match(login, /setPin\(''\)/)
  // Só o próprio estado `pin` recebe o PIN; nada de cópia em ref, window ou globais.
  assert.doesNotMatch(login, /window\.[a-zA-Z_]+\s*=|globalThis\.|pinRef\.current\.value\s*[^=]/)
})
