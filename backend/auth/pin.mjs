import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const N = 32768
const R = 8
const P = 1
const KEY_BYTES = 32
const MAX_MEMORY = 64 * 1024 * 1024

function pepperedPin(pin, pepper) {
  return createHmac('sha256', pepper).update(pin, 'utf8').digest()
}

export async function hashPin(pin, pepper) {
  if (!/^\d{6,12}$/.test(pin) || typeof pepper !== 'string' || pepper.length < 32) {
    throw new TypeError('PIN ou pepper inválido.')
  }
  const salt = randomBytes(16)
  const key = await scrypt(pepperedPin(pin, pepper), salt, KEY_BYTES, {
    N, r: R, p: P, maxmem: MAX_MEMORY,
  })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPin(pin, encoded, pepper) {
  if (typeof pin !== 'string' || typeof encoded !== 'string' || typeof pepper !== 'string') return false
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [n, r, p] = parts.slice(1, 4).map(Number)
  if (n !== N || r !== R || p !== P) return false
  const salt = Buffer.from(parts[4], 'base64url')
  const expected = Buffer.from(parts[5], 'base64url')
  if (salt.length !== 16 || expected.length !== KEY_BYTES
    || salt.toString('base64url') !== parts[4]
    || expected.toString('base64url') !== parts[5]) return false
  const actual = await scrypt(pepperedPin(pin, pepper), salt, KEY_BYTES, {
    N, r: R, p: P, maxmem: MAX_MEMORY,
  })
  return timingSafeEqual(actual, expected)
}
