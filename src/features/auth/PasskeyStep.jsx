import React, { useEffect, useRef } from 'react'
import { AlertTriangle, Fingerprint, Info, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react'
import { AUTH_STATUS } from './authStates.js'
import { getStepCopy } from './authErrors.js'

const ICONS = {
  [AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR]: Fingerprint,
  [AUTH_STATUS.CONFIRMACAO_INTERROMPIDA]: AlertTriangle,
  [AUTH_STATUS.PASSKEY_NAO_CADASTRADA]: Info,
  [AUTH_STATUS.DISPOSITIVO_INCOMPATIVEL]: ShieldAlert,
  [AUTH_STATUS.ERRO_CONEXAO]: WifiOff,
  [AUTH_STATUS.ERRO_SEGUNDO_FATOR]: AlertTriangle,
}
const CAN_RETRY = new Set([
  AUTH_STATUS.CONFIRMACAO_INTERROMPIDA,
  AUTH_STATUS.ERRO_SEGUNDO_FATOR,
  AUTH_STATUS.ERRO_CONEXAO,
])

/**
 * Passo do segundo fator (passkey) — SÓ apresentação.
 *
 * Não chama `navigator.credentials`, não fala com servidor e não decide nada:
 * mostra o estado que recebe e avisa `onStart` (abrir a passkey, num toque do
 * usuário), `onRetry` e `onBack`. Quem executa a cerimônia é o fluxo de login
 * (loginFlow.js); sem `onStart` (pré-visualização) não há botão que a dispare. Também não há botão de cadastro:
 * passkey só se cadastra por um fluxo autorizado (fora desta etapa).
 */
export function PasskeyStep({ state, preview = false, onStart, busy, onRetry, onBack }) {
  const copy = getStepCopy(state)
  const headingRef = useRef(null)

  // O foco vai para o título a cada mudança de passo: quem usa leitor de tela
  // ou teclado percebe que a tela mudou, em vez de ficar num botão que sumiu.
  useEffect(() => {
    headingRef.current?.focus()
  }, [state?.status])

  if (!copy) return null
  const Icon = ICONS[state.status] || Info
  const waiting = state.status === AUTH_STATUS.AGUARDANDO_SEGUNDO_FATOR

  return (
    <div className="auth-card auth-step" aria-busy={waiting && busy !== false}>
      {preview ? (
        <p className="auth-preview-badge">Pré-visualização demonstrativa: não concede acesso.</p>
      ) : null}
      <header className="auth-card-header">
        <p className="auth-step-label">Segundo fator · passkey</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {copy.title}
        </h1>
      </header>

      <div
        className={`auth-alert auth-alert-${copy.tone}${waiting ? ' auth-alert-waiting' : ''}`}
        role={copy.tone === 'error' ? 'alert' : 'status'}
      >
        <Icon size={18} aria-hidden="true" className={waiting ? 'auth-pulse' : undefined} />
        <div>
          <span>{copy.description}</span>
        </div>
      </div>

      <div className="auth-step-actions">
        {waiting && onStart ? (
          // A passkey só abre dentro de um toque do usuário (o Safari exige o gesto):
          // por isso o botão, em vez de abrir sozinha depois da resposta do servidor.
          <button type="button" className="btn btn-primary btn-lg auth-passkey-start" onClick={onStart} disabled={Boolean(busy)}>
            {busy ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : <Fingerprint size={16} aria-hidden="true" />}
            {busy ? 'Aguardando o dispositivo…' : 'Usar a passkey'}
          </button>
        ) : null}
        {CAN_RETRY.has(state.status) ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" />
            Tentar novamente
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary btn-lg" onClick={onBack}>
          {waiting ? 'Cancelar' : 'Voltar'}
        </button>
      </div>
    </div>
  )
}
