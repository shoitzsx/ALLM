import React from 'react'
import { Bell, Search } from 'lucide-react'
import { ThemeToggle } from '../theme.jsx'
import { AREAS, AREA_CONFIG, ROUTES, navigate } from './navigation.js'

export function MobileHeader({ area, theme, onToggleTheme }) {
  const config = AREA_CONFIG[area]
  return (
    <header className="mobile-topbar" data-area={area}>
      <button className="mobile-brand" type="button" onClick={() => navigate(config.home)}>
        <img className="brand-mark" src="/brand/logo-mark.png" alt="Águia Sistemas" />
        <span className="mobile-brand-copy">
          <strong>{config.product}</strong>
          {area === AREAS.portaria ? <span>Registros simulados</span> : null}
        </span>
      </button>
      <div className="mobile-top-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} compact />
        {/* Busca e Pendências são do Almoxarifado — na Portaria levariam para fora da área. */}
        {area === AREAS.almoxarifado ? (
          <>
            <button className="icon-button" type="button" onClick={() => navigate(`${ROUTES.receipts}?focus=search`)} aria-label="Buscar">
              <Search size={19} />
            </button>
            <button className="icon-button notification-button" type="button" onClick={() => navigate(ROUTES.pending)} aria-label="Pendências">
              <Bell size={19} />
            </button>
          </>
        ) : null}
      </div>
    </header>
  )
}
