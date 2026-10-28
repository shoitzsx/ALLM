import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTH_STATUS, LOGIN_FAILURE, UNSUPPORTED_REASON } from './authStates.js'
import {
  CHALLENGE_EXPIRED_COPY,
  CONNECTION_FAILURE,
  LOGIN_FAILURE_COPY,
  MATRICULA_OVERFLOW_MESSAGE,
  NOT_AVAILABLE_COPY,
  SESSION_EXPIRED_COPY,
  classifyLoginFailure,
  getLoginFailureCopy,
  getStepCopy,
} from './authErrors.js'

test('credenciais incorretas têm uma única mensagem pública, qualquer que seja o motivo', () => {
  // Matrícula inexistente, conta inativa, PIN errado e credencial bloqueada
  // chegam como 4xx genérico e não podem ser distinguidos na tela.
  const copies = [400, 401, 403, 404, 409, 422, 423].map((status) => getLoginFailureCopy(classifyLoginFailure({ status })))
  for (const copy of copies) assert.equal(copy, LOGIN_FAILURE_COPY[LOGIN_FAILURE.CREDENCIAIS])
  assert.equal(LOGIN_FAILURE_COPY[LOGIN_FAILURE.CREDENCIAIS].title, 'Matrícula ou PIN inválidos.')
})

test('textos públicos nunca citam inativo, inexistente, bloqueado ou enumeram contas', () => {
  const texts = Object.values(LOGIN_FAILURE_COPY).flatMap((c) => [c.title, c.description])
  for (const text of texts) {
    assert.doesNotMatch(text, /inativ|inexist|n[ãa]o existe|bloquead|desativad|cadastrad|PIN correto|matr[ií]cula correta/i, text)
  }
})

test('classifica falha pelo status HTTP genérico, sem depender de corpo ou código do backend', () => {
  assert.equal(classifyLoginFailure({ networkError: true }), CONNECTION_FAILURE)
  assert.equal(classifyLoginFailure({ status: 0 }), CONNECTION_FAILURE)
  assert.equal(classifyLoginFailure({ status: 429 }), LOGIN_FAILURE.LIMITE)
  assert.equal(classifyLoginFailure({ status: 500 }), LOGIN_FAILURE.INDISPONIVEL)
  assert.equal(classifyLoginFailure({ status: 503 }), LOGIN_FAILURE.INDISPONIVEL)
  assert.equal(classifyLoginFailure({}), LOGIN_FAILURE.INDISPONIVEL)
  assert.equal(classifyLoginFailure(), LOGIN_FAILURE.INDISPONIVEL)
})

test('mensagem do servidor jamais chega à tela', () => {
  const hostile = { status: 401, message: 'Usuário 00123 inativo; hash $argon2id$v=19$ ...', code: 'USER_INACTIVE', body: '<img src=x>' }
  const copy = getLoginFailureCopy(classifyLoginFailure(hostile))
  const rendered = JSON.stringify(copy)
  assert.doesNotMatch(rendered, /00123|argon2|inativo|USER_INACTIVE|<img/i)
  // Chave desconhecida cai no texto genérico, nunca vira texto livre.
  assert.equal(getLoginFailureCopy('Qualquer coisa do servidor'), LOGIN_FAILURE_COPY[LOGIN_FAILURE.INDISPONIVEL])
  assert.equal(getLoginFailureCopy(undefined), LOGIN_FAILURE_COPY[LOGIN_FAILURE.INDISPONIVEL])
})

test('só o erro de credenciais é marcado como erro de campo', () => {
  assert.equal(LOGIN_FAILURE_COPY[LOGIN_FAILURE.CREDENCIAIS].fieldLevel, true)
  assert.equal(LOGIN_FAILURE_COPY[LOGIN_FAILURE.LIMITE].fieldLevel, false)
  assert.equal(LOGIN_FAILURE_COPY[LOGIN_FAILURE.INDISPONIVEL].fieldLevel, false)
})

