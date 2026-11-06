import { randomInt } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadProjectEnvironment } from '../config/env.mjs'
import { hashPin } from '../auth/pin.mjs'
import { createOpaqueToken, hashOpaqueToken } from '../auth/webauthnSecurity.mjs'
import { parseRecoveryArguments } from './recover-first-admin-args.mjs'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}.`)
  return value
}

async function postcheck(client, input) {
  await client.query('BEGIN READ ONLY')
  try {
    await client.query('SET LOCAL ROLE alm_provisioner')
    const { rows: [result] } = await client.query(
      'SELECT alm.verificar_recuperacao_primeiro_administrador($1,$2) AS state',
      [input.requestId, input.usuarioId])
    await client.query('COMMIT')
    return result.state
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

export async function main(argv = process.argv.slice(2)) {
  loadProjectEnvironment()
  const input = parseRecoveryArguments(argv)
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Execute somente em terminal privado interativo, sem redirecionar entrada/saida.')
  }
  const connectionString = required('ALM_PROVISION_DATABASE_URL')
  const pepper = required('ALM_PIN_PEPPER_V2')
  const pinLength = Number(process.env.ALM_PIN_LENGTH || 8)
  if (!Number.isInteger(pinLength) || pinLength < 6 || pinLength > 12) {
    throw new Error('ALM_PIN_LENGTH deve estar entre 6 e 12.')
  }
  if (pepper.length < 32 || pepper === process.env.ALM_PIN_PEPPER_V1?.trim()) {
    throw new Error('ALM_PIN_PEPPER_V2 deve ser novo, distinto do V1 e ter ao menos 32 caracteres.')
  }
  const client = new pg.Client({ connectionString,
    application_name: 'alm-recover-first-admin' })
  let committed = false
  let commitAttempted = false
  try {
    await client.connect()
    const prior = await postcheck(client, input)
    if (prior.applied) throw new Error('Request_id ja aplicado; nao repita a recuperacao.')
    // Segredos permanecem somente na memoria do processo ate COMMIT confirmado.
    const temporaryPin = String(randomInt(10 ** (pinLength - 1), 10 ** pinLength))
    const activationCode = createOpaqueToken()
    const pinHash = await hashPin(temporaryPin, pepper)
    const codeHash = hashOpaqueToken(activationCode)
    const expiresAt = new Date(Date.now() + input.validHours * 60 * 60 * 1000)
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE alm_provisioner')
    await client.query({
      text: `SELECT alm.recuperar_primeiro_administrador($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      values: [input.usuarioId, input.matricula, pinHash, codeHash, 2,
        expiresAt, input.incident, input.operator, input.requestId],
    })
    commitAttempted = true
    await client.query('COMMIT')
    committed = true
    const state = await postcheck(client, input)
    if (!state.applied || !state.safe) {
      throw new Error('Postcheck falhou apos COMMIT. Pare e investigue pelo request_id; nao execute novamente.')
    }
    process.stdout.write(`${JSON.stringify({ usuarioId: input.usuarioId,
      matricula: input.matricula, requestId: input.requestId,
      temporaryPin, activationCode, expiresAt: expiresAt.toISOString(),
      postcheck: state }, null, 2)}\n`)
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    if (committed) throw new Error(`COMMIT efetuado; nao execute novamente. ${error.message}`)
    if (commitAttempted) throw new Error(`Resultado do COMMIT incerto; verifique o request_id e nao repita. ${error.message}`)
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Recuperacao interrompida: ${error.message}`)
    process.exitCode = 1
  })
}
