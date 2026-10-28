import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTH_EVENT, AUTH_STATUS, LOGIN_FAILURE, UNSUPPORTED_REASON, createInitialState, transition } from './authStates.js'
import { AuthApiError } from './authApi.js'
import { FLOW_SIGNAL, createLoginFlow } from './loginFlow.js'

/**
 * Orquestração do login real (matrícula+PIN → desafio WebAuthn → sessão), sem
 * React e sem rede: api, WebAuthn e verificação de sessão são injetados.
 * Os sinais emitidos alimentam a MESMA máquina de estados da N-2.1, que não
 * tem estado "autenticado": quem autentica é a sessão validada pelo servidor.
 */
const CHALLENGE_ID = '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01'
const OPTIONS = { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', allowCredentials: [] }
const RESPONSE = { id: 'AQID', type: 'public-key' }
const USER = { id: CHALLENGE_ID, matricula: '000123', nome: 'Teste', perfil: 'ALMOXARIFADO', papeis: [], permissoes: [] }
const apiError = (kind, status = 400) => new AuthApiError({ status, kind })
const domError = (name) => Object.assign(new Error('mensagem do navegador'), { name })

function harness(overrides = {}) {
  const log = { startLogin: [], completeLogin: [], authenticate: [], refresh: 0 }
  const events = []
  const deps = {
    api: {
      async startLogin(input) { log.startLogin.push(input); return { challengeId: CHALLENGE_ID, options: OPTIONS } },
      async completeLogin(id, response) { log.completeLogin.push({ id, response }); return { authenticated: true } },
    },
    webauthn: { async authenticate(options, extra) { log.authenticate.push({ options, extra }); return RESPONSE } },
    getSupport: () => ({ supported: true, reason: null }),
    refreshSession: async () => { log.refresh += 1; return USER },
    emit: (event) => events.push(event),
    ...overrides,
  }
  return { flow: createLoginFlow(deps), log, events, deps }
}

const types = (events) => events.map((event) => event.type)

test('1º fator ok: envia matrícula (texto) e PIN uma vez, guarda só o desafio e pede o 2º fator', async () => {
  const { flow, log, events } = harness()
  await flow.start({ matricula: '000123', pin: '12345678' })
  assert.deepEqual(log.startLogin, [{ matricula: '000123', pin: '12345678' }])
  assert.deepEqual(types(events), [AUTH_EVENT.SECOND_FACTOR_REQUIRED])
  assert.equal(log.authenticate.length, 0, 'a cerimônia só começa num toque do usuário (confirm)')
  assert.equal(log.completeLogin.length, 0)
  assert.equal(log.refresh, 0, 'o PIN sozinho não abre sessão')
})

test('o PIN nunca fica no fluxo depois do envio nem aparece em nenhum sinal', async () => {
  const { flow, events } = harness()
  await flow.start({ matricula: '000123', pin: '99887766' })
  await flow.confirm()
  assert.doesNotMatch(JSON.stringify(events), /99887766/)
  assert.doesNotMatch(JSON.stringify(Object.entries(flow)), /99887766/)
})

test('fluxo completo: confirmar → WebAuthn → complete → sessão do servidor → sucesso', async () => {
  const { flow, log, events } = harness()
  await flow.start({ matricula: '000123', pin: '12345678' })
  await flow.confirm()
  assert.equal(log.authenticate.length, 1)
  assert.deepEqual(log.authenticate[0].options, OPTIONS)
  assert.ok(log.authenticate[0].extra.signal instanceof AbortSignal)
  assert.deepEqual(log.completeLogin, [{ id: CHALLENGE_ID, response: RESPONSE }])
  assert.equal(log.refresh, 1, 'a sessão é lida do servidor (GET /auth/me) depois do complete')
  assert.deepEqual(types(events), [AUTH_EVENT.SECOND_FACTOR_REQUIRED, FLOW_SIGNAL.CEREMONY_RUNNING, FLOW_SIGNAL.CEREMONY_IDLE, FLOW_SIGNAL.SIGNED_IN])
})

test('o sucesso depende da sessão validada: complete ok mas /auth/me recusa → falha, nunca acesso', async () => {
  for (const refreshSession of [async () => null, async () => { throw apiError('unauthorized', 401) }]) {
    const { flow, events } = harness({ refreshSession })
    await flow.start({ matricula: '0012', pin: '12345678' })
    await flow.confirm()
    assert.ok(!types(events).includes(FLOW_SIGNAL.SIGNED_IN), 'não pode sinalizar sucesso')
    assert.ok(types(events).includes(AUTH_EVENT.SECOND_FACTOR_FAILED))
  }
})

test('credenciais inválidas (401 INVALID_CREDENTIALS): mensagem única de credenciais, sem 2º fator', async () => {
  const { flow, events, log } = harness({ api: { startLogin: async () => { throw apiError('invalid_credentials', 401) } } })
  await flow.start({ matricula: '0012', pin: '00000000' })
  assert.deepEqual(events, [{ type: AUTH_EVENT.CREDENTIALS_REJECTED, failure: LOGIN_FAILURE.CREDENCIAIS }])
  assert.equal(log.authenticate.length, 0)
  await flow.confirm()
  assert.equal(log.authenticate.length, 0, 'sem desafio guardado não há cerimônia')
})

test('429 vira "muitas tentativas"; rede vira falha de conexão; o resto, indisponível', async () => {
  const expected = [
    ['rate_limited', LOGIN_FAILURE.LIMITE],
    ['network', LOGIN_FAILURE.CONEXAO],
    ['unavailable', LOGIN_FAILURE.INDISPONIVEL],
    ['origin_not_allowed', LOGIN_FAILURE.INDISPONIVEL],
    ['forbidden', LOGIN_FAILURE.INDISPONIVEL],
    ['validation', LOGIN_FAILURE.INDISPONIVEL],
    ['unauthorized', LOGIN_FAILURE.INDISPONIVEL],
    ['unexpected', LOGIN_FAILURE.INDISPONIVEL],
  ]
  for (const [kind, failure] of expected) {
    const { flow, events } = harness({ api: { startLogin: async () => { throw apiError(kind) } } })
    await flow.start({ matricula: '0012', pin: '12345678' })
    assert.deepEqual(events, [{ type: AUTH_EVENT.CREDENTIALS_REJECTED, failure }], kind)
  }
})

test('erro que não é do cliente HTTP (bug, exceção solta) também cai em "indisponível"', async () => {
  const { flow, events } = harness({ api: { startLogin: async () => { throw new Error('boom') } } })
  await flow.start({ matricula: '0012', pin: '12345678' })
  assert.deepEqual(events, [{ type: AUTH_EVENT.CREDENTIALS_REJECTED, failure: LOGIN_FAILURE.INDISPONIVEL }])
})

test('dispositivo sem WebAuthn: avisa ANTES de enviar matrícula e PIN', async () => {
  const getSupport = () => ({ supported: false, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO })
  const { flow, log, events } = harness({ getSupport })
  await flow.start({ matricula: '0012', pin: '12345678' })
  assert.equal(log.startLogin.length, 0, 'nada vai ao servidor num contexto que não consegue o 2º fator')
  assert.deepEqual(events, [{ type: AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO }])
})

test('cancelar ou expirar no navegador: interrompida, com o mesmo desafio para tentar de novo', async () => {
  let attempts = 0
  const webauthn = { authenticate: async () => { attempts += 1; if (attempts === 1) throw domError('NotAllowedError'); return RESPONSE } }
  const { flow, log, events } = harness({ webauthn })
  await flow.start({ matricula: '0012', pin: '12345678' })
  await flow.confirm()
  assert.ok(types(events).includes(AUTH_EVENT.SECOND_FACTOR_INTERRUPTED))
  assert.ok(!types(events).includes(FLOW_SIGNAL.SIGNED_IN))
  assert.equal(log.completeLogin.length, 0, 'nada foi enviado ao servidor')
  await flow.confirm()
  assert.equal(attempts, 2)
  assert.equal(log.startLogin.length, 1, 'não repete matrícula/PIN: reaproveita o desafio')
  assert.equal(log.completeLogin.length, 1)
  assert.ok(types(events).includes(FLOW_SIGNAL.SIGNED_IN))
})

test('erros do navegador mapeiam por NOME: segurança/incompatível/outros', async () => {
  const cases = [
    ['AbortError', AUTH_EVENT.SECOND_FACTOR_INTERRUPTED],
    ['SecurityError', AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED],
    ['NotSupportedError', AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED],
    ['InvalidStateError', AUTH_EVENT.SECOND_FACTOR_FAILED],
    ['WebAuthnDataError', AUTH_EVENT.SECOND_FACTOR_FAILED],
  ]
  for (const [name, expected] of cases) {
    const { flow, events } = harness({ webauthn: { authenticate: async () => { throw domError(name) } } })
    await flow.start({ matricula: '0012', pin: '12345678' })
    await flow.confirm()
    assert.ok(types(events).includes(expected), `${name} → ${expected}`)
    assert.doesNotMatch(JSON.stringify(events), /mensagem do navegador/, 'a mensagem do navegador não é repassada')
  }
})

test('desafio recusado no complete (401 AUTH_CHALLENGE_INVALID): recomeçar, sem reaproveitar o desafio', async () => {
  const { flow, events, log } = harness({ api: {
    startLogin: async () => ({ challengeId: CHALLENGE_ID, options: OPTIONS }),
    completeLogin: async () => { throw apiError('challenge_invalid', 401) },
  } })
  await flow.start({ matricula: '0012', pin: '12345678' })
  await flow.confirm()
  assert.ok(types(events).includes(FLOW_SIGNAL.CHALLENGE_EXPIRED))
  assert.ok(!types(events).includes(FLOW_SIGNAL.SIGNED_IN))
  const before = events.length
  const authenticateCalls = log.authenticate.length
  await flow.confirm()
  assert.equal(log.authenticate.length, authenticateCalls, 'sem desafio guardado, o toque não reabre a cerimônia')
  assert.ok(types(events.slice(before)).includes(FLOW_SIGNAL.CHALLENGE_EXPIRED))
})

test('falha de rede no complete: conexão, e o retry refaz a cerimônia (o desafio ainda vale)', async () => {
  let completes = 0
  const { flow, events, log } = harness({ api: {
    startLogin: async () => ({ challengeId: CHALLENGE_ID, options: OPTIONS }),
    completeLogin: async () => { completes += 1; if (completes === 1) throw apiError('network', 0); return { authenticated: true } },
  } })
  await flow.start({ matricula: '0012', pin: '12345678' })
  await flow.confirm()
  assert.ok(types(events).includes(AUTH_EVENT.CONNECTION_FAILED))
  await flow.confirm()
  assert.equal(log.authenticate.length, 2)
  assert.ok(types(events).includes(FLOW_SIGNAL.SIGNED_IN))
})

test('complete aceito mas a sessão não pôde ser lida (rede): o retry só revalida a sessão, sem nova passkey', async () => {
  let refreshes = 0
  const { flow, events, log } = harness({ refreshSession: async () => { refreshes += 1; if (refreshes === 1) throw apiError('network', 0); return USER } })
  await flow.start({ matricula: '0012', pin: '12345678' })
  await flow.confirm()
  assert.ok(types(events).includes(AUTH_EVENT.CONNECTION_FAILED))
  await flow.confirm()
  assert.equal(log.authenticate.length, 1, 'o desafio já foi consumido: não pede passkey de novo')
  assert.equal(log.completeLogin.length, 1)
  assert.ok(types(events).includes(FLOW_SIGNAL.SIGNED_IN))
})

test('429, 5xx e origem recusada no complete viram falha genérica do 2º fator', async () => {
  for (const kind of ['rate_limited', 'unavailable', 'origin_not_allowed', 'unexpected', 'forbidden']) {
    const { flow, events } = harness({ api: { startLogin: async () => ({ challengeId: CHALLENGE_ID, options: OPTIONS }), completeLogin: async () => { throw apiError(kind) } } })
    await flow.start({ matricula: '0012', pin: '12345678' })
    await flow.confirm()
    assert.ok(types(events).includes(AUTH_EVENT.SECOND_FACTOR_FAILED), kind)
    assert.ok(!types(events).includes(FLOW_SIGNAL.SIGNED_IN), kind)
  }
})

test('toques repetidos não abrem duas cerimônias nem dois envios ao mesmo tempo', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { flow, log } = harness({ webauthn: { authenticate: async () => { await gate; return RESPONSE } } })
  await flow.start({ matricula: '0012', pin: '12345678' })
  const first = flow.confirm()
  const second = flow.confirm()
  release()
  await Promise.all([first, second])
  assert.equal(log.completeLogin.length, 1)
  const again = harness()
  const a = again.flow.start({ matricula: '0012', pin: '12345678' })
  const b = again.flow.start({ matricula: '0012', pin: '12345678' })
  await Promise.all([a, b])
  assert.equal(again.log.startLogin.length, 1)
})

