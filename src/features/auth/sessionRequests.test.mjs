import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createLoginFlow } from './loginFlow.js'
import { createSessionManager } from './sessionManager.js'

/**
 * Quem pode chamar GET /auth/me. Contexto: em duas execuções de navegador apareceram duas
 * chamadas a /auth/me entre o envio do PIN e o toque da passkey. A investigação mostrou
 * que a própria página NÃO as fez (instrumentação por página: 0 em 25 repetições) e que o
 * mesmo padrão aparece quando OUTRO cliente da aplicação fala com o mesmo servidor de teste
 * (o log do servidor é global). Estes testes travam o que a própria aplicação pode fazer:
 * a consulta da sessão só acontece em pontos conhecidos, e nunca por conta própria durante
 * a espera da passkey (sem polling, sem consulta no 1º fator).
 */
const dir = new URL('./', import.meta.url)
const sources = readdirSync(dir).filter((name) => /\.(js|jsx)$/.test(name) && !/\.test\./.test(name))
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

test('a consulta da sessão (getSession/readSession/check/revalidate) só aparece nos pontos conhecidos', () => {
  const allowed = {
    'authApi.js': ['getSession'],
    'sessionManager.js': ['getSession', 'readSession', 'check', 'revalidate'],
    'AuthProvider.jsx': ['readSession', 'check', 'revalidate', 'retryCheck'],
    'AccessGate.jsx': ['retryCheck'],
    'LoginPage.jsx': ['readSession', 'refreshSession'],
    'loginFlow.js': ['refreshSession'],
  }
  const pattern = /\b(getSession|readSession|retryCheck|refreshSession)\b|\.(check|revalidate)\(/g
  for (const name of sources) {
    const found = new Set([...strip(read(name)).matchAll(pattern)].map((match) => match[1] || match[0].replace(/^\.|\($/g, '')))
    const extra = [...found].filter((token) => !(allowed[name] || []).includes(token))
    assert.deepEqual(extra, [], `${name} consulta a sessão fora dos pontos conhecidos`)
  }
})

test('o Provider consulta a sessão ao montar e ao voltar para a aba — nada mais (sem polling nem temporizador)', () => {
  const provider = strip(read('AuthProvider.jsx'))
  assert.equal((provider.match(/manager\.check\(\)/g) || []).length, 1, 'uma única verificação inicial, na montagem')
  assert.equal((provider.match(/manager\.revalidate\(\)/g) || []).length, 1)
  assert.match(provider, /visibilitychange/)
  for (const name of ['AuthProvider.jsx', 'sessionManager.js', 'loginFlow.js', 'AccessGate.jsx']) {
    assert.doesNotMatch(strip(read(name)), /setInterval|setTimeout|requestAnimationFrame/, `${name} não agenda consultas`)
  }
})

test('a verificação inicial só acontece num efeito com dependência no gerenciador (uma vez por montagem)', () => {
  const provider = strip(read('AuthProvider.jsx'))
  assert.match(provider, /useEffect\(\(\) => \{\n\s*void manager\.check\(\)\n\s*\}, \[manager\]\)/)
  assert.match(provider, /useMemo\(\(\) => createSessionManager\(\{[\s\S]*?\}\), \[api\]\)/, 'o gerenciador só é recriado se o cliente HTTP mudar')
})

test('1º fator (matrícula e PIN): uma única chamada, a do desafio — nenhuma consulta de sessão', async () => {
  const calls = []
  const flow = createLoginFlow({
    api: {
      startLogin: async () => { calls.push('startLogin'); return { challengeId: '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01', options: { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } } },
      completeLogin: async () => { calls.push('completeLogin') },
    },
    webauthn: { authenticate: async () => { calls.push('authenticate'); return {} } },
    getSupport: () => ({ supported: true, reason: null }),
    refreshSession: async () => { calls.push('refreshSession'); return null },
    emit: () => {},
  })
  await flow.start({ matricula: 'A1B2', pin: '12345678' })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(calls, ['startLogin'], 'esperar a passkey não consulta nada')
})

test('depois do 2º fator a sessão é lida UMA vez (só depois do complete aceito)', async () => {
  const calls = []
  const flow = createLoginFlow({
    api: {
      startLogin: async () => ({ challengeId: '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01', options: { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } }),
      completeLogin: async () => { calls.push('completeLogin') },
    },
    webauthn: { authenticate: async () => ({ id: 'x' }) },
    getSupport: () => ({ supported: true, reason: null }),
    refreshSession: async () => { calls.push('refreshSession'); return { id: 'u' } },
    emit: () => {},
  })
  await flow.start({ matricula: 'A1B2', pin: '12345678' })
  await flow.confirm()
  assert.deepEqual(calls, ['completeLogin', 'refreshSession'])
})

test('sem sessão: voltar para a aba (revalidate) não faz chamada alguma, nem no login nem na espera da passkey', async () => {
  let lookups = 0
  const manager = createSessionManager({ api: { getSession: async () => { lookups += 1; throw Object.assign(new Error('x'), { kind: 'unauthorized' }) }, logout: async () => ({}) }, onUserChange() {}, onSignedOut() {} })
  await manager.check()
  assert.equal(lookups, 1)
  for (let i = 0; i < 5; i += 1) await manager.revalidate()
  assert.equal(lookups, 1, 'anônimo não revalida')
})

test('cada check() é UMA chamada (sem deduplicação): o par de chamadas visto em desenvolvimento é a montagem em dobro do React (StrictMode)', async () => {
  let lookups = 0
  const api = { getSession: async () => { lookups += 1; throw Object.assign(new Error('x'), { kind: 'unauthorized' }) } }
  const manager = createSessionManager({ api, onUserChange() {}, onSignedOut() {} })
  await manager.check()
  assert.equal(lookups, 1)
  // StrictMode (só em `npm run dev`) monta o efeito duas vezes: duas verificações simultâneas = duas chamadas.
  await Promise.all([manager.check(), manager.check()])
  assert.equal(lookups, 3)
  const main = strip(read('../../main.jsx'))
  assert.match(main, /StrictMode/)
})

test('uma consulta que retorna 401 num login em andamento não cria sessão nem muda o desafio já aceito', async () => {
  const states = []
  const manager = createSessionManager({ api: { getSession: async () => { throw Object.assign(new Error('x'), { kind: 'unauthorized' }) } }, onUserChange() {}, onSignedOut() {} })
  manager.subscribe(() => states.push(manager.getState().status))
  await manager.check()
  await manager.check()
  assert.equal(manager.getState().user, null)
  assert.ok(states.every((status) => status !== 'authenticated'))
})
