import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WebAuthnDataError,
  authenticate,
  base64UrlToBytes,
  buildCreationOptions,
  buildRequestOptions,
  bytesToBase64Url,
  register,
  serializeAssertion,
  serializeAttestation,
} from './webauthnBrowser.js'
import { AUTH_EVENT } from './authStates.js'
import { eventFromWebAuthnError } from './webauthnSupport.js'

/**
 * Cerimônia WebAuthn com a API NATIVA do navegador, nos formatos exatos que o
 * backend usa: opções em JSON do @simplewebauthn/server 14 (challenge e ids em
 * Base64URL) e respostas AuthenticationResponseJSON / RegistrationResponseJSON
 * (ver backend/integration/authPostgres.test.mjs).
 */
const bytes = (...values) => Uint8Array.from(values)
const buffer = (...values) => bytes(...values).buffer
const b64 = (...values) => bytesToBase64Url(bytes(...values))
const CHALLENGE = bytesToBase64Url(new Uint8Array(32).fill(7))

test('Base64URL: ida e volta, sem preenchimento, e rejeita o que não é canônico', () => {
  assert.equal(bytesToBase64Url(bytes(251, 255, 254)), '-__-')
  assert.deepEqual([...base64UrlToBytes('-__-')], [251, 255, 254])
  assert.equal(bytesToBase64Url(bytes(1, 2, 3, 4)), 'AQIDBA')
  assert.deepEqual([...base64UrlToBytes('AQIDBA')], [1, 2, 3, 4])
  for (const bad of ['AQIDBA==', 'AQ+/', 'A', '', 'AQ ID', null, undefined, 42, 'AB']) {
    assert.throws(() => base64UrlToBytes(bad), WebAuthnDataError, String(bad))
  }
  assert.throws(() => base64UrlToBytes('AQIDBA', { maxBytes: 3 }), WebAuthnDataError)
  assert.throws(() => base64UrlToBytes('AQ', { minBytes: 2 }), WebAuthnDataError)
})

const requestJson = () => ({
  challenge: CHALLENGE,
  timeout: 60000,
  rpId: 'localhost',
  allowCredentials: [{ id: b64(1, 2, 3), type: 'public-key', transports: ['internal', 'invalid'] }],
  userVerification: 'required',
})

test('opções de login: converte challenge e ids para bytes e preserva userVerification "required"', () => {
  const { publicKey } = buildRequestOptions(requestJson())
  assert.equal(publicKey.challenge.byteLength, 32)
  assert.deepEqual([...new Uint8Array(publicKey.allowCredentials[0].id)], [1, 2, 3])
  assert.equal(publicKey.allowCredentials[0].type, 'public-key')
  assert.deepEqual(publicKey.allowCredentials[0].transports, ['internal'], 'transporte desconhecido é descartado')
  assert.equal(publicKey.rpId, 'localhost')
  assert.equal(publicKey.timeout, 60000)
  assert.equal(publicKey.userVerification, 'required')
})

test('opções de login malformadas são recusadas antes de chamar o navegador', () => {
  const bad = [
    null, [], 'texto', {},
    { ...requestJson(), challenge: 'não é base64url!' },
    { ...requestJson(), challenge: 'AAAA' },
    { ...requestJson(), allowCredentials: 'x' },
    { ...requestJson(), allowCredentials: [{ id: '***', type: 'public-key' }] },
    { ...requestJson(), allowCredentials: [{ id: b64(1), type: 'password' }] },
    { ...requestJson(), userVerification: 'whatever' },
    { ...requestJson(), rpId: 42 },
  ]
  for (const value of bad) assert.throws(() => buildRequestOptions(value), WebAuthnDataError, JSON.stringify(value)?.slice(0, 60))
})

const creationJson = () => ({
  rp: { name: 'ALM 2.0', id: 'localhost' },
  user: { id: b64(0x30, 0x30), name: '000123', displayName: 'Pessoa de teste' },
  challenge: CHALLENGE,
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -8, type: 'public-key' }, { alg: -257, type: 'public-key' }],
  timeout: 60000,
  attestation: 'none',
  excludeCredentials: [{ id: b64(9, 9), type: 'public-key', transports: ['usb'] }],
  authenticatorSelection: { userVerification: 'required', residentKey: 'preferred', requireResidentKey: false },
})

test('opções de cadastro: bytes para challenge, user.id e exclusões; algoritmos e seleção preservados', () => {
  const { publicKey } = buildCreationOptions(creationJson())
  assert.equal(publicKey.rp.id, 'localhost')
  assert.deepEqual([...new Uint8Array(publicKey.user.id)], [0x30, 0x30])
  assert.equal(publicKey.user.name, '000123')
  assert.equal(publicKey.challenge.byteLength, 32)
  assert.deepEqual(publicKey.pubKeyCredParams.map(({ alg }) => alg), [-7, -8, -257])
  assert.equal(publicKey.attestation, 'none')
  assert.deepEqual([...new Uint8Array(publicKey.excludeCredentials[0].id)], [9, 9])
  assert.equal(publicKey.authenticatorSelection.userVerification, 'required')
  assert.equal(publicKey.authenticatorSelection.residentKey, 'preferred')
})

test('opções de cadastro malformadas são recusadas', () => {
  const base = creationJson()
  for (const value of [
    null, {}, { ...base, rp: null }, { ...base, user: { ...base.user, id: '***' } },
    { ...base, user: { ...base.user, name: '' } }, { ...base, pubKeyCredParams: [] },
    { ...base, pubKeyCredParams: [{ alg: 'x', type: 'public-key' }] }, { ...base, challenge: 'AAAA' },
    { ...base, attestation: 'direct-injected' },
  ]) assert.throws(() => buildCreationOptions(value), WebAuthnDataError)
})

