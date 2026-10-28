import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthApiError } from './authApi.js'
import { REGISTRATION_STATUS, REGISTRATION_REASON, createRegistrationFlow } from './registrationFlow.js'
import { UNSUPPORTED_REASON } from './authStates.js'

/**
 * Primeiro acesso: troca do PIN temporário (POST /auth/initial-pin, PR #6 do backend) e,
 * em seguida, o cadastro da primeira passkey com o PIN definitivo e o MESMO código de
 * ativação (o servidor só o consome quando grava a passkey). Sem rede: tudo injetado.
 */
const CHALLENGE_ID = '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01'
const OPTIONS = { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', rp: { name: 'ALM 2.0' }, user: { id: 'AQ', name: 'ADM001', displayName: 'Teste' }, pubKeyCredParams: [{ alg: -7, type: 'public-key' }] }
const ATTESTATION = { id: 'AQID', rawId: 'AQID', type: 'public-key', response: { clientDataJSON: 'a', attestationObject: 'b', transports: ['internal'] }, clientExtensionResults: {} }
const apiError = (kind, status = 400) => new AuthApiError({ status, kind })
const domError = (name) => Object.assign(new Error('mensagem do navegador'), { name })
const FIRST = { matricula: 'ADM001', temporaryPin: '12345678', newPin: '00123456', activationCode: 'codigo-de-ativacao-secreto' }
const FINISHED = { id: CHALLENGE_ID, nome: null, criadoEm: '2026-10-21T10:00:00Z' }

function build({ changeInitialPin, startRegistration, finishRegistration, register, getSupport } = {}) {
  const calls = []
  const states = []
  const flow = createRegistrationFlow({
    api: {
      async changeInitialPin(input) { calls.push(['changeInitialPin', input]); return changeInitialPin ? changeInitialPin(input) : { pinChanged: true } },
      async startRegistration(input) { calls.push(['startRegistration', input]); return startRegistration ? startRegistration(input) : { challengeId: CHALLENGE_ID, options: OPTIONS } },
      async finishRegistration(input) { calls.push(['finishRegistration', input]); return finishRegistration ? finishRegistration(input) : FINISHED },
    },
    webauthn: { async register(options, extra) { calls.push(['register']); return register ? register(options, extra) : ATTESTATION } },
    getSupport: getSupport || (() => ({ supported: true, reason: null })),
    emit: (state) => states.push(state),
  })
  return { flow, calls, states }
}
const last = (states) => states[states.length - 1]
const statuses = (states) => states.map((state) => state.status)
const names = (calls) => calls.map(([name]) => name)
const inputsOf = (calls, name) => calls.filter(([n]) => n === name).map(([, input]) => input)

test('troca o PIN, pede o desafio com o PIN NOVO e o mesmo código, e só abre a passkey no toque', async () => {
  const { flow, calls, states } = build()
  await flow.beginFirstAccess(FIRST)
  assert.deepEqual(names(calls), ['changeInitialPin', 'startRegistration'], 'a passkey não abre sozinha')
  assert.deepEqual(calls[0][1], FIRST, 'exatamente os campos do contrato, no corpo')
  assert.deepEqual(calls[1][1], { matricula: 'ADM001', pin: '00123456', activationCode: 'codigo-de-ativacao-secreto' }, 'o cadastro usa o PIN definitivo, nunca o temporário')
  assert.deepEqual(statuses(states), [REGISTRATION_STATUS.STARTING, REGISTRATION_STATUS.STARTING, REGISTRATION_STATUS.READY])
  assert.equal(states[0].step, 'pin')
  assert.equal(states[1].step, 'challenge')
  assert.equal(last(states).pinChanged, true)
  await flow.confirm()
  assert.deepEqual(names(calls), ['changeInitialPin', 'startRegistration', 'register', 'finishRegistration'])
  assert.deepEqual(calls[3][1], { challengeId: CHALLENGE_ID, response: ATTESTATION, activationCode: 'codigo-de-ativacao-secreto' }, 'o código ainda válido segue até a gravação da passkey')
})

test('"concluído" só depois que o servidor confirma a passkey', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { flow, states } = build({ finishRegistration: async () => { await gate; return FINISHED } })
  await flow.beginFirstAccess(FIRST)
  const confirming = flow.confirm()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(last(states).status, REGISTRATION_STATUS.CONFIRMING, 'trocar o PIN e abrir a passkey não é ativação concluída')
  assert.equal(states.some((state) => state.status === REGISTRATION_STATUS.DONE), false)
  release()
  await confirming
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
  assert.equal(last(states).pinChanged, true)
})

