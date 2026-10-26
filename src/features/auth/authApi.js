/**
 * Cliente HTTP da autenticação — fala SÓ com os endpoints reais do backend
 * PostgreSQL/WebAuthn (backend/POSTGRES_N2.md, backend/appPostgres.mjs):
 *
 *   POST   /auth/login-challenges                      {matricula,pin} → 201 {challengeId,options}
 *   POST   /auth/login-challenges/:id/complete         {response}      → 200 {authenticated:true}
 *   GET    /auth/me                                                    → 200 usuário | 401
 *   POST   /auth/logout                                                → 200 {authenticated:false}
 *   POST   /auth/authenticators/registration-challenges  {} | {matricula,pin,activationCode} → 201 {challengeId,options}
 *   POST   /auth/authenticators                        {challengeId,response[,activationCode]} → 201 {id,nome,criadoEm}
 *   POST   /auth/initial-pin                           {matricula,temporaryPin,newPin,activationCode} → 200 {pinChanged:true}  (PR #6)
 *   GET    /auth/authenticators                                        → 200 {data:[...]}
 *   DELETE /auth/authenticators/:id                    {reason}        → 200 {id,revogado,currentSessionRevoked}
 *
 * Regras de segurança:
 * - caminho SEMPRE relativo (`/api/v1`) e `credentials: 'include'`: a sessão é
 *   um cookie HttpOnly `__Host-` (host-only), então só vale na mesma origem;
 * - a identidade vem do cookie validado pelo servidor — nunca `X-User-Id`,
 *   nunca token em cabeçalho, nunca nada em localStorage/sessionStorage;
 * - matrícula/PIN/código de ativação vão SÓ no corpo da requisição (nunca na URL);
 * - a mensagem do servidor jamais é lida nem repassada: o erro leva apenas
 *   `status`, um `kind` fixo e um `code` de lista curta. Os textos da tela são nossos.
 */
export const AUTH_API_BASE = '/api/v1'

const DEFAULT_TIMEOUT_MS = 20_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KNOWN_CODE = /^[A-Z][A-Z0-9_]{2,40}$/

