import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseProvisionArguments } from './scripts/provision-first-admin-args.mjs'

test('provisionamento exige confirmacao e referencia de aprovacao explicitas', () => {
  const base = ['--matricula', 'adm001', '--nome', 'Admin Inicial',
    '--approval-reference', 'CHANGE-1234']
  assert.throws(() => parseProvisionArguments(base), /Aprovacao explicita/)
  assert.deepEqual(parseProvisionArguments([...base, '--confirm', 'PROVISION-FIRST-ADMIN']), {
    matricula: 'ADM001', nome: 'Admin Inicial', approvalReference: 'CHANGE-1234', validHours: 24,
  })
  assert.throws(() => parseProvisionArguments([...base, '--confirm', 'sim']), /Aprovacao explicita/)
  assert.throws(() => parseProvisionArguments([...base, '--confirm', 'PROVISION-FIRST-ADMIN',
    '--valid-hours', '73']), /entre 1 e 72/)
})