function fakeAssertion({ userHandle = buffer(5, 6) } = {}) {
  return {
    id: b64(1, 2, 3), rawId: buffer(1, 2, 3), type: 'public-key', authenticatorAttachment: 'platform',
    response: { authenticatorData: buffer(10), clientDataJSON: buffer(11), signature: buffer(12), userHandle },
    getClientExtensionResults: () => ({}),
  }
}

test('resposta de login serializada como AuthenticationResponseJSON', () => {
  const json = serializeAssertion(fakeAssertion())
  assert.deepEqual(json, {
    id: b64(1, 2, 3), rawId: b64(1, 2, 3), type: 'public-key', authenticatorAttachment: 'platform',
    response: { authenticatorData: b64(10), clientDataJSON: b64(11), signature: b64(12), userHandle: b64(5, 6) },
    clientExtensionResults: {},
  })
  assert.equal(serializeAssertion(fakeAssertion({ userHandle: null })).response.userHandle, null)
  assert.doesNotThrow(() => JSON.stringify(json), 'precisa ser JSON puro (nada de ArrayBuffer)')
})

test('resposta de login inválida (nulo, tipo errado, campos ausentes) vira erro de dados', () => {
  for (const value of [null, undefined, {}, { type: 'password' }, { ...fakeAssertion(), type: 'password' }, { ...fakeAssertion(), response: {} },
    { ...fakeAssertion(), response: { authenticatorData: 'x', clientDataJSON: 'x', signature: 'x' } }]) {
    assert.throws(() => serializeAssertion(value), WebAuthnDataError)
  }
})

test('resposta de cadastro serializada como RegistrationResponseJSON, com transportes', () => {
  const credential = {
    id: b64(4, 5), rawId: buffer(4, 5), type: 'public-key', authenticatorAttachment: 'cross-platform',
    response: { clientDataJSON: buffer(1), attestationObject: buffer(2), getTransports: () => ['usb', 'nfc'] },
    getClientExtensionResults: () => ({}),
  }
  assert.deepEqual(serializeAttestation(credential), {
    id: b64(4, 5), rawId: b64(4, 5), type: 'public-key', authenticatorAttachment: 'cross-platform',
    response: { clientDataJSON: b64(1), attestationObject: b64(2), transports: ['usb', 'nfc'] },
    clientExtensionResults: {},
  })
  const withoutTransports = { ...credential, response: { clientDataJSON: buffer(1), attestationObject: buffer(2) } }
  assert.deepEqual(serializeAttestation(withoutTransports).response.transports, [])
})

test('authenticate chama navigator.credentials.get com as opções convertidas e devolve JSON', async () => {
  let received
  const credentials = { get: async (options) => { received = options; return fakeAssertion() } }
  const signal = new AbortController().signal
  const json = await authenticate(requestJson(), { credentials, signal })
  assert.equal(received.signal, signal)
  assert.equal(received.publicKey.challenge.byteLength, 32)
  assert.equal(received.publicKey.userVerification, 'required')
  assert.equal(json.type, 'public-key')
  assert.equal(json.response.signature, b64(12))
})

test('register chama navigator.credentials.create e devolve JSON', async () => {
  let received
  const credentials = {
    create: async (options) => {
      received = options
      return { id: b64(4), rawId: buffer(4), type: 'public-key', response: { clientDataJSON: buffer(1), attestationObject: buffer(2), getTransports: () => ['internal'] }, getClientExtensionResults: () => ({}) }
    },
  }
  const json = await register(creationJson(), { credentials })
  assert.equal(received.publicKey.rp.name, 'ALM 2.0')
  assert.equal(json.response.transports[0], 'internal')
})

test('sem navigator.credentials o erro é de suporte, não uma exceção solta', async () => {
  await assert.rejects(authenticate(requestJson(), { credentials: undefined }), (error) => error.name === 'NotSupportedError')
  await assert.rejects(register(creationJson(), { credentials: {} }), (error) => error.name === 'NotSupportedError')
})

test('credencial nula (o navegador não devolveu nada) é falha, não sucesso', async () => {
  await assert.rejects(authenticate(requestJson(), { credentials: { get: async () => null } }), WebAuthnDataError)
  await assert.rejects(register(creationJson(), { credentials: { create: async () => null } }), WebAuthnDataError)
})

test('erros do navegador chegam intactos e mapeiam para os eventos da tela (cancelar/expirar/incompatível)', async () => {
  const fail = (name) => ({ get: async () => { throw Object.assign(new Error('mensagem do navegador com detalhes'), { name }) } })
  await assert.rejects(authenticate(requestJson(), { credentials: fail('NotAllowedError') }), (error) => {
    assert.equal(eventFromWebAuthnError(error).type, AUTH_EVENT.SECOND_FACTOR_INTERRUPTED)
    return true
  })
  await assert.rejects(authenticate(requestJson(), { credentials: fail('SecurityError') }), (error) => {
    assert.equal(eventFromWebAuthnError(error).type, AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED)
    return true
  })
  // Dados inválidos viram falha genérica (nunca "acesso").
  await assert.rejects(authenticate({}, { credentials: fail('X') }), (error) => {
    assert.equal(eventFromWebAuthnError(error).type, AUTH_EVENT.SECOND_FACTOR_FAILED)
    return true
  })
})
