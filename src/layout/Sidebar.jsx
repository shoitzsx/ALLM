import React from 'react'
import { CircleDashed } from 'lucide-react'
import { Avatar } from '../ui.jsx'
import { NAV_ITEMS, isRouteActive, navigate } from './navigation.js'

export function Sidebar({ route, pendingCount, currentUser }) {
  return (
    <aside className="sidebar" aria-label="Navegação principal">
      <button className="brand" type="button" onClick={() => navigate('/')} aria-label="Ir para visão geral">
        <img className="brand-mark" src="/brand/logo-mark.png" alt="Águia Sistemas" />
        <span className="brand-copy">
          <strong>Recebimentos</strong>
          <span>Almoxarifado</span>
        </span>
      </button>

      <div className="sidebar-context">Operação</div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`nav-item ${isRouteActive(route, item.path) ? 'active' : ''}`}
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
            >
              <Icon size={18} strokeWidth={2} />
              <span>{item.label}</span>
              {item.count && pendingCount ? <span className="nav-count">{pendingCount}</span> : null}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <Avatar name={currentUser?.nome || currentUser?.name} />
          <span className="sidebar-user-copy">
            <strong>{currentUser?.nome || currentUser?.name}</strong>
            <span>{currentUser?.perfil || currentUser?.role}</span>
          </span>
        </div>
        <span
          className="env-badge"
          title="Os dados ficam somente nesta sessão do navegador e são perdidos ao atualizar a página."
        >
          <CircleDashed size={11} /> Ambiente de validação
        </span>
      </div>
    </aside>
  )
}