test('trocar o PIN não é login: o fluxo nunca fala de sessão', async () => {
  const { flow, calls } = build()
  await flow.beginFirstAccess(FIRST)
  await flow.confirm()
  assert.equal(names(calls).some((name) => /login|session|\bme\b/i.test(name)), false)
})

test('erros da troca do PIN viram motivos fixos e nada segue adiante (sem desafio, sem passkey, sem "PIN trocado")', async () => {
  const table = [
    ['invalid_credentials', REGISTRATION_REASON.INVALID_CREDENTIALS],
    ['rate_limited', REGISTRATION_REASON.RATE_LIMITED],
    ['network', REGISTRATION_REASON.NETWORK],
    ['unavailable', REGISTRATION_REASON.FAILED],
    ['origin_not_allowed', REGISTRATION_REASON.FAILED],
    ['validation', REGISTRATION_REASON.FAILED],
    ['unexpected', REGISTRATION_REASON.FAILED],
  ]
  for (const [kind, reason] of table) {
    const { flow, calls, states } = build({ changeInitialPin: async () => { throw apiError(kind, kind === 'network' ? 0 : 401) } })
    await flow.beginFirstAccess(FIRST)
    assert.deepEqual(names(calls), ['changeInitialPin'], kind)
    assert.deepEqual(last(states), { status: REGISTRATION_STATUS.ERROR, reason }, `${kind}: o PIN NÃO foi trocado, então nada de "PIN trocado" nem de retomar`)
    await flow.resume()
    await flow.confirm()
    assert.deepEqual(names(calls), ['changeInitialPin'], `${kind}: nada é retomado sem a troca`)
  }
})

test('a recusa de credenciais é idêntica para matrícula, PIN ou código errados (nada é revelado)', async () => {
  const outcomes = new Set()
  for (const matricula of ['ZZZ99', 'ADM001', 'QUALQUER1']) {
    const { flow, states } = build({ changeInitialPin: async () => { throw apiError('invalid_credentials', 401) } })
    await flow.beginFirstAccess({ ...FIRST, matricula })
    outcomes.add(JSON.stringify(last(states)))
  }
  assert.equal(outcomes.size, 1)
})

test('dispositivo sem WebAuthn avisa ANTES de enviar PIN ou código a qualquer lugar', async () => {
  const { flow, calls, states } = build({ getSupport: () => ({ supported: false, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO }) })
  await flow.beginFirstAccess(FIRST)
  assert.equal(calls.length, 0)
  assert.equal(last(states).reason, REGISTRATION_REASON.UNSUPPORTED)
})

test('PIN trocado mas o desafio falha por rede: o código continua só na memória e "retomar" NÃO troca o PIN de novo', async () => {
  let attempts = 0
  const { flow, calls, states } = build({ startRegistration: async () => { attempts += 1; if (attempts === 1) throw apiError('network', 0); return { challengeId: CHALLENGE_ID, options: OPTIONS } } })
  await flow.beginFirstAccess(FIRST)
  assert.deepEqual(last(states), { status: REGISTRATION_STATUS.ERROR, reason: REGISTRATION_REASON.NETWORK, pinChanged: true, canResume: true })
  await flow.resume()
  assert.deepEqual(names(calls), ['changeInitialPin', 'startRegistration', 'startRegistration'], 'só uma troca de PIN')
  assert.deepEqual(calls[2][1], { matricula: 'ADM001', pin: '00123456', activationCode: 'codigo-de-ativacao-secreto' })
  assert.equal(last(states).status, REGISTRATION_STATUS.READY)
  await flow.confirm()
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
  assert.equal(inputsOf(calls, 'changeInitialPin').length, 1)
})

