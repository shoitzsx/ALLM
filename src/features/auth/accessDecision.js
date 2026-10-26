import { SESSION_STATUS, parseSessionUser } from './sessionState.js'
import { AUTH_ROUTES, canAccessPath, homePathFor, isPublicPath } from './routeAccess.js'
import { buildLoginRoute, readReturnTo } from './returnTo.js'

/**
 * Decisão do porteiro das rotas (AccessGate), pura e testável: dado o estado
 * da sessão CONFIRMADO PELO SERVIDOR e a rota pedida, diz o que mostrar.
 * Sem sessão confirmada só existem o login e a ativação de passkey; "autenticado"
 * exige usuário válido (estado incoerente cai no login).
 */
export const ACCESS = Object.freeze({
  LOADING: 'loading',
  UNAVAILABLE: 'unavailable',
  LOGIN: 'login',
  ACTIVATE: 'activate',
  APP: 'app',
  REDIRECT: 'redirect',
  DENIED: 'denied',
})

function withQuery(path, query) {
  const text = query?.toString?.() || ''
  return text ? `${path}?${text}` : path
}

export function decideAccess({ status, user, route, reason = null }) {
  const path = route.path

  if (path === AUTH_ROUTES.activate) return { action: ACCESS.ACTIVATE }
  if (status === SESSION_STATUS.CHECKING) return { action: ACCESS.LOADING }
  if (status === SESSION_STATUS.UNAVAILABLE) return { action: ACCESS.UNAVAILABLE }

  // Usuário incompleto ou fora do contrato não vale como sessão (revalida o formato).
  const authenticated = status === SESSION_STATUS.AUTHENTICATED && parseSessionUser(user) !== null
  if (!authenticated) {
    if (isPublicPath(path)) return { action: ACCESS.LOGIN }
    // Saída pedida pelo usuário: o login abre limpo, sem guardar a página que ele acabou de deixar.
    if (reason === 'signed_out') return { action: ACCESS.REDIRECT, to: buildLoginRoute(null) }
    return { action: ACCESS.REDIRECT, to: buildLoginRoute(withQuery(path, route.query)) }
  }

  const home = homePathFor(user)
  if (isPublicPath(path)) {
    const target = readReturnTo(route.query, { fallback: home || AUTH_ROUTES.devices })
    const [targetPath] = target.split('?')
    return { action: ACCESS.REDIRECT, to: canAccessPath(user, targetPath) ? target : (home || AUTH_ROUTES.devices) }
  }

  if (!canAccessPath(user, path)) {
    return home ? { action: ACCESS.REDIRECT, to: home } : { action: ACCESS.DENIED }
  }
  return { action: ACCESS.APP }
}
