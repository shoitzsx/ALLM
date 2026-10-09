import React, { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import { NAV_ITEMS, ROUTES, isRouteActive, navigate } from './navigation.js'

// Só os 5 destinos principais ficam fixos na barra — qualquer item NOVO que
// vier a existir em NAV_ITEMS (além destes 4) cai automaticamente dentro de
// "Mais", em vez de forçar outra coluna na barra (o problema original do
// repeat(7): não escalava). Essa escolha é só do MobileNav — a Sidebar
// (desktop) continua usando NAV_ITEMS inteiro, sem nenhuma mudança.
const PRIMARY_PATHS = [ROUTES.dashboard, ROUTES.receipts, ROUTES.newReceipt, ROUTES.pending]

function mobileLabel(item) {
  if (item.path === ROUTES.newReceipt) return 'Novo'
  if (item.path === ROUTES.nfeReader) return 'Leitura automática'
  return item.label.replace('Visão geral', 'Início')
}

export function MobileNav({ route, pendingCount }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef(null)
  const panelId = useId()

  const primaryItems = NAV_ITEMS.filter((item) => PRIMARY_PATHS.includes(item.path))
  const moreItems = NAV_ITEMS.filter((item) => !PRIMARY_PATHS.includes(item.path))
  const moreActive = moreItems.some((item) => isRouteActive(route, item.path))

  // Fecha com Escape e devolve o foco ao botão "Mais" — do contrário o foco
  // ficaria "perdido" num painel que acabou de desaparecer.
  useEffect(() => {
    if (!moreOpen) return
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setMoreOpen(false)
        moreButtonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

  // Qualquer troca de rota (inclusive pelos outros 4 botões, ou voltar pelo
  // navegador) também fecha o painel, mesmo sem passar por goTo().
  useEffect(() => {
    setMoreOpen(false)
  }, [route.path])

  function goTo(path) {
    setMoreOpen(false)
    navigate(path)
  }

  return (
    <>
      {moreOpen ? (
        <button type="button" className="mobile-more-backdrop" aria-label="Fechar menu Mais" onClick={() => setMoreOpen(false)} />
      ) : null}

      <nav className="mobile-nav" aria-label="Navegação mobile">
        {primaryItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`mobile-nav-button ${item.path === ROUTES.newReceipt ? 'primary' : ''} ${isRouteActive(route, item.path) ? 'active' : ''}`}
              key={item.path}
              type="button"
              onClick={() => goTo(item.path)}
            >
              <Icon size={20} />
              <span>{mobileLabel(item)}</span>
              {item.count && pendingCount ? <span className="nav-count">{pendingCount}</span> : null}
            </button>
          )
        })}

        <button
          className={`mobile-nav-button ${moreActive ? 'active' : ''}`}
          type="button"
          ref={moreButtonRef}
          aria-expanded={moreOpen}
          aria-controls={panelId}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal size={20} />
          <span>Mais</span>
        </button>
      </nav>

      {moreOpen ? (
        <div id={panelId} className="mobile-more-panel" aria-label="Mais opções de navegação">
          <div className="mobile-more-header">
            <strong>Mais opções</strong>
            <button type="button" className="mobile-more-close" onClick={() => setMoreOpen(false)} aria-label="Fechar menu Mais">
              <X size={16} />
            </button>
          </div>
          {moreItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={`mobile-more-item ${isRouteActive(route, item.path) ? 'active' : ''}`}
                key={item.path}
                type="button"
                onClick={() => goTo(item.path)}
              >
                <Icon size={18} />
                {mobileLabel(item)}
              </button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
