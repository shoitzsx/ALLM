import { AUTH_EVENT, UNSUPPORTED_REASON } from './authStates.js'
import { eventFromWebAuthnError } from './webauthnSupport.js'

/**
 * Cadastro de passkey, sem React. Contrato (backend/POSTGRES_N2.md):
 *   POST /auth/authenticators/registration-challenges  → {challengeId, options}
 *   POST /auth/authenticators                          → {id, nome, criadoEm}
 * Três entradas:
 *   - `begin()`                       com a sessão atual (o servidor exige MFA recente);
 *   - `begin({matricula,pin,activationCode})`  ativação autorizada com PIN já definitivo
 *                                     (novo dispositivo/recuperação);
 *   - `beginFirstAccess({matricula,temporaryPin,newPin,activationCode})`  PRIMEIRO ACESSO:
 *                                     troca o PIN temporário (POST /auth/initial-pin, PR #6) e
 *                                     segue para o cadastro com o PIN novo e o MESMO código.
 *
 * A passkey só abre em `confirm()`, que deve rodar dentro de um toque do usuário
 * (o Safari exige o gesto). Segredos: o PIN é lido só quando é enviado e vai direto ao
 * corpo da requisição; o código de ativação fica em memória até o fim do cadastro (o
 * servidor o pede de novo na conclusão). No primeiro acesso, depois da troca do PIN, o
 * fluxo guarda em memória {matricula, PIN novo, código} só para `resume()` refazer o
 * desafio se o cadastro falhar por motivo passageiro (rede, limite, servidor fora): sem
 * isso o PIN já trocado deixaria o usuário sem como continuar. Tudo é esquecido ao
 * concluir, cancelar, desmontar ou quando o servidor recusa de forma definitiva. O
 * código NUNCA é consumido nem invalidado aqui — quem o gasta é o servidor, ao gravar a
 * passkey. O estado emitido nunca contém PIN nem código.
 */
export const REGISTRATION_STATUS = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  READY: 'ready',
  CONFIRMING: 'confirming',
  DONE: 'done',
  ERROR: 'error',
})

export const REGISTRATION_REASON = Object.freeze({
  UNSUPPORTED: 'unsupported',
  INVALID_CREDENTIALS: 'invalid_credentials',
  RATE_LIMITED: 'rate_limited',
  RECENT_MFA_REQUIRED: 'recent_mfa_required',
  UNAUTHORIZED: 'unauthorized',
  EXPIRED: 'expired',
  ALREADY_REGISTERED: 'already_registered',
  INTERRUPTED: 'interrupted',
  NETWORK: 'network',
  FAILED: 'failed',
})

const R = REGISTRATION_REASON

// Depois da troca do PIN: só estes motivos deixam o usuário tentar de novo com o que já está na memória.
const RETRYABLE_AFTER_PIN_CHANGE = new Set([R.NETWORK, R.RATE_LIMITED, R.FAILED, R.EXPIRED, R.INTERRUPTED])

function reasonForApiError(error) {
  switch (error?.kind) {
    case 'invalid_credentials': return R.INVALID_CREDENTIALS
    case 'rate_limited': return R.RATE_LIMITED
    case 'recent_mfa_required': return R.RECENT_MFA_REQUIRED
    case 'unauthorized': return R.UNAUTHORIZED
    case 'challenge_invalid': return R.EXPIRED
    case 'conflict': return R.ALREADY_REGISTERED
    case 'network': return R.NETWORK
    default: return R.FAILED
  }
}

/** Erro do navegador na cerimônia → motivo (só pelo NOME do erro; a mensagem nunca é lida). */
function reasonForCeremonyError(error) {
  // O navegador recusa com InvalidStateError quando o dispositivo já guarda uma
  // passkey desta conta (as opções trazem `excludeCredentials`): "já cadastrado".
  if (error?.name === 'InvalidStateError') return { reason: R.ALREADY_REGISTERED }
  const event = eventFromWebAuthnError(error)
  if (event.type === AUTH_EVENT.SECOND_FACTOR_INTERRUPTED) return { reason: R.INTERRUPTED }
  if (event.type === AUTH_EVENT.SECOND_FACTOR_UNSUPPORTED) return { reason: R.UNSUPPORTED, unsupported: event.reason }
  return { reason: R.FAILED }
}

/**
 * @param {object} deps
 * @param {{ startRegistration: Function, finishRegistration: Function, changeInitialPin?: Function }} deps.api
 * @param {{ register: Function }} deps.webauthn
 * @param {() => { supported: boolean, reason: string|null }} deps.getSupport
 * @param {(state: object) => void} deps.emit
 */