test('cancelar aborta a cerimônia em andamento e descarta o desafio', async () => {
  let aborted = false
  const webauthn = { authenticate: (_options, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(domError('AbortError')) })
  }) }
  const { flow, events } = harness({ webauthn })
  await flow.start({ matricula: '0012', pin: '12345678' })
  const running = flow.confirm()
  flow.cancel()
  await running
  assert.equal(aborted, true)
  assert.ok(!types(events).includes(FLOW_SIGNAL.SIGNED_IN))
  const before = events.length
  await flow.confirm()
  assert.ok(types(events.slice(before)).includes(FLOW_SIGNAL.CHALLENGE_EXPIRED), 'sem desafio, nada a confirmar')
})

test('depois de dispose() nenhum sinal chega à tela (componente desmontado)', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { flow, events } = harness({ webauthn: { authenticate: async () => { await gate; return RESPONSE } } })
  await flow.start({ matricula: '0012', pin: '12345678' })
  const running = flow.confirm()
  const before = events.length
  flow.dispose()
  release()
  await running
  assert.equal(events.length, before)
})

test('integração com a máquina de estados: os sinais levam às telas certas e nunca a um estado de acesso', async () => {
  let state = createInitialState()
  const apply = (event) => { state = transition(state, event) }
  const { flow } = harness({ emit: (event) => apply(event) })
  apply({ type: AUTH_EVENT.SUBMIT_CREDENTIALS })
  assert.equal(state.status, AUTH_STATUS.VERIFICANDO_CREDENCIAIS)
  await flow.start({ matricula: '0012', pin: '12345678' })
  assert.equal(state.status, AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR)

  const failing = harness({ api: { startLogin: async () => { throw apiError('invalid_credentials', 401) } }, emit: (event) => apply(event) })
  state = createInitialState()
  apply({ type: AUTH_EVENT.SUBMIT_CREDENTIALS })
  await failing.flow.start({ matricula: '0012', pin: '1' })
  assert.equal(state.status, AUTH_STATUS.CREDENCIAIS)
  assert.equal(state.failure, LOGIN_FAILURE.CREDENCIAIS)
})

test('dispose + activate (StrictMode): depois de reativado o fluxo volta a funcionar do zero', async () => {
  const { flow, events, log } = harness()
  flow.dispose()
  await flow.start({ matricula: '0012', pin: '12345678' })
  assert.equal(log.startLogin.length, 0, 'desmontado: ignora')
  flow.activate()
  await flow.start({ matricula: '0012', pin: '12345678' })
  assert.equal(log.startLogin.length, 1)
  assert.ok(types(events).includes(AUTH_EVENT.SECOND_FACTOR_REQUIRED))
})