test('todo estado do segundo fator tem texto em português, com tom e título', () => {
  const withCopy = [
    AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR, AUTH_STATUS.CONFIRMACAO_INTERROMPIDA, AUTH_STATUS.PASSKEY_NAO_CADASTRADA,
    AUTH_STATUS.ERRO_CONEXAO, AUTH_STATUS.ERRO_SEGUNDO_FATOR,
  ]
  for (const status of withCopy) {
    const copy = getStepCopy({ status })
    assert.ok(copy.title && copy.description && ['info', 'warning', 'error'].includes(copy.tone), status)
  }
  assert.equal(getStepCopy({ status: AUTH_STATUS.CREDENCIAIS }), null)
  assert.equal(getStepCopy({ status: 'desconhecido' }), null)
  assert.equal(getStepCopy(null), null)
})

test('o segundo fator aparece como obrigatório enquanto se espera a passkey', () => {
  assert.match(getStepCopy({ status: AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR }).description, /obrigat[óo]rio/i)
})

test('cancelada/expirada diz que nada foi concluído', () => {
  const copy = getStepCopy({ status: AUTH_STATUS.CONFIRMACAO_INTERROMPIDA })
  assert.match(copy.title, /cancelada ou expirada/i)
  assert.match(copy.description, /nada foi conclu[ií]do/i)
})

test('dispositivo incompatível explica cada motivo e tem texto genérico de reserva', () => {
  const insecure = getStepCopy({ status: AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO })
  assert.match(insecure.description, /HTTPS/)
  const none = getStepCopy({ status: AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL, reason: UNSUPPORTED_REASON.SEM_WEBAUTHN })
  assert.match(none.title, /incompat[ií]vel/i)
  const odd = getStepCopy({ status: AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL, reason: 'qualquer' })
  assert.match(odd.title, /incompat[ií]vel/i)
  assert.equal(odd.tone, 'error')
})

test('nenhum texto convida a cadastrar ou recuperar credencial por conta própria', () => {
  const texts = [
    ...Object.values(LOGIN_FAILURE_COPY), SESSION_EXPIRED_COPY, NOT_AVAILABLE_COPY,
    ...Object.values(AUTH_STATUS).map((status) => getStepCopy({ status, reason: 'x' })).filter(Boolean),
  ].flatMap((c) => [c.title, c.description])
  for (const text of texts) assert.doesNotMatch(text, /cadastre|criar (uma )?passkey|redefin|esqueci|recuperar (seu|o) (acesso|pin)|clique aqui/i, text)
})

test('o aviso desta etapa diz que nenhum dado foi enviado', () => {
  assert.match(NOT_AVAILABLE_COPY.description, /nenhum dado foi enviado/i)
})

test('aviso de excesso da matrícula: texto exato, sem revelar o mínimo nem regra interna', () => {
  assert.equal(MATRICULA_OVERFLOW_MESSAGE, 'A matrícula não pode ultrapassar 20 caracteres.')
  assert.doesNotMatch(MATRICULA_OVERFLOW_MESSAGE, /m[ií]nim|pelo menos|ao menos|\b3\b|tr[eê]s/i)
})

test('falha de conexão no primeiro fator tem texto próprio e não é campo inválido', () => {
  assert.equal(CONNECTION_FAILURE, LOGIN_FAILURE.CONEXAO)
  const copy = getLoginFailureCopy(LOGIN_FAILURE.CONEXAO)
  assert.equal(copy.title, 'Não foi possível conectar ao ALM.')
  assert.equal(copy.fieldLevel, false)
  assert.equal(copy.tone, 'error')
})

test('desafio expirado: aviso fixo, sem culpar matrícula nem PIN', () => {
  assert.equal(CHALLENGE_EXPIRED_COPY.title, 'A confirmação expirou ou não foi aceita.')
  assert.doesNotMatch(JSON.stringify(CHALLENGE_EXPIRED_COPY), /inválid|incorret|existe|bloquead|inativ/i)
})
