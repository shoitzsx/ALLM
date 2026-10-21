import { timingSafeEqual, createHash } from 'node:crypto'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { COSEALG, decodeCredentialPublicKey } from '@simplewebauthn/server/helpers'
import { decodeBase64Url } from './webauthnSecurity.mjs'

export const WEBAUTHN_SUPPORTED_ALGORITHMS = Object.freeze([
  COSEALG.ES256,
  COSEALG.EdDSA,
  COSEALG.RS256,
])

const DEFAULT_TIMEOUT_MS = 60_000
const ALLOWED_TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'])

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required.`)
  return value.trim()
}

function normalizeOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new TypeError('At least one exact WebAuthn origin is required.')
  }
  return [...new Set(origins.map((value) => {
    const origin = requireNonEmptyString(value, 'WebAuthn origin')
    let parsed
    try { parsed = new URL(origin) } catch { throw new TypeError('WebAuthn origin must be an absolute origin.') }
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if ((!localHttp && parsed.protocol !== 'https:') || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new TypeError('WebAuthn origins must be exact HTTPS origins (HTTP is allowed only on loopback).')
    }
    return origin
  }))]
}

function normalizeRpId(value) {
  const rpId = requireNonEmptyString(value, 'WebAuthn RP ID').toLowerCase()
  if (rpId.includes('://') || rpId.includes('/') || rpId.includes(':') || /\s/.test(rpId)) {
    throw new TypeError('WebAuthn RP ID must be a hostname without scheme, path or port.')
  }
  try {
    const parsed = new URL(`https://${rpId}`)
    if (parsed.hostname !== rpId) throw new Error('not a hostname')
  } catch {
    throw new TypeError('WebAuthn RP ID must be a valid hostname.')
  }
  return rpId
}

function challengeBytes(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : decodeBase64Url(value, { minBytes: 32, maxBytes: 32 })
  if (bytes.length !== 32) throw new TypeError('WebAuthn challenges must be exactly 32 bytes.')
  return bytes
}

function challengeHash(value) {
  return createHash('sha256').update(challengeBytes(value)).digest()
}

function matchesChallengeHash(challenge, expectedHash) {
  if (!Buffer.isBuffer(expectedHash) && !(expectedHash instanceof Uint8Array)) return false
  const expected = Buffer.from(expectedHash)
  if (expected.length !== 32 || typeof challenge !== 'string') return false
  try {
    const actual = challengeHash(challenge)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function transports(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((value) => ALLOWED_TRANSPORTS.has(value)))]
}

function credentialIdFromBytes(value) {
  const bytes = Buffer.from(value || [])
  if (bytes.length === 0 || bytes.length > 1024) throw new TypeError('Credential ID has an invalid size.')
  return bytes.toString('base64url')
}

function normalizeSignCount(value) {
  const count = typeof value === 'bigint' ? Number(value) : Number(value || 0)
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff_ffff) {
    throw new TypeError('Stored WebAuthn signature counter is invalid.')
  }
  return count
}

/** Adapter around the selected WebAuthn implementation; it does not persist state. */
export function createWebAuthnAdapter({ rpName, rpId, origins, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const relyingPartyName = requireNonEmptyString(rpName, 'WebAuthn RP name')
  const relyingPartyId = normalizeRpId(rpId)
  const expectedOrigins = normalizeOrigins(origins)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 15_000 || timeoutMs > 120_000) {
    throw new RangeError('WebAuthn timeout must be between 15 and 120 seconds.')
  }

  return {
    hashChallenge: challengeHash,
    rpId: relyingPartyId,
    origins: expectedOrigins,

    async generateAuthenticationOptions({ challenge, credentials }) {
      const challengeBuffer = challengeBytes(challenge)
      const allowCredentials = (credentials || []).map((credential) => ({
        id: credentialIdFromBytes(credential.credentialId),
        transports: transports(credential.transports),
      }))
      return generateAuthenticationOptions({
        rpID: relyingPartyId,
        challenge: challengeBuffer,
        timeout: timeoutMs,
        userVerification: 'required',
        allowCredentials,
      })
    },

    async generateRegistrationOptions({ challenge, userId, userName, displayName, credentials = [] }) {
      const userIdBytes = Buffer.from(requireNonEmptyString(userId, 'WebAuthn user ID'), 'utf8')
      if (userIdBytes.length > 64) throw new RangeError('WebAuthn user ID must not exceed 64 bytes.')
      return generateRegistrationOptions({
        rpName: relyingPartyName,
        rpID: relyingPartyId,
        userID: userIdBytes,
        userName: requireNonEmptyString(userName, 'WebAuthn user name'),
        userDisplayName: requireNonEmptyString(displayName, 'WebAuthn display name'),
        challenge: challengeBytes(challenge),
        timeout: timeoutMs,
        attestationType: 'none',
        supportedAlgorithmIDs: [...WEBAUTHN_SUPPORTED_ALGORITHMS],
        excludeCredentials: credentials.map((credential) => ({
          id: credentialIdFromBytes(credential.credentialId),
          transports: transports(credential.transports),
        })),
        authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      })
    },

    async verifyAuthentication({ response, expectedChallengeHash, credential, expectedOrigin }) {
      const publicKey = Buffer.from(credential.publicKeyCose || [])
      if (publicKey.length === 0 || publicKey.length > 4096) throw new TypeError('Stored COSE public key has an invalid size.')
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (challenge) => matchesChallengeHash(challenge, expectedChallengeHash),
        expectedOrigin: expectedOrigin || expectedOrigins,
        expectedRPID: relyingPartyId,
        requireUserVerification: true,
        credential: {
          id: credentialIdFromBytes(credential.credentialId),
          publicKey,
          counter: normalizeSignCount(credential.signCount),
          transports: transports(credential.transports),
        },
      })
      return result
    },

    async verifyRegistration({ response, expectedChallengeHash, expectedOrigin }) {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: (challenge) => matchesChallengeHash(challenge, expectedChallengeHash),
        expectedOrigin: expectedOrigin || expectedOrigins,
        expectedRPID: relyingPartyId,
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: [...WEBAUTHN_SUPPORTED_ALGORITHMS],
      })
      if (!result.verified || !result.registrationInfo) return { verified: false }

      const credential = result.registrationInfo.credential
      const cose = decodeCredentialPublicKey(credential.publicKey)
      // COSE key common parameter label 3 is the algorithm identifier.
      const algorithm = cose.get(3)
      if (!Number.isInteger(algorithm) || !WEBAUTHN_SUPPORTED_ALGORITHMS.includes(algorithm)) {
        throw new TypeError('Registration returned an unsupported COSE algorithm.')
      }
      return {
        verified: true,
        credentialId: decodeBase64Url(credential.id, { minBytes: 1, maxBytes: 1024 }),
        publicKeyCose: Buffer.from(credential.publicKey),
        algorithmCose: algorithm,
        signCount: credential.counter,
        transports: transports(credential.transports),
        aaguid: result.registrationInfo.aaguid,
        backupEligible: result.registrationInfo.credentialDeviceType === 'multiDevice',
        backupState: result.registrationInfo.credentialBackedUp,
        userVerified: result.registrationInfo.userVerified,
      }
    },
  }
}
