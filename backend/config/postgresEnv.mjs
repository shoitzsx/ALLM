import { loadProjectEnvironment } from './env.mjs'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}.`)
  return value
}

export function readPostgresEnvironment() {
  loadProjectEnvironment()
  const origins = required('ALM_WEBAUTHN_ORIGINS').split(',').map((value) => value.trim()).filter(Boolean)
  const pinLength = Number(process.env.ALM_PIN_LENGTH || 8)
  if (!Number.isInteger(pinLength) || pinLength < 6 || pinLength > 12) {
    throw new Error('ALM_PIN_LENGTH deve estar entre 6 e 12.')
  }
  return {
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '127.0.0.1',
    rpName: process.env.ALM_WEBAUTHN_RP_NAME?.trim() || 'ALM 2.0',
    rpId: required('ALM_WEBAUTHN_RP_ID'),
    origins,
    pepper: required('ALM_PIN_PEPPER_V1'),
    pinLength,
  }
}