test('limite de tentativas ou servidor fora depois da troca: dá para retomar; credenciais recusadas: não', async () => {
  for (const kind of ['rate_limited', 'unavailable']) {
    const { flow, states } = build({ startRegistration: async () => { throw apiError(kind, kind === 'rate_limited' ? 429 : 503) } })
    await flow.beginFirstAccess(FIRST)
    assert.equal(last(states).pinChanged, true, kind)
    assert.equal(last(states).canResume, true, kind)
  }
  const refused = build({ startRegistration: async () => { throw apiError('invalid_credentials', 401) } })
  await refused.flow.beginFirstAccess(FIRST)
  assert.deepEqual(last(refused.states), { status: REGISTRATION_STATUS.ERROR, reason: REGISTRATION_REASON.INVALID_CREDENTIALS, pinChanged: true })
  const before = refused.calls.length
  await refused.flow.resume()
  assert.equal(refused.calls.length, before, 'sem retomada: o código e o PIN deixaram de ser úteis e foram esquecidos')
})

test('a passkey falha DEPOIS de trocar o PIN: o frontend não consome nem invalida o código; novo desafio com o mesmo código e o PIN novo', async () => {
  let finishes = 0
  const { flow, calls, states } = build({ finishRegistration: async () => { finishes += 1; if (finishes === 1) throw apiError('challenge_invalid', 401); return FINISHED } })
  await flow.beginFirstAccess(FIRST)
  await flow.confirm()
  assert.deepEqual(last(states), { status: REGISTRATION_STATUS.ERROR, reason: REGISTRATION_REASON.EXPIRED, pinChanged: true, canResume: true })
  await flow.resume()
  assert.deepEqual(inputsOf(calls, 'startRegistration'), [
    { matricula: 'ADM001', pin: '00123456', activationCode: 'codigo-de-ativacao-secreto' },
    { matricula: 'ADM001', pin: '00123456', activationCode: 'codigo-de-ativacao-secreto' },
  ])
  await flow.confirm()
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
  assert.equal(inputsOf(calls, 'changeInitialPin').length, 1)
  assert.deepEqual(inputsOf(calls, 'finishRegistration').map((input) => input.activationCode), ['codigo-de-ativacao-secreto', 'codigo-de-ativacao-secreto'])
})

test('falha de rede ao gravar a passkey: o mesmo desafio e o código servem para tentar de novo', async () => {
  let finishes = 0
  const { flow, calls, states } = build({ finishRegistration: async () => { finishes += 1; if (finishes === 1) throw apiError('network', 0); return FINISHED } })
  await flow.beginFirstAccess(FIRST)
  await flow.confirm()
  assert.equal(last(states).reason, REGISTRATION_REASON.NETWORK)
  assert.equal(last(states).pinChanged, true)
  await flow.confirm()
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
  assert.equal(inputsOf(calls, 'startRegistration').length, 1, 'o desafio não precisou ser refeito')
})

test('cancelar ou deixar expirar o toque na passkey mantém o desafio e o código; tentar de novo conclui', async () => {
  let registers = 0
  const { flow, calls, states } = build({ register: async () => { registers += 1; if (registers === 1) throw domError('NotAllowedError'); return ATTESTATION } })
  await flow.beginFirstAccess(FIRST)
  await flow.confirm()
  assert.equal(last(states).reason, REGISTRATION_REASON.INTERRUPTED)
  assert.equal(last(states).pinChanged, true)
  await flow.confirm()
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
  assert.equal(inputsOf(calls, 'finishRegistration')[0].activationCode, 'codigo-de-ativacao-secreto')
})

