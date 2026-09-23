import React from 'react'
import { Bell, Search } from 'lucide-react'
import { ThemeToggle } from '../theme.jsx'
import { ROUTES, navigate } from './navigation.js'

export function MobileHeader({ theme, onToggleTheme }) {
  return (
    <header className="mobile-topbar">
      <button className="mobile-brand" type="button" onClick={() => navigate('/')}>
        <img className="brand-mark" src="/brand/logo-mark.png" alt="Águia Sistemas" />
        <strong>Recebimentos</strong>
      </button>
      <div className="mobile-top-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} compact />
        <button className="icon-button" type="button" onClick={() => navigate(`${ROUTES.receipts}?focus=search`)} aria-label="Buscar">
          <Search size={19} />
        </button>
        <button className="icon-button notification-button" type="button" onClick={() => navigate(ROUTES.pending)} aria-label="Pendências">
          <Bell size={19} />
        </button>
      </div>
    </header>
  )
}
