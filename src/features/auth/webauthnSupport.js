import { AUTH_EVENT, UNSUPPORTED_REASON } from './authStates.js'

/**
 * Suporte a WebAuthn e interpretação de erros do navegador. Só LEITURA de
 * capacidades e mapeamento de nomes de erro: este módulo nunca chama
 * `navigator.credentials` nem monta opções de cerimônia (isso depende do
 * contrato do servidor e fica para outra etapa).
 */

/**
 * `env` é o objeto global (`window`); injetável para testar. WebAuthn exige
 * contexto seguro (HTTPS ou localhost) — checado ANTES da presença da API,
 * porque em contexto inseguro vários navegadores escondem a API e a mensagem
 * correta para o usuário é "abra pelo endereço seguro", não "navegador
 * antigo". `isSecureContext` ausente (ambiente sem a propriedade) não é
 * tratado como inseguro: só `false` explícito.
 */
export function getWebAuthnSupport(env = globalThis) {
  if (!env) return { supported: false, reason: UNSUPPORTED_REASON.SEM_WEBAUTHN }
  if (env.isSecureContext === false) {
    return { supported: false, reason: UNSUPPORTED_REASON.CONTEXTO_INSEGURO }
  }
  const hasApi = typeof env.PublicKeyCredential === 'function'
  const hasCredentials = typeof env.navigator?.credentials?.get === 'function'
  if (!hasApi || !hasCredentials) {
    return { supported: false, reason: UNSUPPORTED_REASON.SEM_WEBAUTHN }
  }
  return { supported: true, reason: null }
}

/**
 * Traduz o erro de uma cerimônia WebAuthn num evento da máquina de estados.
 * Usa SÓ `error.name` (nomes padronizados de DOMException): a mensagem do
 * navegador nunca é lida nem repassada, porque pode conter detalhes do
 * dispositivo ou do site.
 *
 * `NotAllowedError` cobre cancelamento do usuário E tempo esgotado — o
 * navegador de propósito não distingue os dois (privacidade), por isso a
 * interface fala em "cancelada ou expirada".
 */
export function eventFromWebAuthnError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'AbortError':
      return { type: AUTH_EVENT.SECOND_FACTOR_INTERRUPTED }
    case 'SecurityError':
      return { type: AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED, reason: UNSUPPORTED_REASON.SEGURANCA }
    case 'NotSupportedError':
    case 'ConstraintError':
      return { type: AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED, reason: UNSUPPORTED_REASON.AUTENTICADOR }
    default:
      return { type: AUTH_EVENT.SECOND_FACTOR_FAILED }
  }
}

/** Evento a emitir quando o dispositivo já se sabe incompatível (sem tentar a cerimônia). */
export function eventFromSupport(support) {
  if (support?.supported) return null
  return { type: AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED, reason: support?.reason || UNSUPPORTED_REASON.SEM_WEBAUTHN }
}
