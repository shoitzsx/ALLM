import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import http from 'node:http'
import { test } from 'node:test'
import pg from 'pg'
import { encodeCBOR } from '@levischuck/tiny-cbor'
import { createPostgresApp } from '../appPostgres.mjs'
import { hashPin } from '../auth/pin.mjs'
import { hashOpaqueToken, createOpaqueToken } from '../auth/webauthnSecurity.mjs'
import { withApiTransaction } from '../auth/postgresAuth.mjs'

const disposable = process.env.ALM_DB_TEST_DISPOSABLE === 'YES'
  && process.env.ALM_DB_HOST === '127.0.0.1'
  && process.env.ALM_DB_NAME === 'alm_ci_clean'
  && process.env.ALM_DB_API_USER === 'alm_runtime_api'

function signedAuthentication({ challenge, credentialId, privateKey, counter = 1 }) {
  const origin = 'http://localhost:5173'
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }))
  const rpHash = createHash('sha256').update('localhost').digest()
  const flags = Buffer.from([0x05]) // User present and verified.
  const count = Buffer.alloc(4)
  count.writeUInt32BE(counter)
  const authenticatorData = Buffer.concat([rpHash, flags, count])
  const signature = sign('sha256', Buffer.concat([
    authenticatorData, createHash('sha256').update(clientData).digest(),
  ]), privateKey)
  return { id: credentialId.toString('base64url'), rawId: credentialId.toString('base64url'),
    type: 'public-key', response: {
      authenticatorData: authenticatorData.toString('base64url'),
      clientDataJSON: clientData.toString('base64url'),
      signature: signature.toString('base64url'), userHandle: null,
    }, clientExtensionResults: {} }
}

function registrationResponse({ challenge, credentialId, cose }) {
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge,
    origin: 'http://localhost:5173' }))
  const count = Buffer.alloc(4)
  const idLength = Buffer.alloc(2)
  idLength.writeUInt16BE(credentialId.length)
  const authenticatorData = Buffer.concat([
    createHash('sha256').update('localhost').digest(), Buffer.from([0x45]), count,
    Buffer.alloc(16), idLength, credentialId, cose,
  ])
  const attestation = Buffer.from(encodeCBOR(new Map([
    ['fmt', 'none'], ['authData', authenticatorData], ['attStmt', new Map()],
  ])))
  const id = credentialId.toString('base64url')
  return { id, rawId: id, type: 'public-key', response: {
    clientDataJSON: clientData.toString('base64url'),
    attestationObject: attestation.toString('base64url'), transports: ['internal'],
  }, clientExtensionResults: {} }
}

function cookieFrom(headers, name) {
  return headers.getSetCookie().map((entry) => entry.split(';')[0])
    .find((entry) => entry.startsWith(`${name}=`))
}

