import { randomInt, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadProjectEnvironment } from '../config/env.mjs'
import { hashPin } from '../auth/pin.mjs'
import { createOpaqueToken, hashOpaqueToken } from '../auth/webauthnSecurity.mjs'
import { parseProvisionArguments } from './provision-first-admin-args.mjs'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}.`)
  return value
}

export async function main(argv = process.argv.slice(2)) {
  loadProjectEnvironment()
  const input = parseProvisionArguments(argv)
  if (!process.stdout.isTTY) {
    throw new Error('A saida deve ser um terminal; redirecionamento de PIN/codigo e proibido.')
  }
  const connectionString = required('ALM_PROVISION_DATABASE_URL')
  const pepper = required('ALM_PIN_PEPPER_V1')
  const pinLength = Number(process.env.ALM_PIN_LENGTH || 8)
  if (!Number.isInteger(pinLength) || pinLength < 6 || pinLength > 12) {
    throw new Error('ALM_PIN_LENGTH deve estar entre 6 e 12.')
  }

  const lower = 10 ** (pinLength - 1)
  const temporaryPin = String(randomInt(lower, 10 ** pinLength))
  const activationCode = createOpaqueToken()
  const pinHash = await hashPin(temporaryPin, pepper)
  const codeHash = hashOpaqueToken(activationCode)
  const requestId = randomUUID()
  const expiresAt = new Date(Date.now() + input.validHours * 60 * 60 * 1000)
  const client = new pg.Client({ connectionString, application_name: 'alm-provision-first-admin' })

  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE alm_provisioner')
    const { rows: [created] } = await client.query({
      text: 'SELECT alm.provisionar_primeiro_administrador($1,$2,$3,$4,$5,$6,$7) AS id',
      values: [input.matricula, input.nome, pinHash, codeHash,
        input.approvalReference, requestId, expiresAt],
    })
    await client.query('COMMIT')
    // Exibicao unica para entrega segura; nunca persiste PIN/codigo em texto puro.
    process.stdout.write(`${JSON.stringify({ usuarioId: created.id, matricula: input.matricula,
      temporaryPin, activationCode, expiresAt: expiresAt.toISOString() }, null, 2)}\n`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Provisionamento abortado: ${error.message}`)
    process.exitCode = 1
  })
}
