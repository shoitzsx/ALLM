import React from 'react'
import { ArrowLeftRight, CircleDashed } from 'lucide-react'
import { Avatar } from '../ui.jsx'
import { AREA_CONFIG, getNavItems, isRouteActive, navigate } from './navigation.js'

function NavButton({ item, route, pendingCount }) {
  const Icon = item.icon
  const active = isRouteActive(route, item.path)
  return (
    <button
      className={`nav-item ${active ? 'active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => navigate(item.path)}
    >
      <Icon size={18} strokeWidth={2} />
      <span>{item.label}</span>
      {item.count && pendingCount ? <span className="nav-count">{pendingCount}</span> : null}
    </button>
  )
}

export function Sidebar({ area, route, pendingCount, currentUser }) {
  const config = AREA_CONFIG[area]
  const other = AREA_CONFIG[config.switchTo]
  const items = getNavItems(area)
  const mainItems = items.filter((item) => !item.beta)
  const betaItems = items.filter((item) => item.beta)

  return (
    <aside className="sidebar" data-area={area} aria-label="Navegação principal">
      <button className="brand" type="button" onClick={() => navigate(config.home)} aria-label={`Ir para o início de ${config.label}`}>
        <img className="brand-mark" src="/brand/logo-mark.png" alt="Águia Sistemas" />
        <span className="brand-copy">
          <strong>{config.product}</strong>
          <span>{config.subtitle}</span>
        </span>
      </button>

      <nav className="sidebar-nav-group" aria-label={config.navLabel}>
        <div className="sidebar-context">{config.label}</div>
        <div className="sidebar-nav">
          {mainItems.map((item) => <NavButton key={item.path} item={item} route={route} pendingCount={pendingCount} />)}
        </div>
        {betaItems.length ? (
          <>
            <div className="sidebar-context sidebar-context-minor">Em teste</div>
            <div className="sidebar-nav">
              {betaItems.map((item) => <NavButton key={item.path} item={item} route={route} pendingCount={pendingCount} />)}
            </div>
          </>
        ) : null}
      </nav>

      <div className="sidebar-bottom">
        <button className="area-switch" type="button" onClick={() => navigate(other.home)}>
          <ArrowLeftRight size={16} />
          <span className="area-switch-copy">
            <strong>Ir para {other.label}</strong>
            <span>Troca livre no ambiente de validação</span>
          </span>
        </button>
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
