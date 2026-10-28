import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTH_API_BASE, AuthApiError, createAuthApi } from './authApi.js'

/**
 * Cliente HTTP da autenticação, contra o contrato REAL do backend
 * (backend/POSTGRES_N2.md + backend/appPostgres.mjs). Sem rede: `fetch` é injetado.
 */
const UUID = '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01'

function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    return handler(url, init, calls.length)
  }
  return { fetchImpl, calls }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const apiWith = (handler) => {
  const { fetchImpl, calls } = fakeFetch(handler)
  return { api: createAuthApi({ fetchImpl }), calls }
}

test('base relativa /api/v1 e cookies da sessão em toda chamada (credentials: include)', async () => {
  assert.equal(AUTH_API_BASE, '/api/v1')
  const { api, calls } = apiWith(() => json(200, { id: 'u1' }))
  await api.getSession()
  assert.equal(calls[0].url, '/api/v1/auth/me')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.credentials, 'include')
  assert.equal(calls[0].init.cache, 'no-store')
})

test('nunca envia X-User-Id nem cabeçalho de autorização: identidade é só o cookie da sessão', async () => {
  const { api, calls } = apiWith((url) => (url.endsWith('/auth/me') ? json(200, {}) : json(201, { challengeId: UUID, options: { challenge: 'AAAA' } })))
  await api.getSession()
  await api.startLogin({ matricula: '0012', pin: '12345678' })
  for (const { init } of calls) {
    const names = Object.keys(init.headers || {}).map((name) => name.toLowerCase())
    assert.ok(!names.includes('x-user-id'))
    assert.ok(!names.includes('authorization'))
    assert.ok(!names.includes('cookie'))
  }
})

test('início do login: POST /auth/login-challenges com {matricula, pin} → {challengeId, options}', async () => {
  const options = { challenge: 'Zm9v', rpId: 'localhost', allowCredentials: [{ id: 'AQID', type: 'public-key' }], userVerification: 'required' }
  const { api, calls } = apiWith(() => json(201, { challengeId: UUID, options }))
  const result = await api.startLogin({ matricula: '000123', pin: '12345678' })
  assert.deepEqual(result, { challengeId: UUID, options })
  assert.equal(calls[0].url, '/api/v1/auth/login-challenges')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  // A matrícula segue como TEXTO (zeros à esquerda) e o PIN vai só no corpo.
  assert.deepEqual(JSON.parse(calls[0].init.body), { matricula: '000123', pin: '12345678' })
  assert.doesNotMatch(calls[0].url, /12345678|000123/, 'nada de matrícula/PIN na URL')
})

test('início do login: resposta fora do contrato vira erro "unexpected", nunca acesso', async () => {
  for (const body of [{}, { challengeId: 'não-uuid', options: { challenge: 'AA' } }, { challengeId: UUID }, { challengeId: UUID, options: {} }, []]) {
    const { api } = apiWith(() => json(201, body))
    await assert.rejects(api.startLogin({ matricula: '0012', pin: '12345678' }), (error) => error instanceof AuthApiError && error.kind === 'unexpected')
  }
})

test('conclusão do desafio: POST /auth/login-challenges/:id/complete com {response} → authenticated:true', async () => {
  const response = { id: 'AQID', rawId: 'AQID', type: 'public-key', response: { clientDataJSON: 'a', authenticatorData: 'b', signature: 'c', userHandle: null }, clientExtensionResults: {} }
  const { api, calls } = apiWith(() => json(200, { authenticated: true }))
  assert.deepEqual(await api.completeLogin(UUID, response), { authenticated: true })
  assert.equal(calls[0].url, `/api/v1/auth/login-challenges/${UUID}/complete`)
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { response })
})

test('conclusão do desafio: id fora do formato UUID nem chega à rede; 200 sem authenticated:true é erro', async () => {
  const { api, calls } = apiWith(() => json(200, { authenticated: false }))
  await assert.rejects(api.completeLogin('../../auth/logout', {}), (error) => error.kind === 'unexpected')
  assert.equal(calls.length, 0, 'identificador inválido não vira caminho de requisição')
  await assert.rejects(api.completeLogin(UUID, {}), (error) => error.kind === 'unexpected')
})

