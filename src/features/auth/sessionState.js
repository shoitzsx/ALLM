/**
 * Estado da SESSÃO do frontend. A única fonte de verdade é o servidor:
 * `AUTHENTICATED` só existe depois de um `GET /auth/me` cujo corpo passa por
 * `parseSessionUser`. Corpo inválido, 401, rede fora, servidor indisponível ou
 * qualquer evento desconhecido NUNCA resultam em usuário autenticado.
 *
 * As permissões vêm do servidor (`permissoes`). O nome do perfil só é exibido
 * — não é lido para decidir acesso.
 *
 * Função pura, sem relógio, sem rede, sem armazenamento.
 */
export const SESSION_STATUS = Object.freeze({
  CHECKING: 'checking',
  ANONYMOUS: 'anonymous',
  AUTHENTICATED: 'authenticated',
  UNAVAILABLE: 'unavailable',
})

export const SESSION_EVENT = Object.freeze({
  CHECKING: 'checking',
  RESOLVED: 'resolved',
  NONE: 'none',
  EXPIRED: 'expired',
  SIGNED_OUT: 'signed_out',
  UNAVAILABLE: 'unavailable',
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PERMISSION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * Valida o corpo do `GET /auth/me`:
 * `{ id (uuid), matricula, nome, perfil, papeis: string[], permissoes: string[] }`.
 * Devolve o usuário (congelado) ou `null`.
 */
export function parseSessionUser(payload) {
  if (!isObject(payload)) return null
  const { id, matricula, nome, perfil, papeis, permissoes } = payload
  if (typeof id !== 'string' || !UUID.test(id)) return null
  if (typeof matricula !== 'string' || !matricula) return null
  if (!nonEmptyString(nome) || !nonEmptyString(perfil)) return null
  if (!Array.isArray(papeis) || !papeis.every((role) => nonEmptyString(role))) return null
  if (!Array.isArray(permissoes) || permissoes.some((permission) => typeof permission !== 'string')) return null
  const clean = [...new Set(permissoes.filter((permission) => permission.length <= 60 && PERMISSION.test(permission)))]
  return Object.freeze({
    id,
    matricula,
    nome: nome.trim(),
    perfil: perfil.trim(),
    papeis: Object.freeze([...new Set(papeis.map((role) => role.trim()))]),
    permissoes: Object.freeze(clean),
  })
}

/** Permissão concedida pelo SERVIDOR a este usuário. Perfil/papel não entram aqui. */
export function hasPermission(user, permission) {
  return Boolean(user) && typeof permission === 'string' && permission.length > 0
    && Array.isArray(user.permissoes) && user.permissoes.includes(permission)
}

const LEGACY_PROFILE_LABEL = Object.freeze({
  ADMINISTRADOR: 'Administrador',
  ALMOXARIFADO: 'Almoxarifado',
  PORTARIA: 'Portaria',
  SUPRIMENTOS: 'Suprimentos',
  CONSULTA: 'Consulta',
})

function readableProfile(perfil) {
  if (LEGACY_PROFILE_LABEL[perfil]) return LEGACY_PROFILE_LABEL[perfil]
  const text = String(perfil).toLowerCase()
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/**
 * Usuário no formato que o store local de recebimentos já entende
 * (`nome`/`name`, `perfil`/`role` legíveis). É só apresentação e as regras
 * locais do store; a autorização de verdade é do servidor (`permissoes`).
 */
export function toStoreUser(user) {
  if (!user) return null
  const perfil = readableProfile(user.perfil)
  return {
    id: user.id,
    matricula: user.matricula,
    nome: user.nome,
    name: user.nome,
    iniciais: user.nome.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
    perfil,
    role: perfil,
    permissoes: [...user.permissoes],
  }
}

function make(status, user = null, reason = null) {
  return Object.freeze({ status, user, reason })
}

export function createInitialSession() {
  return make(SESSION_STATUS.CHECKING)
}

/** Reducer puro: `(estado, { type, user? }) => novoEstado`. */
export function sessionReducer(state = createInitialSession(), event) {
  switch (event?.type) {
    case SESSION_EVENT.CHECKING:
      return state.status === SESSION_STATUS.CHECKING ? state : make(SESSION_STATUS.CHECKING)
    case SESSION_EVENT.RESOLVED: {
      const user = parseSessionUser(event.user)
      return user ? make(SESSION_STATUS.AUTHENTICATED, user) : make(SESSION_STATUS.ANONYMOUS)
    }
    case SESSION_EVENT.NONE:
    case SESSION_EVENT.EXPIRED: {
      // "Expirou" só para quem tinha entrado; quem nunca entrou não vê esse aviso.
      const hadSession = state.status === SESSION_STATUS.AUTHENTICATED
      return make(SESSION_STATUS.ANONYMOUS, null, hadSession ? 'expired' : state.reason === 'expired' ? 'expired' : null)
    }
    case SESSION_EVENT.SIGNED_OUT:
      return make(SESSION_STATUS.ANONYMOUS, null, 'signed_out')
    case SESSION_EVENT.UNAVAILABLE:
      return make(SESSION_STATUS.UNAVAILABLE)
    default:
      return state
  }
}
