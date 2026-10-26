import React from 'react'
import './auth.css'

/**
 * Moldura das telas públicas de acesso (login e ativação de passkey): painel da
 * marca à esquerda e o cartão do formulário à direita. Só apresentação.
 */
export function AuthLayout({ envNote, children }) {
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
        {envNote ? <span className="auth-env-note">{envNote}</span> : null}
      </div>

      <div className="auth-form-panel">{children}</div>
    </div>
  )
}
