import { SESSION_EVENT, SESSION_STATUS, createInitialSession, parseSessionUser, sessionReducer } from './sessionState.js'

/**
 * Gerenciador da sessão no navegador, sem React (o `AuthProvider` é só uma
 * casca sobre isto). Faz a ponte entre o servidor e o estado da tela:
 *
 * - `check()`      GET /auth/me ao abrir/atualizar o app (cookie HttpOnly do servidor);
 * - `readSession`  o mesmo GET, usado pelo login depois do segundo fator;
 * - `revalidate()` revalida ao voltar para a aba (NÃO é polling: cada leitura
 *                  renova o "ocioso" da sessão no servidor);
 * - `expire()`     qualquer chamada autenticada que recebeu 401;
 * - `signOut()`    POST /auth/logout.
 *
 * Nada é guardado em localStorage/sessionStorage/cookie legível: o estado
 * vive em memória e a sessão de verdade é o cookie `__Host-` do servidor.
 *
 * `onUserChange(user|null)` roda ANTES do estado mudar, para o store local
 * ter o usuário certo quando o app autenticado montar; `onSignedOut` é o gancho
 * para limpar dados em memória do usuário que saiu.
 */
export function createSessionManager({
  api,
  onUserChange,
  onSignedOut,
  now = () => Date.now(),
  minRevalidateMs = 30_000,
} = {}) {
  let state = createInitialSession()
  let lastCheckedAt = 0
  const listeners = new Set()

  function dispatch(event) {
    const next = sessionReducer(state, event)
    if (next === state) return
    state = next
    listeners.forEach((listener) => listener())
  }

  function applyUser(user) {
    try { onUserChange?.(user) } catch { /* o gancho do store nunca pode impedir o encerramento */ }
  }

  function endSession(eventType) {
    applyUser(null)
    dispatch({ type: eventType })
  }

  /** Lê a sessão no servidor. 401 → `null`; rede/5xx → lança `AuthApiError`. */
  async function readSession() {
    let payload
    try {
      payload = await api.getSession()
    } catch (error) {
      if (error?.kind === 'unauthorized') {
        endSession(SESSION_EVENT.NONE)
        return null
      }
      throw error
    }
    lastCheckedAt = now()
    const user = parseSessionUser(payload)
    if (!user) {
      // Corpo fora do contrato (inclui o backend legado): sem usuário válido não há sessão.
      endSession(SESSION_EVENT.NONE)
      return null
    }
    applyUser(user)
    dispatch({ type: SESSION_EVENT.RESOLVED, user })
    return state.user
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    readSession,

    /** Verificação inicial (ou "tentar de novo"): falha de rede/servidor → `UNAVAILABLE`. */
    async check() {
      dispatch({ type: SESSION_EVENT.CHECKING })
      try {
        return await readSession()
      } catch {
        dispatch({ type: SESSION_EVENT.UNAVAILABLE })
        return null
      }
    },

    /** Segundo plano: 401 expira; falha de rede mantém a sessão como está. */
    async revalidate() {
      if (state.status !== SESSION_STATUS.AUTHENTICATED) return state.user
      if (now() - lastCheckedAt < minRevalidateMs) return state.user
      try {
        return await readSession()
      } catch {
        return state.user
      }
    },

    /** Uma chamada autenticada recebeu 401: a sessão acabou. */
    expire() {
      if (state.status !== SESSION_STATUS.AUTHENTICATED) return
      applyUser(null)
      dispatch({ type: SESSION_EVENT.EXPIRED })
    },

    /** Encerra no servidor. Só sai de verdade se o servidor confirmou (ou já não havia sessão). */
    async signOut() {
      try {
        await api.logout()
      } catch (error) {
        if (error?.kind !== 'unauthorized') return { ok: false, kind: error?.kind || 'unexpected' }
      }
      endSession(SESSION_EVENT.SIGNED_OUT)
      try { onSignedOut?.() } catch { /* limpeza local não pode falhar o logout */ }
      return { ok: true }
    },
  }
}
