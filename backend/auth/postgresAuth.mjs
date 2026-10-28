import { randomBytes, randomUUID } from 'node:crypto'
import { hashPin, verifyPin } from './pin.mjs'
import {
  PRE_MFA_COOKIE_NAME, SESSION_COOKIE_NAME, clearOpaqueCookie,
  createOpaqueToken, decodeBase64Url, hashOpaqueToken, readCookie,
  serializeOpaqueCookie, serializeSessionCookie,
} from './webauthnSecurity.mjs'

const PARTIAL_SECONDS = 5 * 60
const SESSION_SECONDS = 8 * 60 * 60
const SESSION_IDLE_SECONDS = 15 * 60
const RECENT_MFA_SECONDS = 10 * 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MATRICULA = /^[0-9A-Z]{3,20}$/

const capabilityMap = Object.freeze({
  ADMINISTRADOR: ['catalogos.read', 'authenticators.manage', 'usuarios.read', 'chegadas.read', 'chegadas.create', 'recebimentos.read', 'recebimentos.create', 'recebimentos.update', 'anexos.read', 'anexos.write', 'dashboard.read'],
  ALMOXARIFADO: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'recebimentos.create', 'recebimentos.update', 'anexos.read', 'anexos.write', 'dashboard.read'],
  PORTARIA: ['catalogos.read', 'chegadas.read', 'chegadas.create'],
  SUPRIMENTOS: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'anexos.read', 'dashboard.read'],
  CONSULTA: ['catalogos.read', 'chegadas.read', 'recebimentos.read', 'anexos.read', 'dashboard.read'],
})

