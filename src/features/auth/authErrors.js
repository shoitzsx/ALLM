import { AUTH_STATUS, LOGIN_FAILURE, UNSUPPORTED_REASON } from './authStates.js'

/**
 * Textos públicos da tela de acesso, em português.
 *
 * Regra central: a tela NUNCA mostra a mensagem crua de um erro (do servidor,
 * do navegador ou de uma exceção). Tudo o que o usuário lê vem das tabelas
 * fixas abaixo. Matrícula desconhecida, conta inativa, PIN incorreto e
 * credencial bloqueada caem na MESMA mensagem — o contrato SQL pede resposta
 * pública uniforme para não revelar quais matrículas existem.
 */
export const LOGIN_FAILURE_COPY = Object.freeze({
  [LOGIN_FAILURE.CREDENCIAIS]: Object.freeze({
    tone: 'error',
    title: 'Matrícula ou PIN inválidos.',
    description: 'Verifique os dados e tente novamente.',
    fieldLevel: true,
  }),
  [LOGIN_FAILURE.LIMITE]: Object.freeze({
    tone: 'warning',
    title: 'Muitas tentativas.',
    description: 'Aguarde um pouco antes de tentar novamente.',
    fieldLevel: false,
  }),
  [LOGIN_FAILURE.INDISPONIVEL]: Object.freeze({
    tone: 'error',
    title: 'Não foi possível concluir o acesso.',
    description: 'Tente novamente em instantes. Se continuar, procure um responsável pelo ALM.',
    fieldLevel: false,
  }),
})

/**
 * Aviso de excesso na matrícula. Fala só do LIMITE (que a tela já mostra em
 * "Até 6 números"); o mínimo é validação interna e nunca aparece em texto.
 */
export const MATRICULA_OVERFLOW_MESSAGE = 'A matrícula não pode ultrapassar 6 dígitos.'

/** Só 429 e falha de servidor se distinguem; todo o resto de 4xx é "credenciais". */
export const CONNECTION_FAILURE = 'conexao'

/**
 * Classificação provisória por semântica HTTP genérica. NÃO depende de
 * endpoint, de corpo de resposta nem de códigos de erro do backend (que o
 * Goran ainda não formalizou) — só do status e de falha de rede. Quando o
 * contrato existir, os códigos específicos entram AQUI sem mexer nas telas.
 * Devolve sempre uma chave das tabelas acima (nunca texto do servidor).
 */
export function classifyLoginFailure({ status, networkError } = {}) {
  if (networkError || status === 0) return CONNECTION_FAILURE
  const code = Number(status)
  if (code === 429) return LOGIN_FAILURE.LIMITE
  if (code >= 400 && code < 500) return LOGIN_FAILURE.CREDENCIAIS
  return LOGIN_FAILURE.INDISPONIVEL
}

export function getLoginFailureCopy(failure) {
  return LOGIN_FAILURE_COPY[failure] || LOGIN_FAILURE_COPY[LOGIN_FAILURE.INDISPONIVEL]
}

const UNSUPPORTED_COPY = Object.freeze({
  [UNSUPPORTED_REASON.CONTEXTO_INSEGURO]: {
    title: 'Conexão não segura.',
    description: 'A passkey só funciona em conexão segura (HTTPS). Abra o ALM pelo endereço seguro oficial.',
  },
  [UNSUPPORTED_REASON.SEM_WEBAUTHN]: {
    title: 'Navegador ou dispositivo incompatível.',
    description: 'Este navegador não oferece passkeys. Use um navegador atualizado ou outro dispositivo.',
  },
  [UNSUPPORTED_REASON.SEGURANCA]: {
    title: 'O navegador bloqueou a passkey.',
    description: 'Isso costuma acontecer quando o endereço não é o oficial do ALM. Abra o ALM pelo endereço oficial.',
  },
  [UNSUPPORTED_REASON.AUTENTICADOR]: {
    title: 'Este dispositivo não tem uma passkey compatível.',
    description: 'Use o dispositivo em que a sua passkey foi cadastrada ou procure um responsável pelo ALM.',
  },
  [UNSUPPORTED_REASON.GENERICO]: {
    title: 'Dispositivo ou navegador incompatível.',
    description: 'Use outro dispositivo ou procure um responsável pelo ALM.',
  },
})

const STEP_COPY = Object.freeze({
  [AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR]: {
    tone: 'info',
    title: 'Confirme no seu dispositivo',
    description: 'O segundo fator é obrigatório. Siga as instruções do dispositivo para usar a sua passkey.',
  },
  [AUTH_STATUS.CONFIRMACAO_INTERROMPIDA]: {
    tone: 'warning',
    title: 'Confirmação cancelada ou expirada.',
    description: 'Nada foi concluído. Tente novamente quando estiver com o dispositivo em mãos.',
  },
  [AUTH_STATUS.PASSKEY_NAO_CADASTRADA]: {
    tone: 'info',
    title: 'Passkey não cadastrada.',
    description: 'O acesso ao ALM exige uma passkey. Procure um responsável pelo ALM para habilitá-la.',
  },
  [AUTH_STATUS.ERRO_CONEXAO]: {
    tone: 'error',
    title: 'Não foi possível conectar ao ALM.',
    description: 'Verifique sua conexão e tente novamente.',
  },
  [AUTH_STATUS.ERRO_SEGUNDO_FATOR]: {
    tone: 'error',
    title: 'Não foi possível confirmar.',
    description: 'Tente novamente. Se continuar, procure um responsável pelo ALM.',
  },
})

/**
 * Texto do passo do segundo fator para um estado `{ status, reason }`.
 * Estado sem texto (ou desconhecido) devolve `null`: quem chama não inventa
 * mensagem.
 */
export function getStepCopy(state) {
  if (!state) return null
  if (state.status === AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL) {
    return { tone: 'error', ...(UNSUPPORTED_COPY[state.reason] || UNSUPPORTED_COPY[UNSUPPORTED_REASON.GENERICO]) }
  }
  return STEP_COPY[state.status] || null
}

/** Aviso exibido na tela de credenciais por causa de uma sessão que terminou (ver LoginPage). */
export const SESSION_EXPIRED_COPY = Object.freeze({
  tone: 'info',
  title: 'Sua sessão expirou.',
  description: 'Entre novamente para continuar.',
})

/** Texto do estado "ainda sem login real" desta etapa: honesto sobre não enviar nada. */
export const NOT_AVAILABLE_COPY = Object.freeze({
  tone: 'info',
  title: 'Acesso ainda não disponível neste ambiente.',
  description: 'Nenhum dado foi enviado. A autenticação real depende da integração com o servidor.',
})
