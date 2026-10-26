import React, { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Fingerprint, LogOut } from 'lucide-react'
import { Avatar } from '../../ui.jsx'
import './auth.css'

/**
 * Menu da conta no topo do app: nome e perfil de quem a SESSÃO do servidor
 * identificou, "Meus dispositivos" e "Sair". Só apresentação: quem encerra a
 * sessão é o chamador (`onSignOut`). Fecha com Escape ou clique fora, e devolve o
 * foco ao botão.
 */
export function UserMenu({ user, onDevices, onSignOut, signingOut = false }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const rootRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function onPointerDown(event) {
      if (!event.composedPath().includes(rootRef.current)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const name = user?.nome || user?.name
  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        className="topbar-user"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar name={name} />
        <span className="topbar-user-copy">
          <strong>{name}</strong>
          <span>{user?.perfil || user?.role}</span>
        </span>
        <ChevronDown size={14} className="icon-muted" />
      </button>
      {open ? (
        <div className="user-menu-panel" id={menuId} role="menu" aria-label="Menu da conta">
          <button className="user-menu-item" type="button" role="menuitem" onClick={() => { setOpen(false); onDevices?.() }}>
            <Fingerprint size={16} aria-hidden="true" /> Meus dispositivos
          </button>
          <button className="user-menu-item" type="button" role="menuitem" disabled={signingOut} onClick={() => { setOpen(false); onSignOut?.() }}>
            <LogOut size={16} aria-hidden="true" /> {signingOut ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
