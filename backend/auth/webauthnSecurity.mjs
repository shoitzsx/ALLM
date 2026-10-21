import { createHash, randomBytes } from 'node:crypto'

export const PRE_MFA_COOKIE_NAME = '__Host-alm_pre_mfa'
export const SESSION_COOKIE_NAME = '__Host-alm_session'
export const AUTH_TOKEN_BYTES = 32
export const AUTH_COOKIE_MAX_AGE_SECONDS = 5 * 60

const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

/** Creates a high-entropy opaque token suitable for an HttpOnly cookie. */
export function createOpaqueToken(byteLength = AUTH_TOKEN_BYTES) {
  if (!Number.isInteger(byteLength) || byteLength < 32 || byteLength > 128) {
    throw new RangeError('Opaque token length must be an integer from 32 to 128 bytes.')
  }
  return randomBytes(byteLength).toString('base64url')
}

/** Strictly decodes canonical, unpadded Base64URL. Node's decoder is permissive. */
export function decodeBase64Url(value, { minBytes = 1, maxBytes = 4096 } = {}) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) {
    throw new TypeError('Expected an unpadded Base64URL value.')
  }
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length < minBytes || bytes.length > maxBytes || bytes.toString('base64url') !== value) {
    throw new TypeError('Base64URL value is invalid or outside the permitted size.')
  }
  return bytes
}

/** Stores only a SHA-256 digest of an opaque Base64URL token. */
export function hashOpaqueToken(token) {
  const bytes = decodeBase64Url(token, { minBytes: AUTH_TOKEN_BYTES, maxBytes: AUTH_TOKEN_BYTES })
  return createHash('sha256').update(bytes).digest()
}

/** Returns the exact value of a cookie, rejecting duplicate cookie names. */
export function readCookie(header, name) {
  if (typeof header !== 'string' || !COOKIE_NAME_PATTERN.test(name)) return null
  const matches = []
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) matches.push(part.slice(separator + 1).trim())
  }
  if (matches.length !== 1) return null
  try {
    decodeBase64Url(matches[0], { minBytes: AUTH_TOKEN_BYTES, maxBytes: AUTH_TOKEN_BYTES })
    return matches[0]
  } catch {
    return null
  }
}

export function serializeOpaqueCookie(name, token, { maxAge = AUTH_COOKIE_MAX_AGE_SECONDS } = {}) {
  if (!COOKIE_NAME_PATTERN.test(name)) throw new TypeError('Invalid cookie name.')
  decodeBase64Url(token, { minBytes: AUTH_TOKEN_BYTES, maxBytes: 128 })
  if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > AUTH_COOKIE_MAX_AGE_SECONDS) {
    throw new RangeError(`Cookie max age must be between 1 and ${AUTH_COOKIE_MAX_AGE_SECONDS} seconds.`)
  }
  // No Domain attribute is emitted; this is required for __Host- cookies.
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
}

export function clearOpaqueCookie(name) {
  if (!COOKIE_NAME_PATTERN.test(name)) throw new TypeError('Invalid cookie name.')
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
}

export function serializeSessionCookie(token, maxAge = 8 * 60 * 60) {
  decodeBase64Url(token, { minBytes: AUTH_TOKEN_BYTES, maxBytes: AUTH_TOKEN_BYTES })
  if (!Number.isInteger(maxAge) || maxAge < 60 || maxAge > 24 * 60 * 60) {
    throw new RangeError('Session lifetime must be between one minute and one day.')
  }
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
}
