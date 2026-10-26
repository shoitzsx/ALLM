import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthApiError } from './authApi.js'
import { REGISTRATION_STATUS, REGISTRATION_REASON, createRegistrationFlow } from './registrationFlow.js'
import { UNSUPPORTED_REASON } from './authStates.js'

/**
 * Cadastro de passkey (contrato: POST /auth/authenticators/registration-challenges
 * e POST /auth/authenticators). Dois modos: com a sessão atual (MFA recente) ou
 * por ativação (matrícula + PIN + código autorizado). Sem rede: tudo injetado.
 */
const CHALLENGE_ID = '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01'
const OPTIONS = { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', rp: { name: 'ALM 2.0' }, user: { id: 'AQ', name: '000123', displayName: 'Teste' }, pubKeyCredParams: [{ alg: -7, type: 'public-key' }] }
const ATTESTATION = { id: 'AQID', rawId: 'AQID', type: 'public-key', response: { clientDataJSON: 'a', attestationObject: 'b', transports: ['internal'] }, clientExtensionResults: {} }
const apiError = (kind, status = 400) => new AuthApiError({ status, kind })
const domError = (name) => Object.assign(new Error('mensagem do navegador'), { name })

function harness(overrides = {}) {
  const log = { start: [], finish: [], register: [] }
  const states = []
  const deps = {
    api: {
      async startRegistration(input) { log.start.push(input); return { challengeId: CHALLENGE_ID, options: OPTIONS } },
      async finishRegistration(input) { log.finish.push(input); return { id: CHALLENGE_ID, nome: null, criadoEm: '2026-10-21T10:00:00Z' } },
    },
    webauthn: { async register(options, extra) { log.register.push({ options, extra }); return ATTESTATION } },
    getSupport: () => ({ supported: true, reason: null }),
    emit: (state) => states.push(state),
    ...overrides,
  }
  return { flow: createRegistrationFlow(deps), log, states }
}
const last = (states) => states[states.length - 1]
const statuses = (states) => states.map((state) => state.status)

test('cadastro com sessão: pede o desafio sem credenciais, espera o toque e só então abre o dispositivo', async () => {
  const { flow, log, states } = harness()
  await flow.begin()
  assert.deepEqual(log.start, [undefined], 'sessão MFA recente: nada de matrícula/PIN no corpo')
  assert.deepEqual(statuses(states), [REGISTRATION_STATUS.STARTING, REGISTRATION_STATUS.READY])
  assert.equal(log.register.length, 0, 'a passkey só abre num toque do usuário (confirm)')
  await flow.confirm()
  assert.equal(log.register.length, 1)
  assert.deepEqual(log.finish, [{ challengeId: CHALLENGE_ID, response: ATTESTATION }])
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
  assert.equal(last(states).authenticator.id, CHALLENGE_ID)
})

test('cadastro por ativação: matrícula, PIN e código vão ao início; só o código segue até o fim; o PIN não fica', async () => {
  const { flow, log, states } = harness()
  await flow.begin({ matricula: '000123', pin: '12345678', activationCode: 'codigo-autorizado' })
  assert.deepEqual(log.start, [{ matricula: '000123', pin: '12345678', activationCode: 'codigo-autorizado' }])
  await flow.confirm()
  assert.deepEqual(log.finish, [{ challengeId: CHALLENGE_ID, response: ATTESTATION, activationCode: 'codigo-autorizado' }])
  assert.doesNotMatch(JSON.stringify(states), /12345678|codigo-autorizado/, 'segredos nunca aparecem no estado da tela')
  assert.doesNotMatch(JSON.stringify(Object.entries(flow)), /12345678/)
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
})

test('depois de concluir, o código de ativação é esquecido (uso único)', async () => {
  const { flow, log } = harness()
  await flow.begin({ matricula: '0012', pin: '12345678', activationCode: 'codigo-autorizado' })
  await flow.confirm()
  await flow.confirm()
  assert.equal(log.finish.length, 1, 'não reenvia o código nem a resposta')
})

test('dispositivo sem WebAuthn: avisa antes de pedir qualquer coisa ao servidor', async () => {
  const getSupport = () => ({ supported: false, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO })
  const { flow, log, states } = harness({ getSupport })
  await flow.begin()
  assert.equal(log.start.length, 0)
  assert.deepEqual(last(states), { status: REGISTRATION_STATUS.ERROR, reason: REGISTRATION_REASON.UNSUPPORTED, unsupported: UNSUPPORTED_REASON.CONTEXTO_INSEGURO })
})

test('erros ao pedir o desafio viram motivos fixos (sem texto do servidor)', async () => {
  const table = [
    ['invalid_credentials', REGISTRATION_REASON.INVALID_CREDENTIALS],
    ['rate_limited', REGISTRATION_REASON.RATE_LIMITED],
    ['recent_mfa_required', REGISTRATION_REASON.RECENT_MFA_REQUIRED],
    ['unauthorized', REGISTRATION_REASON.UNAUTHORIZED],
    ['network', REGISTRATION_REASON.NETWORK],
    ['unavailable', REGISTRATION_REASON.FAILED],
    ['forbidden', REGISTRATION_REASON.FAILED],
    ['origin_not_allowed', REGISTRATION_REASON.FAILED],
    ['unexpected', REGISTRATION_REASON.FAILED],
  ]
  for (const [kind, reason] of table) {
    const { flow, states } = harness({ api: { startRegistration: async () => { throw apiError(kind) } } })
    await flow.begin()
    assert.deepEqual(last(states), { status: REGISTRATION_STATUS.ERROR, reason }, kind)
  }
})

test('cancelar/expirar na passkey: interrompido, o mesmo desafio serve para tentar de novo', async () => {
  let attempts = 0
  const { flow, log, states } = harness({ webauthn: { register: async () => { attempts += 1; if (attempts === 1) throw domError('NotAllowedError'); return ATTESTATION } } })
  await flow.begin()
  await flow.confirm()
  assert.deepEqual(last(states), { status: REGISTRATION_STATUS.ERROR, reason: REGISTRATION_REASON.INTERRUPTED })
  assert.equal(log.finish.length, 0)
  await flow.confirm()
  assert.equal(log.start.length, 1, 'reaproveita o desafio')
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
})

test('erros do navegador por NOME: segurança/incompatível e demais', async () => {
  for (const [name, reason] of [['SecurityError', REGISTRATION_REASON.UNSUPPORTED], ['NotSupportedError', REGISTRATION_REASON.UNSUPPORTED], ['WebAuthnDataError', REGISTRATION_REASON.FAILED]]) {
    const { flow, states } = harness({ webauthn: { register: async () => { throw domError(name) } } })
    await flow.begin()
    await flow.confirm()
    assert.equal(last(states).reason, reason, name)
    assert.doesNotMatch(JSON.stringify(states), /mensagem do navegador/)
  }
})

test('servidor recusa a resposta do cadastro: desafio expirado, já cadastrado, sessão antiga, rede e demais', async () => {
  const table = [
    ['challenge_invalid', REGISTRATION_REASON.EXPIRED],
    ['conflict', REGISTRATION_REASON.ALREADY_REGISTERED],
    ['recent_mfa_required', REGISTRATION_REASON.RECENT_MFA_REQUIRED],
    ['unauthorized', REGISTRATION_REASON.UNAUTHORIZED],
    ['network', REGISTRATION_REASON.NETWORK],
    ['rate_limited', REGISTRATION_REASON.RATE_LIMITED],
    ['unavailable', REGISTRATION_REASON.FAILED],
  ]
  for (const [kind, reason] of table) {
    const { flow, states } = harness({ api: {
      startRegistration: async () => ({ challengeId: CHALLENGE_ID, options: OPTIONS }),
      finishRegistration: async () => { throw apiError(kind) },
    } })
    await flow.begin()
    await flow.confirm()
    assert.equal(last(states).reason, reason, kind)
    assert.notEqual(last(states).status, REGISTRATION_STATUS.DONE)
  }
})

test('falha de rede no fim mantém o desafio para tentar de novo; desafio expirado o descarta', async () => {
  let finishes = 0
  const { flow, log, states } = harness({ api: {
    startRegistration: async () => ({ challengeId: CHALLENGE_ID, options: OPTIONS }),
    finishRegistration: async () => { finishes += 1; if (finishes === 1) throw apiError('network', 0); return { id: CHALLENGE_ID, nome: null, criadoEm: null } },
  } })
  await flow.begin()
  await flow.confirm()
  assert.equal(last(states).reason, REGISTRATION_REASON.NETWORK)
  await flow.confirm()
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
  assert.equal(log.register.length, 2)

  const expired = harness({ api: { startRegistration: async () => ({ challengeId: CHALLENGE_ID, options: OPTIONS }), finishRegistration: async () => { throw apiError('challenge_invalid', 401) } } })
  await expired.flow.begin()
  await expired.flow.confirm()
  const calls = expired.log.register.length
  await expired.flow.confirm()
  assert.equal(expired.log.register.length, calls, 'sem desafio guardado não abre a passkey de novo')
  assert.equal(last(expired.states).reason, REGISTRATION_REASON.EXPIRED)
})

test('toques repetidos não abrem duas cerimônias', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { flow, log } = harness({ webauthn: { register: async () => { await gate; return ATTESTATION } } })
  await flow.begin()
  const a = flow.confirm()
  const b = flow.confirm()
  release()
  await Promise.all([a, b])
  assert.equal(log.finish.length, 1)
})

test('cancelar aborta a passkey e descarta desafio e código; dispose silencia a tela', async () => {
  let aborted = false
  const webauthn = { register: (_o, { signal }) => new Promise((_res, rej) => { signal.addEventListener('abort', () => { aborted = true; rej(domError('AbortError')) }) }) }
  const { flow, states } = harness({ webauthn })
  await flow.begin({ matricula: '0012', pin: '12345678', activationCode: 'codigo' })
  const running = flow.confirm()
  flow.cancel()
  await running
  assert.equal(aborted, true)
  const count = states.length
  flow.dispose()
  await flow.confirm()
  assert.equal(states.length, count)
})

test('InvalidStateError do navegador = este dispositivo já tem uma passkey desta conta (excludeCredentials)', async () => {
  const { flow, states } = harness({ webauthn: { register: async () => { throw domError('InvalidStateError') } } })
  await flow.begin()
  await flow.confirm()
  assert.equal(last(states).reason, REGISTRATION_REASON.ALREADY_REGISTERED)
})
