import test from 'node:test'
import assert from 'node:assert/strict'
import { REGISTRATION_REASON } from './registrationFlow.js'
import { UNSUPPORTED_REASON } from './authStates.js'
import {
  activeCount,
  canRevoke,
  describeAuthenticator,
  deviceErrorCopy,
  registrationErrorCopy,
  validateRevocationReason,
} from './deviceCopy.js'

const row = (overrides = {}) => ({
  id: '0b6f3c1e-8a52-4d3f-9a11-2c5d7e8f9a01', nome: 'Autenticador', metodoCadastro: 'ATIVACAO',
  criadoEm: '2026-10-21T13:00:00.000Z', ultimoUsoEm: null, revogadoEm: null, backupEligible: false, backupState: false, ...overrides,
})
const fmt = (value) => `fmt(${value})`

test('descrição do dispositivo: nome, método de cadastro, datas e estado', () => {
  const active = describeAuthenticator(row({ ultimoUsoEm: '2026-10-22T09:00:00.000Z' }), { format: fmt })
  assert.equal(active.name, 'Autenticador')
  assert.equal(active.method, 'Ativação autorizada')
  assert.equal(active.created, 'fmt(2026-10-21T13:00:00.000Z)')
  assert.equal(active.lastUsed, 'fmt(2026-10-22T09:00:00.000Z)')
  assert.equal(active.revoked, false)
  assert.equal(active.syncedAcrossDevices, false)

  const never = describeAuthenticator(row(), { format: fmt })
  assert.equal(never.lastUsed, 'Nunca usado')

  const revoked = describeAuthenticator(row({ revogadoEm: '2026-10-23T09:00:00.000Z', metodoCadastro: 'RECUPERACAO', backupState: true }), { format: fmt })
  assert.equal(revoked.revoked, true)
  assert.equal(revoked.revokedAt, 'fmt(2026-10-23T09:00:00.000Z)')
  assert.equal(revoked.method, 'Recuperação autorizada')
  assert.equal(revoked.syncedAcrossDevices, true)

  assert.equal(describeAuthenticator(row({ metodoCadastro: 'AUTENTICADA' }), { format: fmt }).method, 'Cadastrado com a sessão ativa')
  assert.equal(describeAuthenticator(row({ metodoCadastro: 'OUTRO' }), { format: fmt }).method, 'Cadastro registrado')
  assert.equal(describeAuthenticator(row({ nome: null }), { format: fmt }).name, 'Autenticador')
})

test('nunca expõe chave, credencial ou identificador técnico na descrição', () => {
  const described = describeAuthenticator(row(), { format: fmt })
  assert.deepEqual(Object.keys(described).sort(), ['created', 'id', 'lastUsed', 'method', 'name', 'revoked', 'revokedAt', 'syncedAcrossDevices'])
})

test('só dá para remover um dispositivo ativo quando sobra pelo menos outro ativo', () => {
  const a = row({ id: 'a' })
  const b = row({ id: 'b' })
  const old = row({ id: 'c', revogadoEm: '2026-01-01T00:00:00Z' })
  assert.equal(activeCount([a, b, old]), 2)
  assert.equal(canRevoke([a, b, old], a), true)
  assert.equal(canRevoke([a, old], a), false, 'o último ativo não pode ser removido (o servidor também recusa)')
  assert.equal(canRevoke([a, b, old], old), false, 'já revogado')
  assert.equal(canRevoke([], a), false)
})

test('motivo da remoção: obrigatório, sem espaços nas pontas, com limite', () => {
  assert.deepEqual(validateRevocationReason('  Aparelho perdido  '), { ok: true, value: 'Aparelho perdido' })
  for (const bad of ['', '   ', null, undefined, 42, 'x'.repeat(201)]) {
    const result = validateRevocationReason(bad)
    assert.equal(result.ok, false, String(bad))
    assert.match(result.message, /motivo/i)
  }
  assert.equal(validateRevocationReason('x'.repeat(200)).ok, true)
})

test('erros de cadastro: textos fixos, sem culpar a conta nem revelar detalhes', () => {
  const reasons = Object.values(REGISTRATION_REASON)
  for (const reason of reasons) {
    const copy = registrationErrorCopy(reason)
    assert.ok(copy.title && copy.description, reason)
    assert.ok(['error', 'warning', 'info'].includes(copy.tone), reason)
    assert.doesNotMatch(`${copy.title} ${copy.description}`, /pg_|sql|stack|exception|undefined|null|token|cookie/i, reason)
  }
  assert.equal(registrationErrorCopy(REGISTRATION_REASON.INVALID_CREDENTIALS).title, 'Matrícula, PIN ou código inválidos.')
  assert.match(registrationErrorCopy(REGISTRATION_REASON.RECENT_MFA_REQUIRED).description, /entre novamente/i)
  assert.match(registrationErrorCopy(REGISTRATION_REASON.ALREADY_REGISTERED).title, /já.*cadastrad/i)
  assert.match(registrationErrorCopy(REGISTRATION_REASON.UNSUPPORTED, UNSUPPORTED_REASON.CONTEXTO_INSEGURO).description, /HTTPS/)
  assert.equal(registrationErrorCopy('qualquer-coisa').title, registrationErrorCopy(REGISTRATION_REASON.FAILED).title)
})

test('erros de listar/remover dispositivos: por tipo, em português fixo', () => {
  assert.match(deviceErrorCopy('recent_mfa_required').description, /entre novamente/i)
  assert.match(deviceErrorCopy('conflict').title, /outro dispositivo/i)
  assert.match(deviceErrorCopy('not_found').title, /não encontrado/i)
  assert.match(deviceErrorCopy('network').title, /conectar/i)
  assert.match(deviceErrorCopy('forbidden').title, /permiss/i)
  assert.match(deviceErrorCopy('rate_limited').title, /tentativas/i)
  assert.equal(deviceErrorCopy('qualquer').title, deviceErrorCopy('unavailable').title)
  assert.equal(deviceErrorCopy(undefined).title, deviceErrorCopy('unavailable').title)
})
