import React from 'react'
import { NAV_ITEMS, ROUTES, isRouteActive, navigate } from './navigation.js'

export function MobileNav({ route, pendingCount }) {
  return (
    <nav className="mobile-nav" aria-label="Navegação mobile">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <button
            className={`mobile-nav-button ${item.path === ROUTES.newReceipt ? 'primary' : ''} ${isRouteActive(route, item.path) ? 'active' : ''}`}
            key={item.path}
            type="button"
            onClick={() => navigate(item.path)}
          >
            <Icon size={20} />
            <span>
              {item.path === ROUTES.newReceipt
                ? 'Novo'
                : item.path === ROUTES.nfeReader
                  ? 'Leitura NF-e'
                  : item.label.replace('Visão geral', 'Início')}
            </span>
            {item.count && pendingCount ? <span className="nav-count">{pendingCount}</span> : null}
          </button>
        )
      })}
    </nav>
  )
}
