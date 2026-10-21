import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTH_EVENT as E,
  AUTH_STATUS as S,
  LOGIN_FAILURE,
  UNSUPPORTED_REASON,
  createInitialState,
  isBusy,
  isSecondFactorStep,
  transition,
} from './authStates.js'

const ALL_STATUS = Object.values(S)
const ALL_EVENTS = Object.values(E)
const step = (state, type, extra = {}) => transition(state, { type, ...extra })

test('começa em credenciais, sem falha nem motivo', () => {
  const s = createInitialState()
  assert.equal(s.status, S.CREDENCIAIS)
  assert.equal(s.failure, null)
  assert.equal(s.reason, null)
})

test('o conjunto de estados é fechado e nenhum deles é de sessão autenticada', () => {
  // Se alguém criar um estado novo, este teste pede revisão consciente.
  assert.deepEqual([...ALL_STATUS].sort(), [
    'aguardando_segundo_fator', 'confirmacao_interrompida', 'credenciais', 'dispositivo_incompativel',
    'erro_conexao', 'erro_segundo_fator', 'passkey_nao_cadastrada', 'verificando_credenciais',
  ])
  for (const value of [...ALL_STATUS, ...ALL_EVENTS]) {
    assert.doesNotMatch(value, /autentic|sess|logad|granted|concedid|sucesso|success/i, value)
  }
})

test('caminho esperado: credenciais → verificando → aguardando segundo fator', () => {
  let s = createInitialState()
  s = step(s, E.SUBMIT_CREDENTIALS)
  assert.equal(s.status, S.VERIFICANDO_CREDENCIAIS)
  s = step(s, E.SECOND_FACTOR_REQUIRED)
  assert.equal(s.status, S.AGUARDANDO_SEGUNDO_FATOR)
})

test('o PIN sozinho nunca leva além de "aguardando segundo fator"', () => {
  // Nenhum evento a partir de AGUARDANDO leva a um estado que não seja de
  // espera, falha ou volta: não há estado de acesso concedido para chegar.
  const waiting = createInitialState(S.AGUARDANDO_SEGUNDO_FATOR)
  const reachable = new Set()
  for (const type of ALL_EVENTS) reachable.add(step(waiting, type, { reason: UNSUPPORTED_REASON.SEM_WEBAUTHN }).status)
  const allowed = new Set([
    S.AGUARDANDO_SEGUNDO_FATOR, S.CONFIRMACAO_INTERROMPIDA, S.DISPOSITIVO_INCOMPATIVEL,
    S.ERRO_SEGUNDO_FATOR, S.ERRO_CONEXAO, S.CREDENCIAIS,
  ])
  for (const status of reachable) assert.ok(allowed.has(status), status)
})

test('sem confirmação externa não há avanço: eventos fora de ordem são ignorados', () => {
  const initial = createInitialState()
  // Não dá para pular o PIN: "segundo fator exigido" só vale depois do envio.
  for (const type of [E.SECOND_FACTOR_REQUIRED, E.NO_PASSKEY, E.SECOND_FACTOR_INTERRUPTED, E.SECOND_FACTOR_FAILED, E.RETRY, E.BACK, E.CREDENTIALS_REJECTED]) {
    assert.equal(step(initial, type), initial, type)
  }
  const verifying = step(initial, E.SUBMIT_CREDENTIALS)
  assert.equal(step(verifying, E.SUBMIT_CREDENTIALS), verifying, 'duplo envio é ignorado')
  assert.equal(step(verifying, E.RETRY), verifying)
})

test('transição inválida devolve o mesmo objeto (sem efeito e sem erro)', () => {
  for (const status of ALL_STATUS) {
    const state = createInitialState(status)
    assert.equal(step(state, 'evento_que_nao_existe'), state)
    assert.equal(transition(state, undefined), state)
    assert.equal(transition(state, null), state)
    assert.equal(transition(state, {}), state)
  }
})

test('estado ou entrada corrompida volta ao início seguro', () => {
  for (const bad of [undefined, null, {}, { status: 'autenticado' }, 'x']) {
    assert.equal(transition(bad, { type: E.RETRY }).status, S.CREDENCIAIS)
  }
  assert.equal(transition({ status: 'autenticado' }, { type: E.SUBMIT_CREDENTIALS }).status, S.VERIFICANDO_CREDENCIAIS)
})

