import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AUTH_TOKEN_BYTES,
  PRE_MFA_COOKIE_NAME,
  clearOpaqueCookie,
  createOpaqueToken,
  decodeBase64Url,
  hashOpaqueToken,
  readCookie,
  serializeOpaqueCookie,
} from './auth/webauthnSecurity.mjs'
import { createWebAuthnAdapter } from './auth/webauthn.mjs'

test('opaque authentication tokens are high entropy and stored as fixed-size hashes', () => {
  const first = createOpaqueToken()
  const second = createOpaqueToken()

  assert.notEqual(first, second)
  assert.equal(decodeBase64Url(first).length, AUTH_TOKEN_BYTES)
  assert.equal(hashOpaqueToken(first).length, 32)
  assert.notDeepEqual(hashOpaqueToken(first), hashOpaqueToken(second))
})

test('Base64URL parsing rejects padding, invalid characters and non-canonical encodings', () => {
  assert.throws(() => decodeBase64Url('abc='), /Base64URL/)
  assert.throws(() => decodeBase64Url('abc+'), /Base64URL/)
  assert.throws(() => hashOpaqueToken(createOpaqueToken(48)), /size/)
})

test('pre-MFA cookie is short-lived, host-only, HttpOnly, Secure and SameSite Strict', () => {
  const token = createOpaqueToken()
  const cookie = serializeOpaqueCookie(PRE_MFA_COOKIE_NAME, token)

  assert.match(cookie, /^__Host-alm_pre_mfa=/)
  assert.match(cookie, /; Path=\//)
  assert.match(cookie, /; Max-Age=300/)
  assert.match(cookie, /; HttpOnly/)
  assert.match(cookie, /; Secure/)
  assert.match(cookie, /; SameSite=Strict/)
  assert.doesNotMatch(cookie, /Domain=/i)
  assert.equal(readCookie(cookie, PRE_MFA_COOKIE_NAME), token)
})

test('cookie lookup rejects missing, malformed and duplicate pre-MFA cookies', () => {
  const token = createOpaqueToken()
  assert.equal(readCookie('', PRE_MFA_COOKIE_NAME), null)
  assert.equal(readCookie(`${PRE_MFA_COOKIE_NAME}=bad=`, PRE_MFA_COOKIE_NAME), null)
  assert.equal(readCookie(`${PRE_MFA_COOKIE_NAME}=${token}; ${PRE_MFA_COOKIE_NAME}=${token}`, PRE_MFA_COOKIE_NAME), null)
})

test('cookie lifetime is constrained and logout clears it with matching security attributes', () => {
  const token = createOpaqueToken()
  assert.throws(() => serializeOpaqueCookie(PRE_MFA_COOKIE_NAME, token, { maxAge: 301 }), /max age/)
  assert.equal(
    clearOpaqueCookie(PRE_MFA_COOKIE_NAME),
    '__Host-alm_pre_mfa=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
  )
})

test('WebAuthn adapter only accepts exact HTTPS origins, except loopback development', () => {
  assert.throws(() => createWebAuthnAdapter({ rpName: 'ALM', rpId: 'allm.example.com', origins: ['https://allm.example.com/path'] }), /exact HTTPS origins/)
  assert.throws(() => createWebAuthnAdapter({ rpName: 'ALM', rpId: 'allm.example.com', origins: ['http://allm.example.com'] }), /exact HTTPS origins/)
  assert.throws(() => createWebAuthnAdapter({ rpName: 'ALM', rpId: 'https://allm.example.com', origins: ['https://allm.example.com'] }), /RP ID/)
  assert.doesNotThrow(() => createWebAuthnAdapter({ rpName: 'ALM', rpId: 'localhost', origins: ['http://localhost:5173'] }))
})

test('authentication options use a 32-byte persisted challenge hash and require user verification', async () => {
  const adapter = createWebAuthnAdapter({ rpName: 'ALM', rpId: 'localhost', origins: ['http://localhost:5173'] })
  const challenge = Buffer.alloc(32, 7)
  const options = await adapter.generateAuthenticationOptions({
    challenge,
    credentials: [{ credentialId: Buffer.from([1, 2, 3]), transports: ['internal', 'invalid'] }],
  })

  assert.equal(Buffer.from(options.challenge, 'base64url').equals(challenge), true)
  assert.deepEqual(options.allowCredentials, [{ id: Buffer.from([1, 2, 3]).toString('base64url'), type: 'public-key', transports: ['internal'] }])
  assert.equal(options.userVerification, 'required')
  assert.deepEqual(adapter.hashChallenge(challenge), hashOpaqueToken(challenge.toString('base64url')))
})

test('registration options keep the challenge opaque and permit passkeys and external authenticators', async () => {
  const adapter = createWebAuthnAdapter({ rpName: 'ALM', rpId: 'localhost', origins: ['http://localhost:5173'] })
  const challenge = Buffer.alloc(32, 9)
  const options = await adapter.generateRegistrationOptions({
    challenge,
    userId: '00000000-0000-4000-8000-000000000001',
    userName: '000123',
    displayName: 'Pessoa de teste',
  })

  assert.equal(options.rp.id, 'localhost')
  assert.equal(Buffer.from(options.challenge, 'base64url').equals(challenge), true)
  assert.equal(options.authenticatorSelection.userVerification, 'required')
  assert.equal(options.authenticatorSelection.residentKey, 'preferred')
  assert.deepEqual(options.pubKeyCredParams.map(({ alg }) => alg), [-7, -8, -257])
})

test('authentication rejects corrupt persisted credential counters before verification', async () => {
  const adapter = createWebAuthnAdapter({ rpName: 'ALM', rpId: 'localhost', origins: ['http://localhost:5173'] })
  await assert.rejects(adapter.verifyAuthentication({
    response: {},
    expectedChallengeHash: Buffer.alloc(32),
    credential: { credentialId: Buffer.from([1]), publicKeyCose: Buffer.from([1]), signCount: -1 },
  }), /signature counter is invalid/)
})