test('sessão atual: GET /auth/me devolve o corpo; 401 vira "unauthorized" (sem sessão)', async () => {
  const { api } = apiWith(() => json(200, { id: 'u1', perfil: 'ALMOXARIFADO' }))
  assert.deepEqual(await api.getSession(), { id: 'u1', perfil: 'ALMOXARIFADO' })
  const denied = apiWith(() => json(401, { error: { code: 'UNAUTHORIZED', message: 'Sessão ausente ou expirada.' } }))
  await assert.rejects(denied.api.getSession(), (error) => error.kind === 'unauthorized' && error.status === 401 && error.code === 'UNAUTHORIZED')
})

test('logout: POST /auth/logout', async () => {
  const { api, calls } = apiWith(() => json(200, { authenticated: false }))
  assert.deepEqual(await api.logout(), { authenticated: false })
  assert.equal(calls[0].url, '/api/v1/auth/logout')
  assert.equal(calls[0].init.method, 'POST')
})

test('classificação dos erros HTTP do contrato (401 / 403 / 429 e demais)', async () => {
  const cases = [
    [401, 'INVALID_CREDENTIALS', 'invalid_credentials'],
    [401, 'AUTH_CHALLENGE_INVALID', 'challenge_invalid'],
    [401, 'UNAUTHORIZED', 'unauthorized'],
    [401, 'QUALQUER_OUTRO', 'unauthorized'],
    [403, 'FORBIDDEN', 'forbidden'],
    [403, 'RECENT_MFA_REQUIRED', 'recent_mfa_required'],
    [403, 'ORIGIN_NOT_ALLOWED', 'origin_not_allowed'],
    [429, 'TOO_MANY_ATTEMPTS', 'rate_limited'],
    [400, 'INVALID_JSON', 'validation'],
    [413, 'PAYLOAD_TOO_LARGE', 'validation'],
    [422, 'VALIDATION_ERROR', 'validation'],
    [404, 'AUTHENTICATOR_NOT_FOUND', 'not_found'],
    [409, 'LAST_AUTHENTICATOR', 'conflict'],
    [409, 'AUTHENTICATOR_EXISTS', 'conflict'],
    [500, 'X', 'unavailable'],
    [503, 'DATABASE_UNAVAILABLE', 'unavailable'],
  ]
  for (const [status, code, kind] of cases) {
    const { api } = apiWith(() => json(status, { error: { code, message: 'texto do servidor' } }))
    await assert.rejects(api.getSession(), (error) => {
      assert.ok(error instanceof AuthApiError)
      assert.equal(error.kind, kind, `${status} ${code}`)
      assert.equal(error.status, status)
      return true
    }, `${status} ${code}`)
  }
})

test('a mensagem do servidor nunca é repassada nem lida: só status, tipo e código conhecido', async () => {
  const secret = 'detalhe interno: pg_hba.conf host=10.0.0.5 senha=abc'
  const { api } = apiWith(() => json(503, { error: { code: 'DATABASE_UNAVAILABLE', message: secret, details: { x: secret } } }))
  await assert.rejects(api.getSession(), (error) => {
    assert.ok(!String(error.message).includes('pg_hba') && !String(error.message).includes('senha'))
    assert.ok(!JSON.stringify(Object.values(error)).includes('pg_hba'))
    assert.equal(error.code, 'DATABASE_UNAVAILABLE')
    return true
  })
  // Código desconhecido ou suspeito não é guardado.
  const odd = apiWith(() => json(500, { error: { code: 'x'.repeat(200) + ' <script>', message: secret } }))
  await assert.rejects(odd.api.getSession(), (error) => error.code === null)
})

test('corpo de erro ilegível (HTML do proxy, vazio, texto) ainda gera o erro pelo status', async () => {
  for (const [status, body, kind] of [[502, '<html>Bad gateway</html>', 'unavailable'], [401, '', 'unauthorized'], [429, 'slow down', 'rate_limited']]) {
    const { api } = apiWith(() => new Response(body, { status }))
    await assert.rejects(api.getSession(), (error) => error.kind === kind && error.status === status)
  }
})

test('falha de rede, tempo esgotado e servidor fora do ar viram "network"', async () => {
  const offline = apiWith(() => { throw new TypeError('Failed to fetch') })
  await assert.rejects(offline.api.getSession(), (error) => error instanceof AuthApiError && error.kind === 'network' && error.status === 0)

  const abort = apiWith(() => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })
  await assert.rejects(abort.api.getSession(), (error) => error.kind === 'network')

  const slow = createAuthApi({
    timeoutMs: 20,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }),
  })
  await assert.rejects(slow.getSession(), (error) => error.kind === 'network')
})

