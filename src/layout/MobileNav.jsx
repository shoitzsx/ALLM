import React, { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeftRight, MoreHorizontal, X } from 'lucide-react'
import { AREA_CONFIG, getMobileNavItems, isRouteActive, navigate } from './navigation.js'

// Até 4 destinos da área ficam fixos na barra; o resto (e a troca de área)
// vai para "Mais" — ver getMobileNavItems em navigation.js.
export function MobileNav({ area, route, pendingCount }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef(null)
  const panelId = useId()

  const config = AREA_CONFIG[area]
  const other = AREA_CONFIG[config.switchTo]
  const { primary: primaryItems, more: moreItems } = getMobileNavItems(area)
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

  // Qualquer troca de rota (inclusive pelos outros botões, ou voltar pelo
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

      <nav
        className="mobile-nav"
        data-area={area}
        aria-label={config.navLabel}
        style={{ '--mobile-nav-columns': primaryItems.length + 1 }}
      >
        {primaryItems.map((item) => {
          const Icon = item.icon
          const active = isRouteActive(route, item.path)
          return (
            <button
              className={`mobile-nav-button ${item.primaryAction ? 'primary' : ''} ${active ? 'active' : ''}`}
              key={item.path}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => goTo(item.path)}
            >
              <Icon size={20} />
              <span>{item.mobileLabel || item.label}</span>
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
            <strong>{config.label}</strong>
            <button type="button" className="mobile-more-close" onClick={() => setMoreOpen(false)} aria-label="Fechar menu Mais">
              <X size={16} />
            </button>
          </div>
          {moreItems.map((item) => {
            const Icon = item.icon
            const active = isRouteActive(route, item.path)
            return (
              <button
                className={`mobile-more-item ${active ? 'active' : ''}`}
                key={item.path}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => goTo(item.path)}
              >
                <Icon size={18} />
                {item.label}
                {item.beta ? <span className="nav-beta">beta</span> : null}
              </button>
            )
          })}
          <button className="mobile-more-item mobile-more-switch" type="button" onClick={() => goTo(other.home)}>
            <ArrowLeftRight size={18} />
            <span className="area-switch-copy">
              <strong>Ir para {other.label}</strong>
              <span>Troca livre no ambiente de validação</span>
            </span>
          </button>
        </div>
      ) : null}
    </>
  )
}