export function authFailure(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

function uniformFailure() {
  return authFailure(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas ou acesso indisponível.')
}

function challengeFailure() {
  return authFailure(401, 'AUTH_CHALLENGE_INVALID', 'Desafio expirado ou inválido. Inicie novamente.')
}

function ipOf(req) {
  return req.socket?.remoteAddress || null
}

function userAgentOf(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 500) || null
}

export function publicUser(row, roles = []) {
  const perfil = row.perfil
  return {
    id: row.id,
    matricula: row.matricula,
    nome: row.nome,
    perfil,
    papeis: [perfil, ...roles],
    permissoes: capabilityMap[perfil] || [],
  }
}

export function requireCapability(user, permission) {
  if (!user) throw authFailure(401, 'UNAUTHORIZED', 'Sessão ausente ou expirada.')
  if (!user.permissoes.includes(permission)) {
    throw authFailure(403, 'FORBIDDEN', 'Permissão insuficiente para esta operação.')
  }
}

export async function withApiTransaction(pool, actor, requestId, action) {
  const client = await pool.connect()
  let discard = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE alm_api')
    await client.query(`SELECT set_config('app.usuario_id',$1,true),
      set_config('app.ator_sistema',$2,true),set_config('app.request_id',$3,true)`,
    [actor || '', actor ? '' : 'auth:n2', requestId || randomUUID()])
    const value = await action(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { discard = true }
    throw error
  } finally {
    client.release(discard)
  }
}

async function logEvent(client, { type, userId = null, matricula = null, success, reason = null, req, requestId }) {
  await client.query(`INSERT INTO alm.eventos_autenticacao
    (tipo,usuario_id,matricula_informada,sucesso,motivo,ip,user_agent,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
  [type, userId, matricula, success, reason, ipOf(req), userAgentOf(req), requestId])
}

function normalizeMatricula(value) {
  if (typeof value !== 'string') return null
  const matricula = value.trim().toUpperCase()
  return MATRICULA.test(matricula) ? matricula : null
}

function consumeLimiter(limits, key) {
  const now = Date.now()
  const value = limits.get(key)
  if (!value || value.reset <= now) {
    limits.set(key, { count: 1, reset: now + 60_000 })
    return false
  }
  value.count += 1
  return value.count > 10
}

async function findRoles(client, userId) {
  const { rows } = await client.query(`SELECT up.papel_codigo FROM alm.usuario_papeis up
    JOIN alm.papeis p ON p.codigo=up.papel_codigo AND p.ativo=true
    WHERE up.usuario_id=$1 AND up.revogado_em IS NULL`, [userId])
  return rows.map((row) => row.papel_codigo)
}

export function createPostgresAuth({ pool, adapter, pepper, allowedOrigins, pinLength = 8 }) {
  if (!pool || !adapter || typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('PostgreSQL, WebAuthn e ALM_PIN_PEPPER_V1 são obrigatórios no modo PostgreSQL.')
  }
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || !Number.isInteger(pinLength)
    || pinLength < 6 || pinLength > 12) throw new Error('Origens e política de PIN inválidas.')
  const origins = new Set(allowedOrigins)
  const limits = new Map()
  const fakeHash = hashPin('00000000', pepper)

  function requireOrigin(req) {
    const origin = req.headers?.origin
    if (typeof origin !== 'string' || !origins.has(origin)) {
      throw authFailure(403, 'ORIGIN_NOT_ALLOWED', 'Origem não autorizada.')
    }
    return origin
  }

  async function loginChallenge(req, input, requestId = randomUUID()) {
    const origin = requireOrigin(req)
    const matricula = normalizeMatricula(input?.matricula)
    const pin = input?.pin
    if (consumeLimiter(limits, `${ipOf(req)}:${matricula || '?'}`)) {
      throw authFailure(429, 'TOO_MANY_ATTEMPTS', 'Tente novamente em instantes.')
    }
    if (!matricula || typeof pin !== 'string' || !new RegExp(`^\\d{${pinLength}}$`).test(pin)) {
      throw uniformFailure()
    }
    return withApiTransaction(pool, null, requestId, async (client) => {
      const { rows: [entry] } = await client.query(`SELECT u.id,u.matricula,u.ativo,
        p.pin_hash,p.algoritmo,p.pepper_versao,p.temporario,p.expira_em,
        p.falhas_consecutivas,p.bloqueado_ate,p.bloqueado_em
        FROM alm.usuarios u LEFT JOIN alm.credenciais_pin p ON p.usuario_id=u.id
        WHERE u.matricula=$1 FOR UPDATE OF u`, [matricula])
      const correct = await verifyPin(pin, entry?.pin_hash || await fakeHash, pepper)
      const now = Date.now()
      const permitted = Boolean(entry?.ativo && entry.algoritmo === 'scrypt'
        && entry.pepper_versao === 1 && !entry.temporario
        && (!entry.expira_em || new Date(entry.expira_em).getTime() > now)
        && !entry.bloqueado_em
        && (!entry.bloqueado_ate || new Date(entry.bloqueado_ate).getTime() <= now))
      if (!correct || !permitted) {
        if (entry?.pin_hash && !correct) {
          await client.query(`UPDATE alm.credenciais_pin SET falhas_consecutivas=LEAST(falhas_consecutivas+1,32767),
            ultima_falha_em=clock_timestamp(),
            bloqueado_ate=CASE WHEN falhas_consecutivas+1>=5 THEN clock_timestamp()+interval '15 minutes'
              ELSE bloqueado_ate END WHERE usuario_id=$1`, [entry.id])
        }
        await logEvent(client, { type: 'LOGIN_FALHA', userId: entry?.id, matricula, success: false,
          reason: 'INVALID_CREDENTIALS', req, requestId })
        return { denied: true }
      }
      const { rows: credentials } = await client.query(`SELECT id,credential_id,transports
        FROM alm.credenciais_webauthn WHERE usuario_id=$1 AND revogado_em IS NULL`, [entry.id])
      if (!credentials.length) {
        await logEvent(client, { type: 'LOGIN_FALHA', userId: entry.id, matricula, success: false,
          reason: 'NO_AUTHENTICATOR', req, requestId })
        return { denied: true }
      }
      const token = createOpaqueToken()
      const tokenHash = hashOpaqueToken(token)
      const challenge = randomBytes(32)
      const options = await adapter.generateAuthenticationOptions({ challenge,
        credentials: credentials.map((row) => ({ credentialId: row.credential_id, transports: row.transports })) })
      const { rows: [flow] } = await client.query(`INSERT INTO alm.fluxos_auth_parcial
        (usuario_id,token_hash,expira_em,request_id)
        VALUES($1,$2,clock_timestamp()+interval '5 minutes',$3) RETURNING id`,
      [entry.id, tokenHash, requestId])
      const { rows: [record] } = await client.query(`INSERT INTO alm.desafios_webauthn
        (usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,fluxo_parcial_id,
         rp_id,origem_esperada,expira_em,request_id)
        VALUES($1,'AUTENTICACAO',$2,$3,$4,$5,$6,clock_timestamp()+interval '5 minutes',$7)
        RETURNING id`, [entry.id, adapter.hashChallenge(challenge), tokenHash, flow.id,
        adapter.rpId, origin, requestId])
      await client.query(`UPDATE alm.credenciais_pin SET falhas_consecutivas=0,
        bloqueado_ate=NULL WHERE usuario_id=$1`, [entry.id])
      await logEvent(client, { type: 'PIN_ETAPA_VALIDADA', userId: entry.id, matricula,
        success: true, req, requestId })
      await logEvent(client, { type: 'MFA_DESAFIO_CRIADO', userId: entry.id, matricula,
        success: true, req, requestId })
      return { challengeId: record.id, options, token }
    }).then((result) => {
      if (result.denied) throw uniformFailure()
      return { challengeId: result.challengeId, options: result.options,
        setCookie: serializeOpaqueCookie(PRE_MFA_COOKIE_NAME, result.token, { maxAge: PARTIAL_SECONDS }) }
    })
  }

  async function completeLogin(req, challengeId, response, requestId = randomUUID()) {
    requireOrigin(req)
    if (!UUID.test(challengeId || '') || !response || typeof response.id !== 'string') throw challengeFailure()
    const token = readCookie(req.headers.cookie, PRE_MFA_COOKIE_NAME)
    if (!token) throw challengeFailure()
    const tokenHash = hashOpaqueToken(token)
    let credentialId
    try { credentialId = decodeBase64Url(response.id, { minBytes: 1, maxBytes: 1024 }) }
    catch { throw challengeFailure() }
    const challenge = await withApiTransaction(pool, null, requestId, async (client) => {
      const { rows: [row] } = await client.query(`SELECT d.id,d.usuario_id,d.challenge_hash,d.origem_esperada,
        d.fluxo_parcial_id,d.expira_em,d.consumido_em,f.expira_em AS fluxo_expira_em,
        f.consumido_em AS fluxo_consumido_em,f.cancelado_em
        FROM alm.desafios_webauthn d JOIN alm.fluxos_auth_parcial f ON f.id=d.fluxo_parcial_id
        WHERE d.id=$1 AND d.cerimonia='AUTENTICACAO' AND f.token_hash=$2
        FOR UPDATE OF d,f`, [challengeId, tokenHash])
      if (!row || row.consumido_em || row.fluxo_consumido_em || row.cancelado_em
        || new Date(row.expira_em) <= new Date() || new Date(row.fluxo_expira_em) <= new Date()) return null
      await client.query(`UPDATE alm.desafios_webauthn SET consumido_em=clock_timestamp()
        WHERE id=$1`, [challengeId])
      const { rows: [credential] } = await client.query(`SELECT id,usuario_id,credential_id,
        chave_publica_cose,sign_count,transports FROM alm.credenciais_webauthn
        WHERE usuario_id=$1 AND credential_id=$2 AND revogado_em IS NULL`, [row.usuario_id, credentialId])
      return { ...row, credential }
    })
    async function denyMfa() {
      if (challenge) {
        await withApiTransaction(pool, null, requestId, (client) => logEvent(client, {
          type: 'MFA_FALHA', userId: challenge.usuario_id,
          success: false, reason: 'INVALID_RESPONSE', req, requestId,
        }))
      }
      throw challengeFailure()
    }
    if (!challenge?.credential) await denyMfa()
    let verified
    try {
      verified = await adapter.verifyAuthentication({ response,
        expectedChallengeHash: challenge.challenge_hash,
        expectedOrigin: challenge.origem_esperada,
        credential: { credentialId: challenge.credential.credential_id,
          publicKeyCose: challenge.credential.chave_publica_cose,
          signCount: challenge.credential.sign_count,
          transports: challenge.credential.transports } })
    } catch { await denyMfa() }
    if (!verified?.verified || !verified.authenticationInfo?.userVerified) await denyMfa()
    const newCounter = verified.authenticationInfo.newCounter
    if (!Number.isSafeInteger(newCounter) || newCounter < Number(challenge.credential.sign_count)) await denyMfa()
    const sessionToken = createOpaqueToken()
    const sessionHash = hashOpaqueToken(sessionToken)
    const created = await withApiTransaction(pool, null, requestId, async (client) => {
      const { rows: [flow] } = await client.query(`SELECT f.id,f.expira_em,f.consumido_em,f.cancelado_em,
        u.ativo,c.revogado_em,c.sign_count
        FROM alm.fluxos_auth_parcial f
        JOIN alm.usuarios u ON u.id=f.usuario_id
        JOIN alm.credenciais_webauthn c ON c.id=$2 AND c.usuario_id=f.usuario_id
        WHERE f.id=$1 FOR UPDATE OF f,u,c`, [challenge.fluxo_parcial_id, challenge.credential.id])
      if (!flow || !flow.ativo || flow.revogado_em || flow.consumido_em || flow.cancelado_em
        || new Date(flow.expira_em) <= new Date() || newCounter < Number(flow.sign_count)) return false
      await client.query(`UPDATE alm.credenciais_webauthn SET sign_count=$2,
        ultimo_uso_em=clock_timestamp() WHERE id=$1`, [challenge.credential.id, newCounter])
      await client.query(`UPDATE alm.fluxos_auth_parcial SET consumido_em=clock_timestamp()
        WHERE id=$1`, [flow.id])
      await client.query(`INSERT INTO alm.sessoes
        (usuario_id,token_hash,ocioso_max_segundos,expira_em,mfa_metodo,mfa_verificado_em,
         credencial_webauthn_id,ip,user_agent)
        VALUES($1,$2,$3,clock_timestamp()+interval '8 hours','WEBAUTHN',clock_timestamp(),$4,$5,$6)`,
      [challenge.usuario_id, sessionHash, SESSION_IDLE_SECONDS, challenge.credential.id,
        ipOf(req), userAgentOf(req)])
      await logEvent(client, { type: 'MFA_SUCESSO', userId: challenge.usuario_id,
        success: true, req, requestId })
      await logEvent(client, { type: 'LOGIN_SUCESSO', userId: challenge.usuario_id,
        success: true, req, requestId })
      return true
    })
    if (!created) await denyMfa()
    return { setCookie: [clearOpaqueCookie(PRE_MFA_COOKIE_NAME),
      serializeSessionCookie(sessionToken, SESSION_SECONDS)] }
  }

  async function session(req, requestId = randomUUID()) {
    const token = readCookie(req.headers?.cookie, SESSION_COOKIE_NAME)
    if (!token) return null
    const tokenHash = hashOpaqueToken(token)
    return withApiTransaction(pool, null, requestId, async (client) => {
      const { rows: [row] } = await client.query(`SELECT s.id AS sessao_id,s.usuario_id,s.token_hash,
        s.expira_em,s.ultimo_uso_em,s.ocioso_max_segundos,s.revogada_em,
        s.mfa_metodo,s.mfa_verificado_em,s.credencial_webauthn_id,
        u.id,u.matricula,u.nome,u.perfil,u.ativo,c.revogado_em AS credencial_revogada_em
        FROM alm.sessoes s JOIN alm.usuarios u ON u.id=s.usuario_id
        LEFT JOIN alm.credenciais_webauthn c ON c.id=s.credencial_webauthn_id
        WHERE s.token_hash=$1 FOR UPDATE OF s`, [tokenHash])
      if (!row) return null
      const now = Date.now()
      const valid = row.ativo && !row.revogada_em && row.mfa_metodo === 'WEBAUTHN'
        && row.mfa_verificado_em && row.credencial_webauthn_id && !row.credencial_revogada_em
        && new Date(row.expira_em).getTime() > now
        && new Date(row.ultimo_uso_em).getTime() + row.ocioso_max_segundos * 1000 > now
      if (!valid) return null
      await client.query('UPDATE alm.sessoes SET ultimo_uso_em=clock_timestamp() WHERE id=$1', [row.sessao_id])
      const roles = await findRoles(client, row.usuario_id)
      return { ...publicUser(row, roles), sessaoId: row.sessao_id,
        tokenHash: row.token_hash, credencialId: row.credencial_webauthn_id,
        mfaVerificadoEm: row.mfa_verificado_em }
    })
  }

  async function logout(req, current, requestId = randomUUID()) {
    requireOrigin(req)
    if (!current) throw authFailure(401, 'UNAUTHORIZED', 'Sessão ausente ou expirada.')
    await withApiTransaction(pool, current.id, requestId, async (client) => {
      await client.query(`UPDATE alm.sessoes SET revogada_em=clock_timestamp(),
        motivo_revogacao='LOGOUT' WHERE id=$1 AND revogada_em IS NULL`, [current.sessaoId])
      await logEvent(client, { type: 'LOGOUT', userId: current.id, success: true, req, requestId })
    })
    return clearOpaqueCookie(SESSION_COOKIE_NAME)
  }

  function requireRecentSession(current) {
    if (!current) throw authFailure(401, 'UNAUTHORIZED', 'Sessão ausente ou expirada.')
    if (Date.now() - new Date(current.mfaVerificadoEm).getTime() > RECENT_MFA_SECONDS * 1000) {
      throw authFailure(403, 'RECENT_MFA_REQUIRED', 'Confirme novamente sua identidade.')
    }
  }

  async function activationContext(client, input) {
    const matricula = normalizeMatricula(input?.matricula)
    const pin = input?.pin
    const code = input?.activationCode
    let codeHash
    try { codeHash = hashOpaqueToken(code) } catch { throw uniformFailure() }
    if (!matricula || typeof pin !== 'string' || !new RegExp(`^\\d{${pinLength}}$`).test(pin)) {
      throw uniformFailure()
    }
    const { rows: [row] } = await client.query(`SELECT u.id,u.matricula,u.nome,u.ativo,
      p.pin_hash,p.algoritmo,p.pepper_versao,p.temporario,p.expira_em,
      p.bloqueado_em,p.bloqueado_ate,a.id AS authorization_id,a.finalidade
      FROM alm.usuarios u JOIN alm.credenciais_pin p ON p.usuario_id=u.id
      JOIN alm.autorizacoes_webauthn a ON a.usuario_id=u.id
      WHERE u.matricula=$1 AND a.codigo_hash=$2 AND a.consumido_em IS NULL
        AND a.revogado_em IS NULL AND a.expira_em>clock_timestamp()
      FOR UPDATE OF a`, [matricula, codeHash])
    const correct = await verifyPin(pin, row?.pin_hash || await fakeHash, pepper)
    if (!row?.ativo || !correct || row.algoritmo !== 'scrypt' || row.pepper_versao !== 1
      || row.temporario || row.bloqueado_em
      || (row.bloqueado_ate && new Date(row.bloqueado_ate) > new Date())
      || (row.expira_em && new Date(row.expira_em) <= new Date())) throw uniformFailure()
    return { userId: row.id, matricula: row.matricula, name: row.nome,
      authorizationId: row.authorization_id, method: row.finalidade, linkHash: codeHash }
  }

  async function changeInitialPin(req, input, requestId = randomUUID()) {
    requireOrigin(req)
    const matricula = normalizeMatricula(input?.matricula)
    const temporaryPin = input?.temporaryPin
    const newPin = input?.newPin
    if (consumeLimiter(limits, `initial-pin:${ipOf(req)}:${matricula || '?'}`)) {
      throw authFailure(429, 'TOO_MANY_ATTEMPTS', 'Tente novamente em instantes.')
    }
    const pinPattern = new RegExp(`^\\d{${pinLength}}$`)
    let codeHash
    try { codeHash = hashOpaqueToken(input?.activationCode) } catch { throw uniformFailure() }
    if (!matricula || typeof temporaryPin !== 'string' || !pinPattern.test(temporaryPin)
      || typeof newPin !== 'string' || !pinPattern.test(newPin) || newPin === temporaryPin) {
      throw uniformFailure()
    }
    const newHash = await hashPin(newPin, pepper)
    return withApiTransaction(pool, null, requestId, async (client) => {
      const { rows: [row] } = await client.query(`SELECT u.id,u.ativo,p.pin_hash,p.algoritmo,
        p.pepper_versao,p.temporario,p.expira_em,p.bloqueado_em,p.bloqueado_ate
        FROM alm.usuarios u JOIN alm.credenciais_pin p ON p.usuario_id=u.id
        JOIN alm.autorizacoes_webauthn a ON a.usuario_id=u.id
        WHERE u.matricula=$1 AND a.codigo_hash=$2 AND a.finalidade='ATIVACAO'
          AND a.consumido_em IS NULL AND a.revogado_em IS NULL
          AND a.expira_em>clock_timestamp()
        FOR UPDATE OF u,p,a`, [matricula, codeHash])
      const correct = await verifyPin(temporaryPin, row?.pin_hash || await fakeHash, pepper)
      const now = new Date()
      const permitted = Boolean(row?.ativo && correct && row.algoritmo === 'scrypt'
        && row.pepper_versao === 1 && row.temporario && !row.bloqueado_em
        && (!row.bloqueado_ate || new Date(row.bloqueado_ate) <= now)
        && row.expira_em && new Date(row.expira_em) > now)
      if (!permitted) {
        if (row?.pin_hash && !correct) {
          await client.query(`UPDATE alm.credenciais_pin
            SET falhas_consecutivas=LEAST(falhas_consecutivas+1,32767),ultima_falha_em=clock_timestamp()
            WHERE usuario_id=$1`, [row.id])
        }
        await logEvent(client, { type: 'LOGIN_FALHA', userId: row?.id, matricula,
          success: false, reason: 'INVALID_INITIAL_PIN', req, requestId })
        return false
      }
      await client.query(`UPDATE alm.credenciais_pin SET pin_hash=$2,algoritmo='scrypt',
        pepper_versao=1,temporario=false,expira_em=NULL,definido_em=clock_timestamp(),
        definido_por=NULL,falhas_consecutivas=0,ultima_falha_em=NULL,bloqueado_ate=NULL
        WHERE usuario_id=$1`, [row.id, newHash])
      await logEvent(client, { type: 'PIN_TROCADO', userId: row.id, matricula,
        success: true, req, requestId })
      return true
    }).then((changed) => {
      if (!changed) throw uniformFailure()
      return { pinChanged: true }
    })
  }

  async function registrationChallenge(req, input, current, requestId = randomUUID()) {
    const origin = requireOrigin(req)
    const activation = Boolean(input?.activationCode)
    if (activation && consumeLimiter(limits, `activation:${ipOf(req)}:${normalizeMatricula(input?.matricula) || '?'}`)) {
      throw authFailure(429, 'TOO_MANY_ATTEMPTS', 'Tente novamente em instantes.')
    }
    if (!activation) requireRecentSession(current)
    return withApiTransaction(pool, activation ? null : current.id, requestId, async (client) => {
      let context
      if (activation) context = await activationContext(client, input)
      else {
        const { rows: [row] } = await client.query(`SELECT id,matricula,nome FROM alm.usuarios
          WHERE id=$1 AND ativo=true`, [current.id])
        if (!row) throw authFailure(401, 'UNAUTHORIZED', 'Sessão ausente ou expirada.')
        context = { userId: row.id, matricula: row.matricula, name: row.nome,
          sessionId: current.sessaoId, method: 'AUTENTICADA', linkHash: current.tokenHash }
      }
      const { rows: credentials } = await client.query(`SELECT credential_id,transports
        FROM alm.credenciais_webauthn WHERE usuario_id=$1`, [context.userId])
      const challenge = randomBytes(32)
      const options = await adapter.generateRegistrationOptions({ challenge,
        userId: context.userId, userName: context.matricula, displayName: context.name,
        credentials: credentials.map((row) => ({ credentialId: row.credential_id, transports: row.transports })) })
      const { rows: [record] } = await client.query(`INSERT INTO alm.desafios_webauthn
        (usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,sessao_id,autorizacao_id,
         rp_id,origem_esperada,expira_em,request_id)
        VALUES($1,'REGISTRO',$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '5 minutes',$8)
        RETURNING id`, [context.userId, adapter.hashChallenge(challenge), context.linkHash,
        context.sessionId || null, context.authorizationId || null, adapter.rpId, origin, requestId])
      return { challengeId: record.id, options }
    })
  }

  async function completeRegistration(req, input, current, requestId = randomUUID()) {
    requireOrigin(req)
    const challengeId = input?.challengeId
    const response = input?.response
    if (!UUID.test(challengeId || '') || !response) throw challengeFailure()
    const activation = Boolean(input?.activationCode)
    if (!activation) requireRecentSession(current)
    let linkHash
    try { linkHash = activation ? hashOpaqueToken(input.activationCode) : current.tokenHash }
    catch { throw challengeFailure() }
    const challenge = await withApiTransaction(pool, activation ? null : current.id, requestId, async (client) => {
      const { rows: [row] } = await client.query(`SELECT d.id,d.usuario_id,d.challenge_hash,
        d.origem_esperada,d.sessao_id,d.autorizacao_id,d.expira_em,d.consumido_em
        FROM alm.desafios_webauthn d WHERE d.id=$1 AND d.cerimonia='REGISTRO'
          AND d.vinculo_fluxo_hash=$2 FOR UPDATE`, [challengeId, linkHash])
      if (!row || row.consumido_em || new Date(row.expira_em) <= new Date()
        || (activation && !row.autorizacao_id)
        || (!activation && row.sessao_id !== current.sessaoId)) return null
      await client.query(`UPDATE alm.desafios_webauthn SET consumido_em=clock_timestamp()
        WHERE id=$1`, [row.id])
      return row
    })
    if (!challenge) throw challengeFailure()
    let verified
    try { verified = await adapter.verifyRegistration({ response,
      expectedChallengeHash: challenge.challenge_hash, expectedOrigin: challenge.origem_esperada }) }
    catch { throw challengeFailure() }
    if (!verified?.verified || !verified.userVerified) throw challengeFailure()
    return withApiTransaction(pool, activation ? null : current.id, requestId, async (client) => {
      const { rows: [user] } = await client.query(`SELECT id,ativo FROM alm.usuarios
        WHERE id=$1 FOR UPDATE`, [challenge.usuario_id])
      if (!user?.ativo) throw challengeFailure()
      let method = 'AUTENTICADA'
      if (activation) {
        const { rows: [authorization] } = await client.query(`SELECT id,finalidade,expira_em,
          consumido_em,revogado_em FROM alm.autorizacoes_webauthn
          WHERE id=$1 AND usuario_id=$2 AND codigo_hash=$3 FOR UPDATE`,
        [challenge.autorizacao_id, user.id, linkHash])
        if (!authorization || authorization.consumido_em || authorization.revogado_em
          || new Date(authorization.expira_em) <= new Date()) throw challengeFailure()
        method = authorization.finalidade
      } else {
        const { rows: [live] } = await client.query(`SELECT id FROM alm.sessoes WHERE id=$1
          AND usuario_id=$2 AND token_hash=$3 AND revogada_em IS NULL
          AND expira_em>clock_timestamp() AND mfa_metodo='WEBAUTHN'
          AND mfa_verificado_em>clock_timestamp()-interval '10 minutes' FOR UPDATE`,
        [current.sessaoId, user.id, linkHash])
        if (!live) throw challengeFailure()
      }
      const credential = verified
      const { rows: [created] } = await client.query(`INSERT INTO alm.credenciais_webauthn
        (usuario_id,credential_id,chave_publica_cose,algoritmo_cose,sign_count,
         aaguid,transports,backup_eligible,backup_state,metodo_cadastro)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id,nome_exibicao,criado_em`, [user.id, credential.credentialId,
        credential.publicKeyCose, credential.algorithmCose, credential.signCount,
        credential.aaguid || null, credential.transports, credential.backupEligible,
        credential.backupState, method])
      if (activation) await client.query(`UPDATE alm.autorizacoes_webauthn
        SET consumido_em=clock_timestamp() WHERE id=$1`, [challenge.autorizacao_id])
      await logEvent(client, { type: method === 'RECUPERACAO' ? 'WEBAUTHN_RECUPERACAO' : 'WEBAUTHN_CADASTRO',
        userId: user.id, success: true, req, requestId })
      return { id: created.id, nome: created.nome_exibicao, criadoEm: created.criado_em }
    }).catch((error) => {
      if (error.code === '23505') throw authFailure(409, 'AUTHENTICATOR_EXISTS', 'Autenticador já cadastrado.')
      throw error
    })
  }

  async function listAuthenticators(current) {
    if (!current) throw authFailure(401, 'UNAUTHORIZED', 'Sessão ausente ou expirada.')
    return withApiTransaction(pool, current.id, randomUUID(), async (client) => {
      const { rows } = await client.query(`SELECT id,nome_exibicao,metodo_cadastro,
        criado_em,ultimo_uso_em,revogado_em,backup_eligible,backup_state
        FROM alm.credenciais_webauthn WHERE usuario_id=$1 ORDER BY criado_em DESC`, [current.id])
      return rows.map((row) => ({ id: row.id, nome: row.nome_exibicao,
        metodoCadastro: row.metodo_cadastro, criadoEm: row.criado_em,
        ultimoUsoEm: row.ultimo_uso_em, revogadoEm: row.revogado_em,
        backupEligible: row.backup_eligible, backupState: row.backup_state }))
    })
  }

  async function revokeAuthenticator(req, current, id, reason, requestId = randomUUID()) {
    requireOrigin(req)
    requireRecentSession(current)
    if (!UUID.test(id || '') || typeof reason !== 'string' || !reason.trim()) {
      throw authFailure(422, 'VALIDATION_ERROR', 'Informe o autenticador e o motivo da revogação.')
    }
    return withApiTransaction(pool, current.id, requestId, async (client) => {
      const { rows } = await client.query(`SELECT id,revogado_em FROM alm.credenciais_webauthn
        WHERE usuario_id=$1 ORDER BY id FOR UPDATE`, [current.id])
      const target = rows.find((row) => row.id === id)
      if (!target || target.revogado_em) throw authFailure(404, 'AUTHENTICATOR_NOT_FOUND', 'Autenticador não encontrado.')
      if (rows.filter((row) => !row.revogado_em).length <= 1) {
        throw authFailure(409, 'LAST_AUTHENTICATOR', 'Cadastre outro autenticador antes de revogar este.')
      }
      await client.query(`UPDATE alm.credenciais_webauthn SET revogado_em=clock_timestamp(),
        revogado_por=$2,motivo_revogacao=$3 WHERE id=$1`, [id, current.id, reason.trim()])
      await logEvent(client, { type: 'WEBAUTHN_REVOGACAO', userId: current.id,
        success: true, req, requestId })
      return { id, revogado: true, currentSessionRevoked: current.credencialId === id }
    })
  }

  return { requireOrigin, loginChallenge, completeLogin, session, logout, changeInitialPin,
    registrationChallenge, completeRegistration, listAuthenticators, revokeAuthenticator }
}
