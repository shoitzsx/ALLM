import React, { useEffect } from 'react'
import { LogOut, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react'
import { AuthLayout } from './AuthLayout.jsx'
import { useAuth } from './AuthProvider.jsx'
import { ACCESS, decideAccess } from './accessDecision.js'
import './auth.css'

function GateCard({ icon: Icon, title, description, urgent = false, children }) {
  return (
    <AuthLayout envNote="Ambiente de validação">
      <div className="auth-card auth-step" role={urgent ? 'alert' : 'status'} aria-live={urgent ? 'assertive' : 'polite'}>
        <header className="auth-card-header">
          <h1>{title}</h1>
        </header>
        <div className="auth-alert auth-alert-info">
          {Icon ? <Icon size={18} aria-hidden="true" /> : null}
          <div><span>{description}</span></div>
        </div>
        {children ? <div className="auth-step-actions">{children}</div> : null}
      </div>
    </AuthLayout>
  )
}

function Redirect({ to, onRedirect }) {
  useEffect(() => { onRedirect(to) }, [to, onRedirect])
  return null
}

/**
 * Porteiro das rotas. Decide o que aparece SEMPRE a partir da sessão que o
 * servidor confirmou (`useAuth()` → `decideAccess`) e nunca monta o app
 * autenticado sem ela:
 *
 * - verificando a sessão → aguarde (nada do app aparece);
 * - servidor indisponível → aviso e "tentar de novo" (sem acesso);
 * - sem sessão → login, guardando o destino (`returnTo` sanitizado);
 * - com sessão → o app, se as PERMISSÕES do servidor liberam a rota; senão a
 *   página inicial permitida ou "sem acesso";
 * - `/login` com sessão válida → entra no destino de retorno.
 *
 * Esta é a camada de apresentação; o backend recusa de verdade (401/403) cada chamada.
 *
 * @param {object} props
 * @param {{ path: string, query: URLSearchParams }} props.route
 * @param {(user: object) => React.ReactNode} props.renderApp  só chamado com usuário autenticado e autorizado
 * @param {() => React.ReactNode} props.renderLogin
 * @param {() => React.ReactNode} props.renderActivate
 * @param {(path: string) => void} props.onRedirect  troca a rota SEM empilhar histórico
 */
export function AccessGate({ route, renderApp, renderLogin, renderActivate, onRedirect }) {
  const { status, user, reason, retryCheck, signOut } = useAuth()
  const decision = decideAccess({ status, user, route, reason })

  switch (decision.action) {
    case ACCESS.ACTIVATE:
      return renderActivate()
    case ACCESS.LOGIN:
      return renderLogin()
    case ACCESS.APP:
      return renderApp(user)
    case ACCESS.REDIRECT:
      return <Redirect to={decision.to} onRedirect={onRedirect} />
    case ACCESS.UNAVAILABLE:
      return (
        <GateCard icon={WifiOff} urgent title="Não foi possível verificar sua sessão." description="O ALM não respondeu. Verifique sua conexão e tente novamente.">
          <button className="btn btn-primary btn-lg" type="button" onClick={() => void retryCheck()}>
            <RefreshCw size={16} aria-hidden="true" /> Tentar novamente
          </button>
        </GateCard>
      )
    case ACCESS.DENIED:
      return (
        <GateCard icon={ShieldAlert} urgent title="Sem acesso a nenhuma área." description="Sua conta ainda não tem permissão para usar o ALM. Procure um responsável.">
          <button className="btn btn-secondary btn-lg" type="button" onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden="true" /> Sair
          </button>
        </GateCard>
      )
    case ACCESS.LOADING:
    default:
      return <GateCard icon={RefreshCw} title="Verificando sua sessão…" description="Aguarde um instante." />
  }
}
