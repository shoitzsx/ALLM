import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { authApi } from './authApi.js'
import { createSessionManager } from './sessionManager.js'
import { SESSION_STATUS, createInitialSession, hasPermission } from './sessionState.js'

/**
 * Casca React sobre o gerenciador de sessão. A autenticação é do SERVIDOR: este
 * Provider só repete o que o `GET /auth/me` confirmou (cookie HttpOnly), sem
 * armazenamento do navegador e sem nenhuma exceção que conceda acesso quando o
 * backend falha — rede fora, 5xx ou corpo estranho resultam em "não autenticado".
 */
const SIGNED_OUT = Object.freeze({
  status: SESSION_STATUS.ANONYMOUS,
  user: null,
  reason: null,
  api: null,
  can: () => false,
  readSession: async () => null,
  retryCheck: async () => null,
  signOut: async () => ({ ok: false, kind: 'unexpected' }),
  expireSession: () => {},
})

const AuthContext = createContext(SIGNED_OUT)
// Instantâneo estável (o getServerSnapshot do React exige o mesmo objeto a cada chamada).
const INITIAL_SESSION = createInitialSession()

/** Sem Provider (testes, telas isoladas) o valor é "deslogado": nunca concede acesso. */
export function useAuth() {
  return useContext(AuthContext)
}

/**
 * @param {object} props
 * @param {object} [props.api]                cliente HTTP (padrão: authApi)
 * @param {(user: object|null) => void} [props.onUserChange]  recebe o usuário validado ANTES do app montar
 * @param {() => void} [props.onSignedOut]    limpeza local depois do logout
 */
export function AuthProvider({ api = authApi, onUserChange, onSignedOut, children }) {
  const callbacks = useRef({ onUserChange, onSignedOut })
  callbacks.current = { onUserChange, onSignedOut }

  const manager = useMemo(() => createSessionManager({
    api,
    onUserChange: (user) => callbacks.current.onUserChange?.(user),
    onSignedOut: () => callbacks.current.onSignedOut?.(),
  }), [api])

  const session = useSyncExternalStore(manager.subscribe, manager.getState, () => INITIAL_SESSION)

  // Ao abrir ou atualizar o app: quem é o usuário segundo o servidor?
  useEffect(() => {
    void manager.check()
  }, [manager])

  // Ao voltar para a aba, revalida (sessões acabam por ociosidade no servidor).
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void manager.revalidate()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [manager])

  const value = useMemo(() => ({
    status: session.status,
    user: session.user,
    reason: session.reason,
    api,
    can: (permission) => hasPermission(session.user, permission),
    readSession: manager.readSession,
    retryCheck: manager.check,
    signOut: manager.signOut,
    expireSession: manager.expire,
  }), [session, api, manager])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