export function createRegistrationFlow({ api, webauthn, getSupport, emit }) {
  let pending = null
  let busy = false
  let disposed = false
  let generation = 0
  let controller = null
  // Primeiro acesso: o PIN já foi trocado no servidor (flag sem segredo) e, enquanto fizer
  // sentido tentar de novo, o que o desafio precisa (PIN novo e código), só em memória.
  let pinChanged = false
  let resumeContext = null

  const meta = () => (pinChanged ? { pinChanged: true } : {})
  const send = (state) => { if (!disposed) emit(Object.freeze(state)) }
  const fail = (reason, extra = {}) => {
    // Recusa definitiva: não há o que tentar de novo, então os segredos saem da memória.
    if (pinChanged && !RETRYABLE_AFTER_PIN_CHANGE.has(reason)) {
      resumeContext = null
      pending = null
    }
    send({ status: REGISTRATION_STATUS.ERROR, reason, ...meta(), ...(resumeContext ? { canResume: true } : {}), ...extra })
  }
  const forget = () => {
    pending = null
    resumeContext = null
    pinChanged = false
  }

  /** Pede o desafio de cadastro. Nada de passkey ainda: o toque do usuário vem depois. */
  async function requestChallenge(token, credentials, { firstAccess = false } = {}) {
    send({ status: REGISTRATION_STATUS.STARTING, ...(firstAccess ? { step: 'challenge', pinChanged: true } : {}) })
    let result
    try {
      result = await api.startRegistration(credentials)
    } catch (error) {
      if (token === generation) fail(reasonForApiError(error))
      return
    }
    if (token !== generation) return
    pending = {
      challengeId: result.challengeId,
      options: result.options,
      activationCode: credentials?.activationCode,
    }
    send({ status: REGISTRATION_STATUS.READY, ...meta() })
  }

  return {
    /** Pede o desafio (sessão MFA recente, ou ativação com PIN definitivo). */
    async begin(credentials) {
      if (busy || disposed) return
      busy = true
      generation += 1
      const token = generation
      forget()
      try {
        const support = getSupport()
        if (!support?.supported) {
          fail(R.UNSUPPORTED, { unsupported: support?.reason || UNSUPPORTED_REASON.SEM_WEBAUTHN })
          return
        }
        await requestChallenge(token, credentials)
      } finally {
        busy = false
      }
    },

    /**
     * Primeiro acesso: troca o PIN temporário e segue para o cadastro da primeira passkey.
     * Só segue se o servidor confirmou a troca; um erro ANTES dela não deixa nada para retomar.
     */
    async beginFirstAccess({ matricula, temporaryPin, newPin, activationCode }) {
      if (busy || disposed) return
      busy = true
      generation += 1
      const token = generation
      forget()
      try {
        const support = getSupport()
        if (!support?.supported) {
          fail(R.UNSUPPORTED, { unsupported: support?.reason || UNSUPPORTED_REASON.SEM_WEBAUTHN })
          return
        }
        send({ status: REGISTRATION_STATUS.STARTING, step: 'pin' })
        try {
          await api.changeInitialPin({ matricula, temporaryPin, newPin, activationCode })
        } catch (error) {
          if (token === generation) fail(reasonForApiError(error))
          return
        }
        if (token !== generation) return
        pinChanged = true
        resumeContext = { matricula, pin: newPin, activationCode }
        await requestChallenge(token, resumeContext, { firstAccess: true })
      } finally {
        busy = false
      }
    },

    /** Depois de a troca do PIN valer: refaz o desafio com o PIN novo e o mesmo código (sem trocar o PIN de novo). */
    async resume() {
      if (busy || disposed || !resumeContext) return
      busy = true
      generation += 1
      const token = generation
      pending = null
      try {
        await requestChallenge(token, resumeContext, { firstAccess: true })
      } finally {
        busy = false
      }
    },

    /** Abre a passkey e conclui o cadastro. Chamar dentro de um toque do usuário. */
    async confirm() {
      if (busy || disposed) return
      if (!pending) {
        if (generation > 0) fail(R.EXPIRED)
        return
      }
      busy = true
      const token = generation
      controller = new AbortController()
      send({ status: REGISTRATION_STATUS.CONFIRMING, ...meta() })
      try {
        let response
        try {
          response = await webauthn.register(pending.options, { signal: controller.signal })
        } catch (error) {
          if (token === generation) {
            const { reason, unsupported } = reasonForCeremonyError(error)
            fail(reason, unsupported ? { unsupported } : {})
          }
          return
        }
        if (token !== generation) return
        const body = { challengeId: pending.challengeId, response }
        if (pending.activationCode !== undefined) body.activationCode = pending.activationCode
        try {
          const authenticator = await api.finishRegistration(body)
          // Só aqui o cadastro está confirmado pelo servidor: tudo o que era secreto é esquecido.
          pending = null
          resumeContext = null
          send({ status: REGISTRATION_STATUS.DONE, authenticator, ...meta() })
        } catch (error) {
          if (token !== generation) return
          // O servidor consome o desafio ao verificar: expirado/recusado só recomeçando.
          if (error?.kind === 'challenge_invalid') pending = null
          fail(reasonForApiError(error))
        }
      } finally {
        busy = false
        controller = null
      }
    },

    /** Desiste: aborta a passkey, esquece desafio, PIN novo e código de ativação. */
    cancel() {
      generation += 1
      controller?.abort()
      controller = null
      forget()
      busy = false
    },

    dispose() {
      disposed = true
      generation += 1
      controller?.abort()
      forget()
    },

    activate() {
      disposed = false
    },
  }
}
