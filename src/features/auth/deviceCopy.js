import { UNSUPPORTED_REASON } from './authStates.js'
import { REGISTRATION_REASON } from './registrationFlow.js'

/**
 * Textos e regras de apresentação dos dispositivos (passkeys) — puros, sem
 * rede. Tudo que a tela mostra vem destas tabelas: a mensagem do servidor
 * nunca é exibida. Só metadados: nenhuma chave, credencial ou identificador
 * técnico chega à descrição.
 */
const METHOD_LABEL = Object.freeze({
  ATIVACAO: 'Ativação autorizada',
  AUTENTICADA: 'Cadastrado com a sessão ativa',
  RECUPERACAO: 'Recuperação autorizada',
})

const defaultFormat = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function describeAuthenticator(row, { format = defaultFormat } = {}) {
  return {
    id: row.id,
    name: row.nome || 'Autenticador',
    method: METHOD_LABEL[row.metodoCadastro] || 'Cadastro registrado',
    created: row.criadoEm ? format(row.criadoEm) : '—',
    lastUsed: row.ultimoUsoEm ? format(row.ultimoUsoEm) : 'Nunca usado',
    revoked: Boolean(row.revogadoEm),
    revokedAt: row.revogadoEm ? format(row.revogadoEm) : null,
    syncedAcrossDevices: Boolean(row.backupState),
  }
}

export const activeCount = (rows) => rows.filter((row) => !row.revogadoEm).length

/** A interface só oferece remover quando sobra outro ativo (o servidor também recusa o último). */
export function canRevoke(rows, row) {
  return Boolean(row) && !row.revogadoEm && activeCount(rows) > 1
}

const REASON_MAX = 200

export function validateRevocationReason(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return { ok: false, message: 'Informe o motivo da remoção.' }
  if (text.length > REASON_MAX) return { ok: false, message: `O motivo deve ter até ${REASON_MAX} caracteres.` }
  return { ok: true, value: text }
}

const UNSUPPORTED_DESCRIPTION = Object.freeze({
  [UNSUPPORTED_REASON.CONTEXTO_INSEGURO]: 'A passkey só funciona em conexão segura (HTTPS). Abra o ALM pelo endereço seguro oficial.',
  [UNSUPPORTED_REASON.SEM_WEBAUTHN]: 'Este navegador não oferece passkeys. Use um navegador atualizado ou outro dispositivo.',
  [UNSUPPORTED_REASON.SEGURANCA]: 'O navegador bloqueou a passkey. Abra o ALM pelo endereço oficial.',
  [UNSUPPORTED_REASON.AUTENTICADOR]: 'Este dispositivo não tem uma passkey compatível. Use outro dispositivo.',
})

const R = REGISTRATION_REASON

const REGISTRATION_COPY = Object.freeze({
  [R.INVALID_CREDENTIALS]: { tone: 'error', title: 'Matrícula, PIN ou código inválidos.', description: 'Confira os dados e tente novamente. Se continuar, procure um responsável pelo ALM.' },
  [R.RATE_LIMITED]: { tone: 'warning', title: 'Muitas tentativas.', description: 'Aguarde um pouco antes de tentar novamente.' },
  [R.RECENT_MFA_REQUIRED]: { tone: 'warning', title: 'Confirme sua identidade.', description: 'Por segurança, saia e entre novamente para cadastrar ou remover dispositivos.' },
  [R.UNAUTHORIZED]: { tone: 'info', title: 'Sua sessão expirou.', description: 'Entre novamente para continuar.' },
  [R.EXPIRED]: { tone: 'info', title: 'A confirmação expirou ou não foi aceita.', description: 'Recomece o cadastro.' },
  [R.ALREADY_REGISTERED]: { tone: 'info', title: 'Este dispositivo já está cadastrado.', description: 'Use outro dispositivo ou continue com o que já está cadastrado.' },
  [R.INTERRUPTED]: { tone: 'warning', title: 'Confirmação cancelada ou expirada.', description: 'Nada foi cadastrado. Tente novamente quando estiver com o dispositivo em mãos.' },
  [R.NETWORK]: { tone: 'error', title: 'Não foi possível conectar ao ALM.', description: 'Verifique sua conexão e tente novamente.' },
  [R.FAILED]: { tone: 'error', title: 'Não foi possível concluir o cadastro.', description: 'Tente novamente. Se continuar, procure um responsável pelo ALM.' },
})

export function registrationErrorCopy(reason, unsupported) {
  if (reason === R.UNSUPPORTED) {
    return {
      tone: 'error',
      title: 'Dispositivo ou navegador incompatível.',
      description: UNSUPPORTED_DESCRIPTION[unsupported] || 'Use outro dispositivo ou procure um responsável pelo ALM.',
    }
  }
  return REGISTRATION_COPY[reason] || REGISTRATION_COPY[R.FAILED]
}

const DEVICE_ERROR_COPY = Object.freeze({
  recent_mfa_required: { tone: 'warning', title: 'Confirme sua identidade.', description: 'Por segurança, saia e entre novamente para cadastrar ou remover dispositivos.' },
  conflict: { tone: 'warning', title: 'Cadastre outro dispositivo antes de remover este.', description: 'É preciso manter pelo menos um dispositivo ativo.' },
  not_found: { tone: 'info', title: 'Dispositivo não encontrado.', description: 'A lista foi atualizada.' },
  network: { tone: 'error', title: 'Não foi possível conectar ao ALM.', description: 'Verifique sua conexão e tente novamente.' },
  forbidden: { tone: 'error', title: 'Sem permissão para esta operação.', description: 'Procure um responsável pelo ALM.' },
  rate_limited: { tone: 'warning', title: 'Muitas tentativas.', description: 'Aguarde um pouco antes de tentar novamente.' },
  validation: { tone: 'error', title: 'Não foi possível concluir a operação.', description: 'Confira os dados e tente novamente.' },
  unavailable: { tone: 'error', title: 'Não foi possível concluir a operação.', description: 'Tente novamente em instantes. Se continuar, procure um responsável pelo ALM.' },
})

export function deviceErrorCopy(kind) {
  return DEVICE_ERROR_COPY[kind] || DEVICE_ERROR_COPY.unavailable
}