test('credencial recusada volta ao formulário com a falha normalizada', () => {
  const verifying = step(createInitialState(), E.SUBMIT_CREDENTIALS)
  for (const failure of Object.values(LOGIN_FAILURE)) {
    const s = step(verifying, E.CREDENTIALS_REJECTED, { failure })
    assert.equal(s.status, S.CREDENCIAIS)
    assert.equal(s.failure, failure)
  }
  // Falha desconhecida (ou texto do servidor) nunca vira mensagem própria.
  const odd = step(verifying, E.CREDENTIALS_REJECTED, { failure: 'Matrícula 123 não existe' })
  assert.equal(odd.failure, LOGIN_FAILURE.INDISPONIVEL)
})

test('sem passkey, dispositivo incompatível e falhas têm telas próprias', () => {
  const verifying = step(createInitialState(), E.SUBMIT_CREDENTIALS)
  assert.equal(step(verifying, E.NO_PASSKEY).status, S.PASSKEY_NAO_CADASTRADA)
  const unsupported = step(verifying, E.SECOND_FACTOR_UNSUPPORTED, { reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO })
  assert.equal(unsupported.status, S.DISPOSITIVO_INCOMPATIVEL)
  assert.equal(unsupported.reason, UNSUPPORTED_REASON.CONTEXTO_INSEGURO)
  assert.equal(step(verifying, E.SECOND_FACTOR_UNSUPPORTED, { reason: '<script>' }).reason, UNSUPPORTED_REASON.GENERICO)
  const waiting = step(verifying, E.SECOND_FACTOR_REQUIRED)
  assert.equal(step(waiting, E.SECOND_FACTOR_INTERRUPTED).status, S.CONFIRMACAO_INTERROMPIDA)
  assert.equal(step(waiting, E.SECOND_FACTOR_FAILED).status, S.ERRO_SEGUNDO_FATOR)
})

test('cancelar/expirar permite tentar de novo ou voltar; sem passkey e incompatível só permitem voltar', () => {
  const interrupted = createInitialState(S.CONFIRMACAO_INTERROMPIDA)
  assert.equal(step(interrupted, E.RETRY).status, S.AGUARDANDO_SEGUNDO_FATOR)
  assert.equal(step(interrupted, E.BACK).status, S.CREDENCIAIS)
  for (const status of [S.PASSKEY_NAO_CADASTRADA, S.DISPOSITIVO_INCOMPATIVEL]) {
    const s = createInitialState(status)
    assert.equal(step(s, E.RETRY), s, `${status} não tem "tentar de novo"`)
    assert.equal(step(s, E.BACK).status, S.CREDENCIAIS)
  }
})

test('erro de conexão lembra o passo em que ocorreu e volta para ele', () => {
  const verifying = step(createInitialState(), E.SUBMIT_CREDENTIALS)
  const net1 = step(verifying, E.CONNECTION_FAILED)
  assert.equal(net1.status, S.ERRO_CONEXAO)
  assert.equal(step(net1, E.RETRY).status, S.VERIFICANDO_CREDENCIAIS)
  const waiting = step(verifying, E.SECOND_FACTOR_REQUIRED)
  const net2 = step(waiting, E.CONNECTION_FAILED)
  assert.equal(step(net2, E.RETRY).status, S.AGUARDANDO_SEGUNDO_FATOR)
  assert.equal(step(net2, E.BACK).status, S.CREDENCIAIS)
})

test('voltar limpa falha, motivo e passo de retorno', () => {
  const s = step(createInitialState(S.DISPOSITIVO_INCOMPATIVEL, { reason: UNSUPPORTED_REASON.SEM_WEBAUTHN }), E.BACK)
  assert.deepEqual({ ...s }, { status: S.CREDENCIAIS, failure: null, reason: null, retryStatus: null })
})

test('estados são imutáveis', () => {
  const s = createInitialState()
  assert.throws(() => {
    s.status = S.AGUARDANDO_SEGUNDO_FATOR
  }, TypeError)
})

test('isBusy e isSecondFactorStep descrevem a tela corretamente', () => {
  assert.equal(isBusy(createInitialState(S.VERIFICANDO_CREDENCIAIS)), true)
  assert.equal(isBusy(createInitialState(S.AGUARDANDO_SEGUNDO_FATOR)), true)
  assert.equal(isBusy(createInitialState(S.CREDENCIAIS)), false)
  assert.equal(isSecondFactorStep(createInitialState(S.CREDENCIAIS)), false)
  assert.equal(isSecondFactorStep(createInitialState(S.VERIFICANDO_CREDENCIAIS)), false)
  for (const status of ALL_STATUS.filter((x) => x !== S.CREDENCIAIS && x !== S.VERIFICANDO_CREDENCIAIS)) {
    assert.equal(isSecondFactorStep(createInitialState(status)), true, status)
  }
})