test('listagem de autenticadores: GET /auth/authenticators → { data: [...] } só com metadados', async () => {
  const row = { id: UUID, nome: null, metodoCadastro: 'AUTENTICADA', criadoEm: '2026-10-21T10:00:00Z', ultimoUsoEm: null, revogadoEm: null, backupEligible: true, backupState: false, chavePublica: 'NUNCA' }
  const { api, calls } = apiWith(() => json(200, { data: [row] }))
  const list = await api.listAuthenticators()
  assert.equal(calls[0].url, '/api/v1/auth/authenticators')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(list.length, 1)
  assert.deepEqual(Object.keys(list[0]).sort(), ['backupEligible', 'backupState', 'criadoEm', 'id', 'metodoCadastro', 'nome', 'revogadoEm', 'ultimoUsoEm'])
  assert.ok(!('chavePublica' in list[0]), 'campos fora do contrato não passam')
  const bad = apiWith(() => json(200, { data: 'x' }))
  await assert.rejects(bad.api.listAuthenticators(), (error) => error.kind === 'unexpected')
})

test('cadastro por sessão: registration-challenges sem corpo de credenciais, depois POST /auth/authenticators', async () => {
  const { api, calls } = apiWith((url) => (url.endsWith('registration-challenges')
    ? json(201, { challengeId: UUID, options: { challenge: 'AAAA', rp: { name: 'ALM' }, user: { id: 'AQ' } } })
    : json(201, { id: UUID, nome: null, criadoEm: '2026-10-21T10:00:00Z' })))
  const challenge = await api.startRegistration()
  assert.equal(challenge.challengeId, UUID)
  assert.equal(calls[0].url, '/api/v1/auth/authenticators/registration-challenges')
  assert.deepEqual(JSON.parse(calls[0].init.body), {}, 'sessão MFA recente: nenhuma credencial no corpo')
  const created = await api.finishRegistration({ challengeId: UUID, response: { id: 'AQID' } })
  assert.equal(created.id, UUID)
  assert.equal(calls[1].url, '/api/v1/auth/authenticators')
  assert.deepEqual(JSON.parse(calls[1].init.body), { challengeId: UUID, response: { id: 'AQID' } })
})

test('cadastro por código de ativação: matrícula, PIN e código vão só no corpo; o código segue no passo final', async () => {
  const { api, calls } = apiWith((url) => (url.endsWith('registration-challenges')
    ? json(201, { challengeId: UUID, options: { challenge: 'AAAA' } })
    : json(201, { id: UUID, nome: null, criadoEm: 'x' })))
  await api.startRegistration({ matricula: '0012', pin: '12345678', activationCode: 'codigo-de-ativacao' })
  assert.deepEqual(JSON.parse(calls[0].init.body), { matricula: '0012', pin: '12345678', activationCode: 'codigo-de-ativacao' })
  await api.finishRegistration({ challengeId: UUID, response: { id: 'AQID' }, activationCode: 'codigo-de-ativacao' })
  assert.deepEqual(JSON.parse(calls[1].init.body), { challengeId: UUID, response: { id: 'AQID' }, activationCode: 'codigo-de-ativacao' })
  for (const call of calls) assert.doesNotMatch(call.url, /12345678|codigo-de-ativacao/)
})

test('revogação: DELETE /auth/authenticators/:id com {reason}; id inválido não vira caminho', async () => {
  const { api, calls } = apiWith(() => json(200, { id: UUID, revogado: true, currentSessionRevoked: false }))
  const result = await api.revokeAuthenticator(UUID, 'Aparelho perdido')
  assert.deepEqual(result, { id: UUID, revogado: true, currentSessionRevoked: false })
  assert.equal(calls[0].url, `/api/v1/auth/authenticators/${UUID}`)
  assert.equal(calls[0].init.method, 'DELETE')
  assert.deepEqual(JSON.parse(calls[0].init.body), { reason: 'Aparelho perdido' })
  await assert.rejects(api.revokeAuthenticator('../x', 'motivo'), (error) => error.kind === 'unexpected')
  assert.equal(calls.length, 1)
})

test('nenhum armazenamento do navegador é usado (PIN e identidade nunca ficam em storage)', async () => {
  const touched = []
  const guard = new Proxy({}, { get: (_target, prop) => { touched.push(String(prop)); return () => null } })
  const previous = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage }
  globalThis.localStorage = guard
  globalThis.sessionStorage = guard
  try {
    const { api } = apiWith(() => json(201, { challengeId: UUID, options: { challenge: 'AAAA' } }))
    await api.startLogin({ matricula: '0012', pin: '12345678' })
  } finally {
    globalThis.localStorage = previous.localStorage
    globalThis.sessionStorage = previous.sessionStorage
  }
  assert.deepEqual(touched, [])
})

