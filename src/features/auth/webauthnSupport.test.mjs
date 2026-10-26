import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTH_EVENT, UNSUPPORTED_REASON } from './authStates.js'
import { eventFromSupport, eventFromWebAuthnError, getWebAuthnSupport } from './webauthnSupport.js'

const secureEnv = (overrides = {}) => ({
  isSecureContext: true,
  PublicKeyCredential: function PublicKeyCredential() {},
  navigator: { credentials: { get() {}, create() {} } },
  ...overrides,
})

test('navegador com WebAuthn em contexto seguro é compatível', () => {
  assert.deepEqual(getWebAuthnSupport(secureEnv()), { supported: true, reason: null })
})

test('navegador sem WebAuthn é incompatível', () => {
  assert.deepEqual(getWebAuthnSupport(secureEnv({ PublicKeyCredential: undefined })), { supported: false, reason: UNSUPPORTED_REASON.SEM_WEBAUTHN })
  assert.deepEqual(getWebAuthnSupport(secureEnv({ navigator: {} })), { supported: false, reason: UNSUPPORTED_REASON.SEM_WEBAUTHN })
  assert.deepEqual(getWebAuthnSupport(secureEnv({ navigator: { credentials: {} } })), { supported: false, reason: UNSUPPORTED_REASON.SEM_WEBAUTHN })
  assert.deepEqual(getWebAuthnSupport(null), { supported: false, reason: UNSUPPORTED_REASON.SEM_WEBAUTHN })
})

test('contexto HTTP inseguro é detectado mesmo que a API exista', () => {
  assert.deepEqual(getWebAuthnSupport(secureEnv({ isSecureContext: false })), { supported: false, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO })
  // Em HTTP o navegador costuma esconder a API: o motivo certo continua sendo o contexto.
  const hidden = secureEnv({ isSecureContext: false, PublicKeyCredential: undefined, navigator: {} })
  assert.equal(getWebAuthnSupport(hidden).reason, UNSUPPORTED_REASON.CONTEXTO_INSEGURO)
})

test('ambiente sem a propriedade isSecureContext não é tratado como inseguro', () => {
  const env = secureEnv()
  delete env.isSecureContext
  assert.equal(getWebAuthnSupport(env).supported, true)
})

test('cancelamento e expiração (NotAllowedError/AbortError) viram "interrompida"', () => {
  for (const name of ['NotAllowedError', 'AbortError']) {
    assert.deepEqual(eventFromWebAuthnError({ name }), { type: AUTH_EVENT.SECOND_FACTOR_INTERRUPTED })
  }
})

test('SecurityError, NotSupportedError e ConstraintError viram "incompatível" com motivo', () => {
  assert.deepEqual(eventFromWebAuthnError({ name: 'SecurityError' }), { type: AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED, reason: UNSUPPORTED_REASON.SEGURANCA })
  for (const name of ['NotSupportedError', 'ConstraintError']) {
    assert.deepEqual(eventFromWebAuthnError({ name }), { type: AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED, reason: UNSUPPORTED_REASON.AUTENTICADOR })
  }
})

test('qualquer outro erro vira falha genérica, inclusive entrada estranha', () => {
  for (const value of [{ name: 'InvalidStateError' }, { name: 'UnknownError' }, new Error('x'), null, undefined, 'texto', 42, {}]) {
    assert.deepEqual(eventFromWebAuthnError(value), { type: AUTH_EVENT.SECOND_FACTOR_FAILED })
  }
})

test('a mensagem do erro do navegador nunca é lida nem repassada', () => {
  const error = Object.assign(new Error('Dispositivo YubiKey 5C serial 1234567 no site alm.exemplo'), { name: 'NotAllowedError' })
  assert.doesNotMatch(JSON.stringify(eventFromWebAuthnError(error)), /YubiKey|1234567|alm\.exemplo/)
  // Objeto com getter que explode na leitura de `message` não pode quebrar o mapeamento.
  const trap = { name: 'SecurityError', get message() { throw new Error('não deveria ler') } }
  assert.equal(eventFromWebAuthnError(trap).type, AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED)
})

test('eventFromSupport só emite evento quando o dispositivo é incompatível', () => {
  assert.equal(eventFromSupport({ supported: true, reason: null }), null)
  assert.deepEqual(eventFromSupport({ supported: false, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO }), { type: AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO })
  assert.equal(eventFromSupport({ supported: false }).reason, UNSUPPORTED_REASON.SEM_WEBAUTHN)
})
