import { AUTH_EVENT, LOGIN_FAILURE } from './authStates.js'
import { eventFromSupport, eventFromWebAuthnError } from './webauthnSupport.js'

/**
 * Orquestração do login real, sem React: matrícula + PIN → desafio WebAuthn →
 * resposta do dispositivo → sessão validada pelo servidor.
 *
 * Passos (contrato em backend/POSTGRES_N2.md):
 *   `start`   POST /auth/login-challenges  → guarda SÓ `{challengeId, options}`
 *   `confirm` WebAuthn no dispositivo + POST /auth/login-challenges/:id/complete
 *             + GET /auth/me (via `refreshSession`)
 *
 * Os "sinais" emitidos alimentam a máquina de estados da tela (authStates.js),
 * que não tem estado "autenticado". O sucesso (`SIGNED_IN`) só é emitido
 * depois que o SERVIDOR devolveu a sessão em `GET /auth/me`; qualquer falha
 * nesse caminho termina em erro, nunca em acesso.
 *
 * O PIN vive só dentro da chamada de `start` (vai ao corpo da requisição) e não
 * é guardado, copiado nem emitido. O desafio fica em memória até ser usado.
 */
export const FLOW_SIGNAL = Object.freeze({
  CEREMONY_RUNNING: 'ceremony_running',
  CEREMONY_IDLE: 'ceremony_idle',
  CHALLENGE_EXPIRED: 'challenge_expired',
  SIGNED_IN: 'signed_in',
})

/** Falha do primeiro fator (matrícula+PIN) → qual aviso a tela mostra. */
export function failureForStartError(error) {
  switch (error?.kind) {
    case 'invalid_credentials': return LOGIN_FAILURE.CREDENCIAIS
    case 'rate_limited': return LOGIN_FAILURE.LIMITE
    case 'network': return LOGIN_FAILURE.CONEXAO
    default: return LOGIN_FAILURE.INDISPONIVEL
  }
}

/**
 * @param {object} deps
 * @param {{ startLogin: Function, completeLogin: Function }} deps.api
 * @param {{ authenticate: Function }} deps.webauthn
 * @param {() => { supported: boolean, reason: string|null }} deps.getSupport
 * @param {() => Promise<object|null>} deps.refreshSession  lê GET /auth/me; devolve o usuário validado ou null
 * @param {(event: object) => void} deps.emit
 */
export function createLoginFlow({ api, webauthn, getSupport, refreshSession, emit }) {
  let pending = null
  let completed = false
  let busy = false
  let disposed = false
  let generation = 0
  let controller = null

  const send = (event) => { if (!disposed) emit(event) }

  async function finishSession(token) {
    try {
      const user = await refreshSession()
      if (token !== generation) return
      if (user) {
        completed = false
        send({ type: FLOW_SIGNAL.SIGNED_IN })
      } else {
        send({ type: AUTH_EVENT.SECOND_FACTOR_FAILED })
      }
    } catch (error) {
      if (token !== generation) return
      send({ type: error?.kind === 'network' ? AUTH_EVENT.CONNECTION_FAILED : AUTH_EVENT.SECOND_FACTOR_FAILED })
    }
  }

  /** Devolve true quando o servidor aceitou a resposta (sessão criada do lado dele). */
  async function ceremony(token) {
    controller = new AbortController()
    send({ type: FLOW_SIGNAL.CEREMONY_RUNNING })
    try {
      let response
      try {
        response = await webauthn.authenticate(pending.options, { signal: controller.signal })
      } catch (error) {
        if (token === generation) send(eventFromWebAuthnError(error))
        return false
      }
      if (token !== generation) return false
      try {
        await api.completeLogin(pending.challengeId, response)
      } catch (error) {
        if (token !== generation) return false
        if (error?.kind === 'challenge_invalid') {
          // O servidor consome o desafio mesmo quando a resposta falha: só recomeçando.
          pending = null
          send({ type: FLOW_SIGNAL.CHALLENGE_EXPIRED })
        } else if (error?.kind === 'network') {
          send({ type: AUTH_EVENT.CONNECTION_FAILED })
        } else {
          send({ type: AUTH_EVENT.SECOND_FACTOR_FAILED })
        }
        return false
      }
      pending = null
      completed = true
      return true
    } finally {
      send({ type: FLOW_SIGNAL.CEREMONY_IDLE })
    }
  }

  return {
    /** 1º fator. O PIN só é lido aqui e vai direto ao corpo da requisição. */
    async start({ matricula, pin }) {
      if (busy || disposed) return
      busy = true
      generation += 1
      const token = generation
      pending = null
      completed = false
      try {
        const support = getSupport()
        if (!support?.supported) {
          send(eventFromSupport(support))
          return
        }
        let result
        try {
          result = await api.startLogin({ matricula, pin })
        } catch (error) {
          if (token === generation) send({ type: AUTH_EVENT.CREDENTIALS_REJECTED, failure: failureForStartError(error) })
          return
        }
        if (token !== generation) return
        pending = { challengeId: result.challengeId, options: result.options }
        send({ type: AUTH_EVENT.SECOND_FACTOR_REQUIRED })
      } finally {
        busy = false
      }
    },

    /**
     * 2º fator. Chamar DENTRO de um toque do usuário (o Safari exige gesto para
     * abrir a passkey). Com o desafio já aceito pelo servidor (`completed`), só
     * relê a sessão — não pede a passkey de novo.
     */
    async confirm() {
      if (busy || disposed) return
      busy = true
      const token = generation
      try {
        if (!completed) {
          if (!pending) {
            send({ type: FLOW_SIGNAL.CHALLENGE_EXPIRED })
            return
          }
          if (!(await ceremony(token))) return
        }
        await finishSession(token)
      } finally {
        busy = false
      }
    },

    /** Desiste: aborta a passkey em andamento e descarta o desafio. */
    cancel() {
      generation += 1
      controller?.abort()
      controller = null
      pending = null
      completed = false
    },

    /** Componente desmontado: nada mais chega à tela. */
    dispose() {
      disposed = true
      generation += 1
      controller?.abort()
      pending = null
      completed = false
    },

    /** Reativa depois de `dispose` (efeitos em dupla do StrictMode desmontam e remontam). */
    activate() {
      disposed = false
    },
  }
}
