/**
 * Estados REPRESENTACIONAIS da tela de acesso (matrícula + PIN + passkey).
 *
 * Propositalmente NÃO existe aqui um estado "autenticado", "logado" ou
 * "sessão": esta máquina só decide o que a tela mostra. Quem concede acesso
 * é o backend (sessão criada só depois de PIN + passkey verificados), e essa
 * confirmação futura não passa por este módulo. Nenhum evento abaixo é, por
 * si só, prova de identidade: SECOND_FACTOR_REQUIRED quer dizer apenas "o
 * servidor pediu o segundo fator" — o PIN sozinho nunca leva além de
 * AGUARDANDO_SEGUNDO_FATOR.
 *
 * Função pura, sem relógio, sem rede, sem armazenamento: dá para testar em
 * Node e reaproveitar com `useReducer(transition, undefined, createInitialState)`.
 */
export const AUTH_STATUS = Object.freeze({
  CREDENCIAIS: 'credenciais',
  VERIFICANDO_CREDENCIAIS: 'verificando_credenciais',
  AGUARDANDO_SEGUNDO_FATOR: 'aguardando_segundo_fator',
  CONFIRMACAO_INTERROMPIDA: 'confirmacao_interrompida',
  PASSKEY_NAO_CADASTRADA: 'passkey_nao_cadastrada',
  DISPOSITIVO_INCOMPATIVEL: 'dispositivo_incompativel',
  ERRO_CONEXAO: 'erro_conexao',
  ERRO_SEGUNDO_FATOR: 'erro_segundo_fator',
})

export const AUTH_EVENT = Object.freeze({
  SUBMIT_CREDENTIALS: 'submit_credentials',
  CREDENTIALS_REJECTED: 'credentials_rejected',
  SECOND_FACTOR_REQUIRED: 'second_factor_required',
  NO_PASSKEY: 'no_passkey',
  SECOND_FACTOR_UNSUPPORTED: 'second_factor_unsupported',
  SECOND_FACTOR_INTERRUPTED: 'second_factor_interrupted',
  SECOND_FACTOR_FAILED: 'second_factor_failed',
  CONNECTION_FAILED: 'connection_failed',
  RETRY: 'retry',
  BACK: 'back',
})

/** Motivos de falha de credencial; os textos públicos ficam em authErrors.js. */
export const LOGIN_FAILURE = Object.freeze({
  CREDENCIAIS: 'credenciais',
  LIMITE: 'limite',
  INDISPONIVEL: 'indisponivel',
})

/** Por que o dispositivo/navegador não serve para a passkey. */
export const UNSUPPORTED_REASON = Object.freeze({
  SEM_WEBAUTHN: 'sem_webauthn',
  CONTEXTO_INSEGURO: 'contexto_inseguro',
  SEGURANCA: 'seguranca',
  AUTENTICADOR: 'autenticador',
  GENERICO: 'generico',
})

const KNOWN_FAILURES = new Set(Object.values(LOGIN_FAILURE))
const KNOWN_REASONS = new Set(Object.values(UNSUPPORTED_REASON))
const S = AUTH_STATUS
const E = AUTH_EVENT

function make(status, extra = {}) {
  return Object.freeze({ status, failure: null, reason: null, retryStatus: null, ...extra })
}

export function createInitialState(status = S.CREDENCIAIS, extra = {}) {
  return make(status, extra)
}

const normalizeFailure = (failure) => (KNOWN_FAILURES.has(failure) ? failure : LOGIN_FAILURE.INDISPONIVEL)
const normalizeReason = (reason) => (KNOWN_REASONS.has(reason) ? reason : UNSUPPORTED_REASON.GENERICO)

/**
 * Transições permitidas por estado. Evento que não consta aqui é ignorado e
 * `transition` devolve o MESMO objeto de estado (sem efeito, sem erro).
 */