export class AuthApiError extends Error {
  /**
   * @param {{ status: number, kind: string, code?: string|null }} details
   */
  constructor({ status, kind, code = null }) {
    super(`Falha na autenticação (${kind}).`)
    this.name = 'AuthApiError'
    this.status = status
    this.kind = kind
    this.code = code
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const nonEmptyString = (value) => typeof value === 'string' && value.length > 0

/** Tipo estável de erro a partir do status HTTP e do código do contrato. */
function classify(status, code) {
  if (status === 401) {
    if (code === 'INVALID_CREDENTIALS') return 'invalid_credentials'
    if (code === 'AUTH_CHALLENGE_INVALID') return 'challenge_invalid'
    return 'unauthorized'
  }
  if (status === 403) {
    if (code === 'RECENT_MFA_REQUIRED') return 'recent_mfa_required'
    if (code === 'ORIGIN_NOT_ALLOWED') return 'origin_not_allowed'
    return 'forbidden'
  }
  if (status === 429) return 'rate_limited'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 400 || status === 413 || status === 422) return 'validation'
  if (status >= 500) return 'unavailable'
  return 'unexpected'
}

async function readJson(response) {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

/**
 * @param {{ fetchImpl?: typeof fetch, base?: string, timeoutMs?: number }} [options]
 */
export function createAuthApi({ fetchImpl, base = AUTH_API_BASE, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  async function request(path, { method = 'GET', body } = {}) {
    const doFetch = fetchImpl || globalThis.fetch?.bind(globalThis)
    if (!doFetch) throw new AuthApiError({ status: 0, kind: 'network' })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      const headers = { Accept: 'application/json' }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      // Rede fora, DNS, CORS, servidor desligado ou tempo esgotado: sem resposta do servidor.
      throw new AuthApiError({ status: 0, kind: 'network' })
    } finally {
      clearTimeout(timer)
    }

    const payload = await readJson(response)
    if (!response.ok) {
      const rawCode = isObject(payload) && isObject(payload.error) ? payload.error.code : null
      const code = typeof rawCode === 'string' && KNOWN_CODE.test(rawCode) ? rawCode : null
      throw new AuthApiError({ status: response.status, kind: classify(response.status, code), code })
    }
    return { status: response.status, payload }
  }

  const unexpected = (status = 200) => new AuthApiError({ status, kind: 'unexpected' })

  function challengeResult({ status, payload }) {
    const valid = isObject(payload) && UUID.test(payload.challengeId || '')
      && isObject(payload.options) && nonEmptyString(payload.options.challenge)
    if (!valid) throw unexpected(status)
    return { challengeId: payload.challengeId, options: payload.options }
  }

  return {
    /** 1º fator: matrícula + PIN. Só devolve o desafio WebAuthn; NÃO cria sessão. */
    async startLogin({ matricula, pin }) {
      return challengeResult(await request('/auth/login-challenges', { method: 'POST', body: { matricula, pin } }))
    },

    /** 2º fator: envia a resposta WebAuthn. O cookie de sessão só chega aqui (HttpOnly). */
    async completeLogin(challengeId, response) {
      if (!UUID.test(challengeId || '')) throw unexpected(0)
      const { status, payload } = await request(`/auth/login-challenges/${challengeId}/complete`, { method: 'POST', body: { response } })
      if (!isObject(payload) || payload.authenticated !== true) throw unexpected(status)
      return { authenticated: true }
    },

    /** Sessão atual validada pelo servidor (o chamador valida o formato do usuário). */
    async getSession() {
      const { payload } = await request('/auth/me')
      return payload
    },

    async logout() {
      const { status, payload } = await request('/auth/logout', { method: 'POST' })
      if (!isObject(payload) || payload.authenticated !== false) throw unexpected(status)
      return { authenticated: false }
    },

    /** Sem argumentos: sessão MFA recente. Com `{matricula,pin,activationCode}`: ativação autorizada. */
    async startRegistration(input) {
      return challengeResult(await request('/auth/authenticators/registration-challenges', { method: 'POST', body: input || {} }))
    },

    async finishRegistration({ challengeId, response, activationCode }) {
      const body = { challengeId, response }
      if (activationCode !== undefined) body.activationCode = activationCode
      const { status, payload } = await request('/auth/authenticators', { method: 'POST', body })
      if (!isObject(payload) || !UUID.test(payload.id || '')) throw unexpected(status)
      return { id: payload.id, nome: payload.nome ?? null, criadoEm: payload.criadoEm ?? null }
    },

    /**
     * Troca do PIN TEMPORÁRIO do primeiro acesso (PR #6 do backend). NÃO cria sessão
     * nem consome o código de ativação: o código só é gasto quando a passkey é
     * gravada. Toda recusa (PIN temporário errado/expirado, PIN já definitivo, código
     * inválido/expirado/usado, bloqueio) volta como o mesmo 401 INVALID_CREDENTIALS.
     */
    async changeInitialPin({ matricula, temporaryPin, newPin, activationCode }) {
      const { status, payload } = await request('/auth/initial-pin', {
        method: 'POST',
        body: { matricula, temporaryPin, newPin, activationCode },
      })
      if (!isObject(payload) || payload.pinChanged !== true) throw unexpected(status)
      return { pinChanged: true }
    },

    /** Só metadados dos dispositivos (o servidor não devolve a chave pública). */
    async listAuthenticators() {
      const { status, payload } = await request('/auth/authenticators')
      if (!isObject(payload) || !Array.isArray(payload.data)) throw unexpected(status)
      return payload.data.map((row) => ({
        id: row?.id,
        nome: row?.nome ?? null,
        metodoCadastro: row?.metodoCadastro ?? null,
        criadoEm: row?.criadoEm ?? null,
        ultimoUsoEm: row?.ultimoUsoEm ?? null,
        revogadoEm: row?.revogadoEm ?? null,
        backupEligible: Boolean(row?.backupEligible),
        backupState: Boolean(row?.backupState),
      }))
    },

    async revokeAuthenticator(id, reason) {
      if (!UUID.test(id || '')) throw unexpected(0)
      const { status, payload } = await request(`/auth/authenticators/${id}`, { method: 'DELETE', body: { reason } })
      if (!isObject(payload) || payload.revogado !== true) throw unexpected(status)
      return { id: payload.id, revogado: true, currentSessionRevoked: Boolean(payload.currentSessionRevoked) }
    },
  }
}

/** Instância padrão, sobre o `fetch` do navegador. */
export const authApi = createAuthApi()
