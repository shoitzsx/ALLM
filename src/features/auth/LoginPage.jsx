import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Clock, Eye, EyeOff, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react'
import { useHashRoute } from '../../layout/navigation.js'
import './auth.css'

/**
 * Estados de erro só para pré-visualização visual, em desenvolvimento —
 * `?state=invalid|inactive|expired|network|loading` na URL
 * (`#/login?state=invalid`, `#/login?state=loading` fixa o estado de
 * carregamento em vez de só mostrá-lo por 900ms). `import.meta.env.DEV`
 * garante que isto não existe em produção: fora do `npm run dev`, o
 * parâmetro é ignorado e a tela sempre abre neutra. Nenhum destes estados
 * envolve autenticação real — são só textos/ícones fixos para revisar o
 * visual de cada caso antes de o backend existir.
 */
const PREVIEW_ALERTS = {
  invalid: {
    tone: 'error',
    Icon: AlertTriangle,
    title: 'Matrícula ou PIN inválidos.',
    description: 'Verifique os dados e tente novamente.',
    // Único estado onde o erro é, de fato, sobre o conteúdo dos campos —
    // por isso é o único que move o foco para o formulário em vez do alerta.
    fieldLevel: true,
  },
  inactive: {
    tone: 'warning',
    Icon: ShieldAlert,
    title: 'Seu acesso está inativo.',
    description: 'Procure um responsável pelo ALM.',
  },
  expired: {
    tone: 'info',
    Icon: Clock,
    title: 'Sua sessão expirou.',
    description: 'Entre novamente para continuar.',
  },
  network: {
    tone: 'error',
    Icon: WifiOff,
    title: 'Não foi possível conectar ao ALM.',
    description: 'Verifique sua conexão e tente novamente.',
  },
}

/**
 * Tela de login — só UI/UX nesta etapa. Não autentica ninguém: o submit
 * nunca chama a API, nunca grava em localStorage/sessionStorage e nunca usa
 * DEMO_USERS/DEMO_CURRENT_USER. Um clique real em "Entrar" só mostra
 * brevemente o estado de carregamento e volta ao normal — prova a UI sem
 * fingir uma sessão. Os demais estados (inválido/inativo/expirado/erro de
 * conexão) só aparecem via o parâmetro de pré-visualização acima.
 */
export function LoginPage() {
  const route = useHashRoute()
  const previewKey = route.query.get('state')

  const matriculaRef = useRef(null)
  const alertRef = useRef(null)
  const [matricula, setMatricula] = useState('')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)

  const previewLoading = import.meta.env.DEV && previewKey === 'loading'
  const previewAlert = import.meta.env.DEV ? PREVIEW_ALERTS[previewKey] : undefined
  const isLoading = submitLoading || previewLoading
  const isFieldError = Boolean(previewAlert?.fieldLevel)

  useEffect(() => {
    matriculaRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!previewAlert) return
    // role="alert" já anuncia a mensagem via live region, foco não é
    // necessário para isso. Só movemos o foco quando há algo acionável: erro
    // de credenciais manda o usuário de volta para o campo a corrigir; os
    // demais (sessão/inatividade/rede) não são sobre um campo específico, e
    // inventar uma "correção" neles seria enganoso — então o foco vai para o
    // próprio alerta, só para garantir que ele é alcançável via teclado.
    if (isFieldError) {
      matriculaRef.current?.focus()
    } else {
      alertRef.current?.focus()
    }
  }, [previewAlert, isFieldError])

  function handleSubmit(event) {
    event.preventDefault()
    if (isLoading) return
    // Nenhuma autenticação real nesta etapa — só prova o estado visual de
    // carregamento e volta ao normal em seguida.
    setSubmitLoading(true)
    window.setTimeout(() => setSubmitLoading(false), 900)
  }

  return (
    <div className="auth-page">
      <div className="auth-brand-panel">
        <div className="auth-brand-mark">
          <img src="/brand/logo-mark.png" alt="" width={40} height={40} />
          <span className="auth-brand-mark-copy">
            <strong>ALM</strong>
            <span>Gestão de chegadas e recebimentos</span>
          </span>
        </div>
        <p className="auth-brand-copy">
          Um único acesso para acompanhar chegadas, conferências e recebimentos de materiais.
        </p>
        <span className="auth-env-note">
          Ambiente de validação — esta tela ainda não envia nenhum dado de login.
        </span>
      </div>

      <div className="auth-form-panel">
        <form className="auth-card" onSubmit={handleSubmit} aria-busy={isLoading}>
          <header className="auth-card-header">
            <h1>Entrar</h1>
            <p>Use sua matrícula e PIN para acessar o ALM.</p>
          </header>

          {previewAlert ? (
            <div
              id="login-alert"
              className={`auth-alert auth-alert-${previewAlert.tone}`}
              role="alert"
              ref={alertRef}
              tabIndex={-1}
            >
              <previewAlert.Icon size={18} aria-hidden="true" />
              <div>
                <strong>{previewAlert.title}</strong>
                <span>{previewAlert.description}</span>
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="login-matricula">Matrícula</label>
            <input
              id="login-matricula"
              name="matricula"
              type="text"
              autoComplete="username"
              ref={matriculaRef}
              value={matricula}
              onChange={(event) => setMatricula(event.target.value)}
              disabled={isLoading}
              aria-invalid={isFieldError || undefined}
              aria-describedby={isFieldError ? 'login-alert' : undefined}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="login-pin">PIN</label>
            <div className="auth-pin-field">
              <input
                id="login-pin"
                name="pin"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                disabled={isLoading}
                aria-invalid={isFieldError || undefined}
                aria-describedby={isFieldError ? 'login-alert' : undefined}
                required
              />
              <button
                type="button"
                className="auth-pin-toggle"
                onClick={() => setShowPin((current) => !current)}
                aria-label={showPin ? 'Ocultar PIN' : 'Mostrar PIN'}
                aria-pressed={showPin}
                disabled={isLoading}
              >
                {showPin ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={isLoading}>
            {isLoading ? <RefreshCw size={16} className="spin" /> : null}
            {isLoading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