const TRANSITIONS = {
  [S.CREDENCIAIS]: {
    [E.SUBMIT_CREDENTIALS]: () => make(S.VERIFICANDO_CREDENCIAIS),
  },
  [S.VERIFICANDO_CREDENCIAIS]: {
    [E.CREDENTIALS_REJECTED]: (_s, ev) => make(S.CREDENCIAIS, { failure: normalizeFailure(ev.failure) }),
    [E.SECOND_FACTOR_REQUIRED]: () => make(S.AGUARDANDO_SEGUNDO_FATOR),
    [E.NO_PASSKEY]: () => make(S.PASSKEY_NAO_CADASTRADA),
    [E.SECOND_FACTOR_UNSUPPORTED]: (_s, ev) => make(S.DISPOSITIVO_INCOMPATIVEL, { reason: normalizeReason(ev.reason) }),
    [E.CONNECTION_FAILED]: (s) => make(S.ERRO_CONEXAO, { retryStatus: s.status }),
    [E.BACK]: () => make(S.CREDENCIAIS),
  },
  [S.AGUARDANDO_SEGUNDO_FATOR]: {
    [E.SECOND_FACTOR_INTERRUPTED]: () => make(S.CONFIRMACAO_INTERROMPIDA),
    [E.SECOND_FACTOR_UNSUPPORTED]: (_s, ev) => make(S.DISPOSITIVO_INCOMPATIVEL, { reason: normalizeReason(ev.reason) }),
    [E.SECOND_FACTOR_FAILED]: () => make(S.ERRO_SEGUNDO_FATOR),
    [E.CONNECTION_FAILED]: (s) => make(S.ERRO_CONEXAO, { retryStatus: s.status }),
    [E.BACK]: () => make(S.CREDENCIAIS),
  },
  [S.CONFIRMACAO_INTERROMPIDA]: {
    [E.RETRY]: () => make(S.AGUARDANDO_SEGUNDO_FATOR),
    [E.BACK]: () => make(S.CREDENCIAIS),
  },
  [S.ERRO_SEGUNDO_FATOR]: {
    [E.RETRY]: () => make(S.AGUARDANDO_SEGUNDO_FATOR),
    [E.BACK]: () => make(S.CREDENCIAIS),
  },
  [S.ERRO_CONEXAO]: {
    // Volta ao passo em que a conexão falhou. Quem reenvia a requisição é o
    // chamador; esta máquina só diz qual tela mostrar.
    [E.RETRY]: (s) => make(s.retryStatus === S.AGUARDANDO_SEGUNDO_FATOR ? S.AGUARDANDO_SEGUNDO_FATOR : S.VERIFICANDO_CREDENCIAIS),
    [E.BACK]: () => make(S.CREDENCIAIS),
  },
  // Sem RETRY de propósito: nada que o usuário faça nesta tela resolve; só voltar.
  [S.PASSKEY_NAO_CADASTRADA]: {
    [E.BACK]: () => make(S.CREDENCIAIS),
  },
  [S.DISPOSITIVO_INCOMPATIVEL]: {
    [E.BACK]: () => make(S.CREDENCIAIS),
  },
}

/** Reducer puro: `(estado, { type, ...dados }) => novoEstado`. */
export function transition(state, event) {
  const current = state && TRANSITIONS[state.status] ? state : createInitialState()
  const handler = TRANSITIONS[current.status]?.[event?.type]
  return handler ? handler(current, event) : current
}

/** Estados em que a tela está ocupada: campos e ações ficam desativados. */
export function isBusy(state) {
  return state?.status === S.VERIFICANDO_CREDENCIAIS || state?.status === S.AGUARDANDO_SEGUNDO_FATOR
}

/** Estados que mostram o passo do segundo fator em vez do formulário. */
export function isSecondFactorStep(state) {
  return Boolean(state) && state.status !== S.CREDENCIAIS && state.status !== S.VERIFICANDO_CREDENCIAIS
}