test('dispositivo já cadastrado ou sessão antiga depois da troca: fim da linha, os segredos são esquecidos', async () => {
  for (const kind of ['conflict', 'unauthorized']) {
    const { flow, calls, states } = build({ finishRegistration: async () => { throw apiError(kind, 409) } })
    await flow.beginFirstAccess(FIRST)
    await flow.confirm()
    assert.equal(last(states).pinChanged, true, kind)
    assert.equal(last(states).canResume, undefined, kind)
    const count = calls.length
    await flow.resume()
    await flow.confirm()
    assert.equal(calls.length, count, `${kind}: nada é reenviado`)
  }
})

test('segredos nunca aparecem no estado da tela nem nos campos do fluxo (PIN temporário, PIN novo, código)', async () => {
  const { flow, states } = build({ startRegistration: async () => { throw apiError('network', 0) } })
  await flow.beginFirstAccess(FIRST)
  await flow.resume()
  const dump = JSON.stringify(states) + JSON.stringify(Object.entries(flow)) + Object.keys(flow).join(',')
  assert.doesNotMatch(dump, /12345678|00123456|codigo-de-ativacao-secreto/)
})

test('o PIN temporário só viaja na troca: nenhuma outra chamada o leva', async () => {
  const { flow, calls } = build()
  await flow.beginFirstAccess(FIRST)
  await flow.confirm()
  for (const [name, input] of calls) {
    if (name === 'changeInitialPin') continue
    assert.doesNotMatch(JSON.stringify(input || {}), /12345678/, name)
  }
})

test('depois de concluir, tudo é esquecido: nada é reenviado nem retomado', async () => {
  const { flow, calls } = build()
  await flow.beginFirstAccess(FIRST)
  await flow.confirm()
  const count = calls.length
  await flow.resume()
  await flow.confirm()
  assert.equal(calls.length, count)
})

test('cancelar descarta a retomada, o PIN novo e o código; dispose silencia a tela', async () => {
  const { flow, calls, states } = build({ startRegistration: async () => { throw apiError('network', 0) } })
  await flow.beginFirstAccess(FIRST)
  assert.equal(last(states).canResume, true)
  flow.cancel()
  await flow.resume()
  assert.equal(inputsOf(calls, 'startRegistration').length, 1, 'cancelado: não há o que retomar')
  await flow.beginFirstAccess(FIRST)
  flow.dispose()
  const before = states.length
  await flow.resume()
  assert.equal(states.length, before, 'desmontado: nada chega à tela')
})

test('toque duplo não troca o PIN duas vezes', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { flow, calls } = build({ changeInitialPin: async () => { await gate; return { pinChanged: true } } })
  const first = flow.beginFirstAccess(FIRST)
  const second = flow.beginFirstAccess(FIRST)
  release()
  await Promise.all([first, second])
  assert.equal(inputsOf(calls, 'changeInitialPin').length, 1)
})

test('cancelar com a troca em andamento: a resposta tardia do servidor não abre o cadastro', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { flow, calls, states } = build({ changeInitialPin: async () => { await gate; return { pinChanged: true } } })
  const running = flow.beginFirstAccess(FIRST)
  flow.cancel()
  release()
  await running
  assert.equal(calls.some(([name]) => name === 'startRegistration'), false)
  assert.equal(states.some((state) => state.status === REGISTRATION_STATUS.READY), false)
})

test('os fluxos antigos (sessão e ativação com PIN definitivo) seguem iguais: sem marcas de primeiro acesso', async () => {
  const { flow, states } = build()
  await flow.begin({ matricula: '000123', pin: '12345678', activationCode: 'codigo-autorizado' })
  await flow.confirm()
  for (const state of states) {
    assert.equal('pinChanged' in state, false)
    assert.equal('canResume' in state, false)
    assert.equal('step' in state, false)
  }
  assert.equal(last(states).status, REGISTRATION_STATUS.DONE)
  await flow.resume()
  assert.equal(states.at(-1).status, REGISTRATION_STATUS.DONE, 'sem troca de PIN não há o que retomar')
})