// --- troca do PIN temporário (PR #6): POST /auth/initial-pin ---
// Contrato lido em origin/feature/goran-portaria-chegadas (backend/appPostgres.mjs + auth/postgresAuth.mjs,
// changeInitialPin): corpo {matricula, temporaryPin, newPin, activationCode} → 200 {pinChanged:true};
// toda recusa (PIN temporário errado/expirado, PIN já definitivo, código inválido/expirado/usado,
// bloqueio) volta como 401 INVALID_CREDENTIALS idêntico; 429 TOO_MANY_ATTEMPTS; 403 ORIGIN_NOT_ALLOWED.

test('troca do PIN inicial: POST /auth/initial-pin com {matricula, temporaryPin, newPin, activationCode} → {pinChanged:true}', async () => {
  const { api, calls } = apiWith(() => json(200, { pinChanged: true }))
  const code = 'c'.repeat(43)
  const result = await api.changeInitialPin({ matricula: 'ADM001', temporaryPin: '12345678', newPin: '00123456', activationCode: code })
  assert.deepEqual(result, { pinChanged: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/v1/auth/initial-pin')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'include')
  assert.deepEqual(JSON.parse(calls[0].init.body), { matricula: 'ADM001', temporaryPin: '12345678', newPin: '00123456', activationCode: code })
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)).sort(), ['activationCode', 'matricula', 'newPin', 'temporaryPin'], 'nenhum campo além dos do contrato')
  assert.doesNotMatch(calls[0].url, /ADM001|12345678|00123456|c{43}/, 'segredos só no corpo, nunca na URL')
  assert.equal(JSON.stringify(calls[0].init.headers).match(/x-user-id|authorization/i), null)
})

test('troca do PIN inicial: os zeros à esquerda e o texto dos PINs seguem intactos', async () => {
  const { api, calls } = apiWith(() => json(200, { pinChanged: true }))
  await api.changeInitialPin({ matricula: '000123', temporaryPin: '00000001', newPin: '00123456', activationCode: 'x'.repeat(43) })
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.matricula, '000123')
  assert.equal(body.temporaryPin, '00000001')
  assert.equal(body.newPin, '00123456')
})

test('troca do PIN inicial: 200 sem {pinChanged:true} (ou corpo estranho) é erro, nunca sucesso', async () => {
  for (const body of [{}, { pinChanged: false }, { pinChanged: 'true' }, [], null, 'ok', { authenticated: true }]) {
    const { api } = apiWith(() => json(200, body))
    await assert.rejects(() => api.changeInitialPin({ matricula: 'A1B', temporaryPin: '12345678', newPin: '87654321', activationCode: 'x'.repeat(43) }), (error) => error instanceof AuthApiError && error.kind === 'unexpected', JSON.stringify(body))
  }
})

test('troca do PIN inicial: recusas e falhas viram tipos fixos, sem texto do servidor', async () => {
  const table = [
    [401, 'INVALID_CREDENTIALS', 'invalid_credentials'],
    [429, 'TOO_MANY_ATTEMPTS', 'rate_limited'],
    [403, 'ORIGIN_NOT_ALLOWED', 'origin_not_allowed'],
    [400, 'INVALID_JSON', 'validation'],
    [413, 'PAYLOAD_TOO_LARGE', 'validation'],
    [503, 'DATABASE_UNAVAILABLE', 'unavailable'],
  ]
  for (const [status, code, kind] of table) {
    const { api } = apiWith(() => json(status, { error: { code, message: 'detalhe interno: pin temporario expirado' } }))
    await assert.rejects(
      () => api.changeInitialPin({ matricula: 'A1B', temporaryPin: '12345678', newPin: '87654321', activationCode: 'x'.repeat(43) }),
      (error) => error instanceof AuthApiError && error.status === status && error.kind === kind && !JSON.stringify(error).includes('detalhe interno') && !error.message.includes('detalhe interno'),
      `${status} ${code}`,
    )
  }
})

test('troca do PIN inicial: sem rede ou servidor fora do ar vira "network" e nada é dado como trocado', async () => {
  const api = createAuthApi({ fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
  await assert.rejects(() => api.changeInitialPin({ matricula: 'A1B', temporaryPin: '12345678', newPin: '87654321', activationCode: 'x'.repeat(43) }), (error) => error.kind === 'network')
})