test('PostgreSQL N-2 HTTP flow signs WebAuthn, protects routes and rejects legacy sessions',
  { skip: !disposable }, async () => {
    const pepper = 'local-integration-pepper-with-at-least-32-characters'
    const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.ALM_DB_PORT),
      database: 'alm_ci_clean', user: 'alm_runtime_api',
      password: process.env.ALM_DB_API_PASSWORD, ssl: false, max: 3 })
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = publicKey.export({ format: 'jwk' })
    const cose = Buffer.from(encodeCBOR(new Map([
      [1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
    ])))
    const credentialId = randomBytes(32)
    const matricula = `T${Date.now().toString().slice(-10)}`
    const pin = '12345678'
    const pinHash = await hashPin(pin, pepper)
    let userId
    await withApiTransaction(pool, null, randomUUID(), async (client) => {
      const { rows: [user] } = await client.query(`INSERT INTO alm.usuarios
        (matricula,nome,perfil) VALUES($1,'Teste Auth E2E','ALMOXARIFADO') RETURNING id`, [matricula])
      userId = user.id
      await client.query(`INSERT INTO alm.credenciais_pin
        (usuario_id,pin_hash,algoritmo,pepper_versao,temporario)
        VALUES($1,$2,'scrypt',1,false)`, [userId, pinHash])
      await client.query(`INSERT INTO alm.credenciais_webauthn
        (usuario_id,credential_id,chave_publica_cose,algoritmo_cose,sign_count,
         backup_eligible,backup_state,metodo_cadastro)
        VALUES($1,$2,$3,-7,0,false,false,'ATIVACAO')`, [userId, credentialId, cose])
    })
    const app = await createPostgresApp({ pool,
      environment: { host: '127.0.0.1', port: 0, rpName: 'ALM', rpId: 'localhost',
        origins: ['http://localhost:5173'], pepper, pinLength: 8 } })
    const server = http.createServer(app.handle)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/v1`
    const request = (path, options = {}) => fetch(`${base}${path}`, {
      ...options,
      headers: { Origin: 'http://localhost:5173',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers },
    })
    try {
      const spoofed = await request('/recebimentos', { headers: { 'X-User-Id': userId } })
      assert.equal(spoofed.status, 401)

      const badPin = await request('/auth/login-challenges', { method: 'POST',
        body: JSON.stringify({ matricula, pin: '00000000' }) })
      assert.equal(badPin.status, 401)
      assert.equal(cookieFrom(badPin.headers, '__Host-alm_session'), undefined)

      const first = await request('/auth/login-challenges', { method: 'POST',
        body: JSON.stringify({ matricula, pin }) })
      const challenge = await first.json()
      assert.equal(first.status, 201, JSON.stringify(challenge))
      const preMfa = cookieFrom(first.headers, '__Host-alm_pre_mfa')
      assert.ok(preMfa)
      assert.equal((await request('/auth/me', { headers: { Cookie: preMfa } })).status, 401)

      const response = signedAuthentication({ challenge: challenge.options.challenge,
        credentialId, privateKey })
      const finish = await request(`/auth/login-challenges/${challenge.challengeId}/complete`, {
        method: 'POST', headers: { Cookie: preMfa }, body: JSON.stringify({ response }),
      })
      assert.equal(finish.status, 200, await finish.text())
      const sessionCookie = cookieFrom(finish.headers, '__Host-alm_session')
      assert.ok(sessionCookie)
      assert.equal((await request('/auth/me', { headers: { Cookie: sessionCookie } })).status, 200)
      assert.equal((await request('/recebimentos', { headers: { Cookie: sessionCookie } })).status, 200)
      const createdResponse = await request('/recebimentos', { method: 'POST',
        headers: { Cookie: sessionCookie }, body: JSON.stringify({ pedido: 'E2E-PG-001' }) })
      const created = await createdResponse.json()
      assert.equal(createdResponse.status, 201, JSON.stringify(created))
      assert.match(created.codigo, /^REC-\d{4}-\d{6}$/)
      assert.equal((await request(`/recebimentos/${created.id}`, {
        headers: { Cookie: sessionCookie },
      })).status, 200)
      const updatedResponse = await request(`/recebimentos/${created.id}`, { method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: JSON.stringify({ fornecedor: 'Fornecedor E2E', numeroNf: '123' }) })
      assert.equal(updatedResponse.status, 200, await updatedResponse.text())
      const itemResponse = await request(`/recebimentos/${created.id}/itens`, { method: 'POST',
        headers: { Cookie: sessionCookie },
        body: JSON.stringify({ numero: 10, descricao: 'Item E2E', quantidadeRecebida: 2,
          quantidadeSolicitada: 2, unidade: 'UN' }) })
      const item = await itemResponse.json()
      assert.equal(itemResponse.status, 201, JSON.stringify(item))
      const divergenceResponse = await request(`/recebimentos/${created.id}/divergencias`, {
        method: 'POST', headers: { Cookie: sessionCookie },
        body: JSON.stringify({ tipo: 'Material avariado', descricao: 'Embalagem danificada', itemId: item.id }),
      })
      const divergence = await divergenceResponse.json()
      assert.equal(divergenceResponse.status, 201, JSON.stringify(divergence))
      const resolvedResponse = await request(`/recebimentos/${created.id}/divergencias/${divergence.id}/resolver`, {
        method: 'POST', headers: { Cookie: sessionCookie },
        body: JSON.stringify({ resolucao: 'Material inspecionado' }),
      })
      assert.equal(resolvedResponse.status, 200, await resolvedResponse.text())
      const detailResponse = await request(`/recebimentos/${created.id}`, { headers: { Cookie: sessionCookie } })
      const detail = await detailResponse.json()
      assert.equal(detail.itens.length, 1)
      assert.equal(detail.divergencias[0].resolvida, true)
      assert.equal((await request('/visualizacao/recebimentos', {
        headers: { Cookie: sessionCookie },
      })).status, 200)
      assert.equal((await request('/visualizacao/usuarios', {
        headers: { Cookie: sessionCookie },
      })).status, 403)
      assert.equal((await request('/visualizacao/recebimentos/exportar.csv', {
        headers: { Cookie: sessionCookie },
      })).status, 200)
      const uploadUnavailable = await request(`/recebimentos/${created.id}/anexos/upload-sessions`, {
        method: 'POST', headers: { Cookie: sessionCookie },
        body: JSON.stringify({ name: 'nota.png', mimeType: 'image/png', size: 24, categoria: 'Nota Fiscal' }),
      })
      assert.equal(uploadUnavailable.status, 503)
      assert.equal((await uploadUnavailable.json()).error.code, 'DRIVE_NOT_CONFIGURED')
      assert.equal((await request('/chegadas', { method: 'POST',
        headers: { Cookie: sessionCookie }, body: JSON.stringify({}),
      })).status, 403)
      assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST',
        headers: { Cookie: sessionCookie },
      })).status, 403)

      const nextKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const nextJwk = nextKey.publicKey.export({ format: 'jwk' })
      const nextCose = Buffer.from(encodeCBOR(new Map([
        [1, 2], [3, -7], [-1, 1],
        [-2, Buffer.from(nextJwk.x, 'base64url')],
        [-3, Buffer.from(nextJwk.y, 'base64url')],
      ])))
      const nextCredentialId = randomBytes(32)
      const registrationStart = await request('/auth/authenticators/registration-challenges', {
        method: 'POST', headers: { Cookie: sessionCookie }, body: '{}',
      })
      const registrationChallenge = await registrationStart.json()
      assert.equal(registrationStart.status, 201, JSON.stringify(registrationChallenge))
      const registrationFinish = await request('/auth/authenticators', {
        method: 'POST', headers: { Cookie: sessionCookie },
        body: JSON.stringify({ challengeId: registrationChallenge.challengeId,
          response: registrationResponse({ challenge: registrationChallenge.options.challenge,
            credentialId: nextCredentialId, cose: nextCose }) }),
      })
      const nextCredential = await registrationFinish.json()
      assert.equal(registrationFinish.status, 201, JSON.stringify(nextCredential))
      const listResponse = await request('/auth/authenticators', {
        headers: { Cookie: sessionCookie },
      })
      const list = await listResponse.json()
      assert.equal(listResponse.status, 200)
      assert.equal(list.data.length, 2)
      assert.equal(JSON.stringify(list).includes('chave_publica_cose'), false)
      const revoked = await request(`/auth/authenticators/${nextCredential.id}`, {
        method: 'DELETE', headers: { Cookie: sessionCookie },
        body: JSON.stringify({ reason: 'Teste de revogação' }),
      })
      assert.equal(revoked.status, 200, await revoked.text())
      assert.equal((await request('/auth/me', { headers: { Cookie: sessionCookie } })).status, 200)

      const replay = await request(`/auth/login-challenges/${challenge.challengeId}/complete`, {
        method: 'POST', headers: { Cookie: preMfa }, body: JSON.stringify({ response }),
      })
      assert.equal(replay.status, 401)

      const invalidStart = await request('/auth/login-challenges', { method: 'POST',
        body: JSON.stringify({ matricula, pin }) })
      const invalidChallenge = await invalidStart.json()
      assert.equal(invalidStart.status, 201, JSON.stringify(invalidChallenge))
      const invalidResponse = signedAuthentication({ challenge: invalidChallenge.options.challenge,
        credentialId, privateKey, counter: 2 })
      invalidResponse.response.signature = randomBytes(70).toString('base64url')
      const invalidFinish = await request(`/auth/login-challenges/${invalidChallenge.challengeId}/complete`, {
        method: 'POST', headers: { Cookie: cookieFrom(invalidStart.headers, '__Host-alm_pre_mfa') },
        body: JSON.stringify({ response: invalidResponse }),
      })
      assert.equal(invalidFinish.status, 401)
      const failureAudit = await withApiTransaction(pool, null, randomUUID(), async (client) => {
        const { rows: [row] } = await client.query(`SELECT count(*)::int AS total
          FROM alm.eventos_autenticacao WHERE usuario_id=$1 AND tipo='MFA_FALHA'`, [userId])
        return row.total
      })
      assert.equal(failureAudit, 1)

      const oldToken = createOpaqueToken()
      await withApiTransaction(pool, null, randomUUID(), async (client) => {
        await client.query(`INSERT INTO alm.sessoes
          (usuario_id,token_hash,ocioso_max_segundos,expira_em)
          VALUES($1,$2,900,clock_timestamp()+interval '1 hour')`,
        [userId, hashOpaqueToken(oldToken)])
      })
      const legacy = await request('/auth/me', { headers: {
        Cookie: `__Host-alm_session=${oldToken}`,
      } })
      assert.equal(legacy.status, 401)

      const logout = await request('/auth/logout', { method: 'POST',
        headers: { Cookie: sessionCookie } })
      assert.equal(logout.status, 200)
      assert.equal((await request('/auth/me', { headers: { Cookie: sessionCookie } })).status, 401)
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await pool.end()
    }
  })

test('approved activation registers a passkey with real attestation and consumes authorization',
  { skip: !disposable }, async () => {
    const pepper = 'local-integration-pepper-with-at-least-32-characters'
    const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.ALM_DB_PORT),
      database: 'alm_ci_clean', user: 'alm_runtime_api',
      password: process.env.ALM_DB_API_PASSWORD, ssl: false, max: 3 })
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = publicKey.export({ format: 'jwk' })
    const cose = Buffer.from(encodeCBOR(new Map([
      [1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
    ])))
    const credentialId = randomBytes(32)
    const matricula = `A${Date.now().toString().slice(-10)}`
    const temporaryPin = '87654321'
    const pin = '12348765'
    const activationCode = createOpaqueToken()
    const pinHash = await hashPin(temporaryPin, pepper)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    let userId
    await withApiTransaction(pool, null, randomUUID(), async (client) => {
      const { rows: [user] } = await client.query(`INSERT INTO alm.usuarios
        (matricula,nome,perfil) VALUES($1,'Teste Ativacao','PORTARIA') RETURNING id`, [matricula])
      userId = user.id
      await client.query(`INSERT INTO alm.credenciais_pin
        (usuario_id,pin_hash,algoritmo,pepper_versao,temporario,expira_em)
         VALUES($1,$2,'scrypt',1,true,$3)`, [userId, pinHash, expiresAt])
      await client.query(`INSERT INTO alm.autorizacoes_webauthn
        (usuario_id,finalidade,codigo_hash,autorizacao_externa,expira_em)
         VALUES($1,'ATIVACAO',$2,'local-approved-test',$3)`,
      [userId, hashOpaqueToken(activationCode), expiresAt])
    })
    const app = await createPostgresApp({ pool,
      environment: { host: '127.0.0.1', port: 0, rpName: 'ALM', rpId: 'localhost',
        origins: ['http://localhost:5173'], pepper, pinLength: 8 } })
    const server = http.createServer(app.handle)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/v1`
    const post = (path, data) => fetch(`${base}${path}`, { method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify(data) })
    try {
      const beforeChange = await post('/auth/authenticators/registration-challenges',
        { matricula, pin: temporaryPin, activationCode })
      assert.equal(beforeChange.status, 401)

      const changed = await post('/auth/initial-pin', {
        matricula, temporaryPin, newPin: pin, activationCode,
      })
      assert.equal(changed.status, 200, await changed.text())
      const afterPin = await withApiTransaction(pool, null, randomUUID(), async (client) => {
        const { rows: [row] } = await client.query(`SELECT p.temporario,a.consumido_em
          FROM alm.credenciais_pin p JOIN alm.autorizacoes_webauthn a ON a.usuario_id=p.usuario_id
          WHERE p.usuario_id=$1`, [userId])
        return row
      })
      assert.equal(afterPin.temporario, false)
      assert.equal(afterPin.consumido_em, null)

      const begin = await post('/auth/authenticators/registration-challenges',
        { matricula, pin, activationCode })
      const challenge = await begin.json()
      assert.equal(begin.status, 201, JSON.stringify(challenge))
      const pending = await withApiTransaction(pool, null, randomUUID(), async (client) => {
        const { rows: [row] } = await client.query(`SELECT consumido_em
          FROM alm.autorizacoes_webauthn WHERE usuario_id=$1`, [userId])
        return row.consumido_em
      })
      assert.equal(pending, null)
      assert.equal((await fetch(`${base}/auth/me`)).status, 401)

      const registered = await post('/auth/authenticators', {
        challengeId: challenge.challengeId, activationCode,
        response: registrationResponse({ challenge: challenge.options.challenge,
          credentialId, cose }),
      })
      const result = await registered.json()
      assert.equal(registered.status, 201, JSON.stringify(result))
      assert.ok(result.id)

      const replay = await post('/auth/authenticators', {
        challengeId: challenge.challengeId, activationCode,
        response: registrationResponse({ challenge: challenge.options.challenge,
          credentialId, cose }),
      })
      assert.equal(replay.status, 401)
      const state = await withApiTransaction(pool, null, randomUUID(), async (client) => {
        const { rows: [authorization] } = await client.query(`SELECT consumido_em
          FROM alm.autorizacoes_webauthn WHERE usuario_id=$1`, [userId])
        const { rows: credentials } = await client.query(`SELECT id FROM alm.credenciais_webauthn
          WHERE usuario_id=$1`, [userId])
        return { authorization, credentials }
      })
      assert.ok(state.authorization.consumido_em)
      assert.equal(state.credentials.length, 1)

      const login = await post('/auth/login-challenges', { matricula, pin })
      const loginChallenge = await login.json()
      assert.equal(login.status, 201, JSON.stringify(loginChallenge))
      const preMfa = cookieFrom(login.headers, '__Host-alm_pre_mfa')
      const complete = await fetch(`${base}/auth/login-challenges/${loginChallenge.challengeId}/complete`, {
        method: 'POST', headers: { Origin: 'http://localhost:5173',
          'Content-Type': 'application/json', Cookie: preMfa },
        body: JSON.stringify({ response: signedAuthentication({
          challenge: loginChallenge.options.challenge, credentialId, privateKey,
        }) }),
      })
      assert.equal(complete.status, 200, await complete.text())
      const sessionCookie = cookieFrom(complete.headers, '__Host-alm_session')
      const arrivalResponse = await fetch(`${base}/chegadas`, { method: 'POST',
        headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json',
          Cookie: sessionCookie },
        body: JSON.stringify({ numeroNf: String(Date.now()), cnpjEmitente: '04994734000518',
          fornecedor: 'Empresa ABC', metodoLeitura: 'MANUAL' }),
      })
      const arrival = await arrivalResponse.json()
      assert.equal(arrivalResponse.status, 201, JSON.stringify(arrival))
      assert.match(arrival.codigo, /^CHG-\d{8}$/)
      assert.equal((await fetch(`${base}/recebimentos`, { headers: {
        Origin: 'http://localhost:5173', Cookie: sessionCookie,
      } })).status, 403)
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await pool.end()
    }
  })
