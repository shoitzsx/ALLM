import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRecoveryArguments } from './scripts/recover-first-admin-args.mjs'

const id = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const valid = ['--usuario-id', id, '--matricula', 'MKADM001',
  '--incident', 'INC-2026-01', '--operator', 'operador-externo',
  '--request-id', requestId, '--confirm', 'RECOVER-FIRST-ADMIN']

test('recuperacao exige mesmo UUID, incidente, operador e confirmacao explicita', () => {
  assert.equal(parseRecoveryArguments(valid).usuarioId, id)
  assert.throws(() => parseRecoveryArguments(valid.slice(0, -2)), /Confirmacao explicita/)
  assert.throws(() => parseRecoveryArguments([...valid, '--request-id', requestId]), /duplicados/)
  assert.throws(() => parseRecoveryArguments([...valid.slice(0, 3), 'mkadm001', ...valid.slice(4)]), /invalidos/)
})
