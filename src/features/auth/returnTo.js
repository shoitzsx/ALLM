/**
 * Destino de retorno depois do login (`#/login?returnTo=/recebimentos/REC-1`).
 *
 * O valor vem da URL, ou seja, de quem controla o link: é entrada hostil.
 * Aceita SÓ um caminho interno do roteador por hash (começa com uma única
 * "/"). Tudo o mais — endereço absoluto, `//host`, `javascript:`, barra
 * invertida, caractere de controle, codificação que esconda um desses —
 * cai no destino padrão. Não decide permissão: só garante que o retorno não
 * leva para fora do app nem de volta ao próprio login.
 */
export const DEFAULT_RETURN_TO = '/'
const MAX_LENGTH = 300
const LOGIN_PATH = '/login'

// Nomes de parâmetro que nunca devem viajar numa URL de retorno (PIN etc.).
const SENSITIVE_PARAM = /^(pin|senha|password|passwd|matricula|token|code|codigo|challenge|credential|credencial|secret|segredo)/i
const CONTROL_OR_SPACE_OR_BACKSLASH = /[\u0000- \u007f-\u009f\\]/
const SCHEME_AT_START = /^\/*[a-z][a-z0-9+.-]*:/i

function looksSafe(path) {
  if (!path.startsWith('/') || path.startsWith('//')) return false
  if (CONTROL_OR_SPACE_OR_BACKSLASH.test(path)) return false
  if (SCHEME_AT_START.test(path)) return false
  return true
}

/**
 * @param {unknown} value        valor bruto (ex.: `query.get('returnTo')`)
 * @param {object}  [options]
 * @param {string}  [options.fallback]     destino quando o valor é rejeitado
 * @param {(path: string) => boolean} [options.isKnownPath]  restrição opcional a rotas conhecidas
 */
export function sanitizeReturnTo(value, { fallback = DEFAULT_RETURN_TO, isKnownPath } = {}) {
  if (typeof value !== 'string') return fallback
  let raw = value.startsWith('#') ? value.slice(1) : value
  if (raw.length === 0 || raw.length > MAX_LENGTH) return fallback
  if (raw.includes('#')) return fallback
  if (!looksSafe(raw)) return fallback

  // A codificação não pode esconder o que a checagem acima rejeitaria
  // (`/%2Fevil`, `/%5Cevil`, `/%0Aevil`). Decodifica duas vezes, de propósito.
  let decoded = raw
  try {
    decoded = decodeURIComponent(decodeURIComponent(raw))
  } catch {
    return fallback
  }
  if (!looksSafe(decoded)) return fallback

  const [path, query = ''] = raw.split('?')
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`)) return fallback
  if (typeof isKnownPath === 'function' && !isKnownPath(path)) return fallback

  if (query) {
    for (const key of new URLSearchParams(query).keys()) {
      if (SENSITIVE_PARAM.test(key)) return fallback
    }
  }
  return raw
}

/** Lê e sanitiza `returnTo` de um `URLSearchParams` (ver `useHashRoute().query`). */
export function readReturnTo(query, options) {
  return sanitizeReturnTo(query?.get?.('returnTo'), options)
}

/** Monta a rota de login com o retorno já sanitizado (omite o parâmetro quando é o padrão). */
export function buildLoginRoute(returnTo, options) {
  const safe = sanitizeReturnTo(returnTo, options)
  return safe === (options?.fallback ?? DEFAULT_RETURN_TO) ? LOGIN_PATH : `${LOGIN_PATH}?returnTo=${encodeURIComponent(safe)}`
}
