import { ROUTES } from '../../layout/navigation.js'
import { hasPermission } from './sessionState.js'

/**
 * Quais telas cada usuário vê, segundo as PERMISSÕES que o servidor entregou em
 * `GET /auth/me` (nunca pelo nome do perfil). Isto é a camada de apresentação:
 * o backend continua recusando (403) qualquer operação sem permissão, então
 * esconder/redirecionar aqui é conforto, não segurança.
 *
 * As permissões exigidas espelham os endpoints que alimentam cada tela
 * (backend/appPostgres.mjs): `chegadas.*`, `recebimentos.*`, `dashboard.read`.
 * Definições oficiais (Goran e Kobner): Visão geral = `dashboard.read`; Leitura
 * automática = `recebimentos.create` (prepara dados e encaminha para Novo recebimento);
 * `/visualizacao` = `recebimentos.read`. A futura leitura própria da Portaria usaria
 * `chegadas.create` e NÃO está implementada aqui.
 */
export const AUTH_ROUTES = Object.freeze({
  devices: '/dispositivos',
  activate: '/ativar-passkey',
})

export const PUBLIC_PATHS = Object.freeze([ROUTES.login, AUTH_ROUTES.activate])

function normalize(path) {
  const clean = String(path || '/').split('?')[0].split('#')[0]
  const trimmed = clean.length > 1 ? clean.replace(/\/+$/, '') : clean
  return trimmed || '/'
}

export function isPublicPath(path) {
  return PUBLIC_PATHS.includes(normalize(path))
}

/**
 * Permissão exigida para abrir `path`, ou `null` quando basta estar autenticado
 * (meus dispositivos, página não encontrada).
 */
export function requiredPermission(path) {
  const clean = normalize(path)
  if (clean === ROUTES.dashboard) return 'dashboard.read'
  if (clean === ROUTES.newReceipt) return 'recebimentos.create'
  if (clean === ROUTES.nfeReader) return 'recebimentos.create'
  if (clean === ROUTES.receipts || clean.startsWith(`${ROUTES.receipts}/`)) return 'recebimentos.read'
  if (clean === ROUTES.pending || clean === ROUTES.visualizacao) return 'recebimentos.read'
  if (clean === ROUTES.portariaRegistrar) return 'chegadas.create'
  if (clean === ROUTES.portaria || clean.startsWith(`${ROUTES.portaria}/`)) return 'chegadas.read'
  return null
}

/** Pode abrir `path`? Sem sessão só as rotas públicas; com sessão, conforme as permissões. */
export function canAccessPath(user, path) {
  if (isPublicPath(path)) return true
  if (!user) return false
  const permission = requiredPermission(path)
  return permission === null || hasPermission(user, permission)
}

/** Primeira tela que o usuário pode abrir, ou `null` se o servidor não liberou nenhuma. */
export function homePathFor(user) {
  for (const path of [ROUTES.dashboard, ROUTES.portaria, ROUTES.receipts]) {
    if (canAccessPath(user, path) && requiredPermission(path)) return path
  }
  return null
}
