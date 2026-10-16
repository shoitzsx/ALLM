import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleX, Info, RefreshCw, X } from 'lucide-react'
import { LEVEL_META, NOTIFICATION_LEVELS, displayTitle } from './levels.js'
import { rememberFocusOrigin, shouldRestoreFocus } from './focusReturn.js'
import { useNotificationStore } from './useNotifications.js'
import './notifications.css'

const LEVEL_ICONS = {
  [NOTIFICATION_LEVELS.SUCCESS]: CheckCircle2,
  [NOTIFICATION_LEVELS.INFO]: Info,
  [NOTIFICATION_LEVELS.WARNING]: AlertTriangle,
  [NOTIFICATION_LEVELS.ERROR]: CircleX,
  [NOTIFICATION_LEVELS.PROGRESS]: RefreshCw,
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
const occurrences = (count) => plural(count, 'ocorrência', 'ocorrências')

function Toast({ item, store, hostRef, returnFocusRef }) {
  const toastRef = useRef(null)
  // Mouse em cima e foco dentro seguram a contagem; só volta a correr quando os dois saem.
  const holding = useRef({ pointer: false, focus: false })
  const meta = LEVEL_META[item.level]
  const Icon = LEVEL_ICONS[item.level]
  const title = displayTitle(item)

  const syncHold = () => {
    if (holding.current.pointer || holding.current.focus) store.pause(item.id)
    else store.resume(item.id)
  }

  const close = (viaKeyboard) => {
    // Quem fecha pelo teclado estava com o foco aqui dentro. Devolvê-lo para onde
    // estava antes evita que ele caia no <body> quando o botão sumir. Mouse e toque
    // nunca mexem no foco: devolvê-lo rolaria a página até um elemento que ficou lá atrás.
    const target = returnFocusRef.current
    const focusInsideToast = Boolean(toastRef.current?.contains(document.activeElement))
    if (shouldRestoreFocus({ viaKeyboard, focusInsideToast, target })) target.focus()
    store.dismiss(item.id)
  }

  return (
    <div
      ref={toastRef}
      className={`toast toast-${item.level}`}
      role={meta.role}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return
        holding.current.pointer = true
        syncHold()
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return
        holding.current.pointer = false
        syncHold()
      }}
      onFocus={(event) => {
        const from = event.relatedTarget
        returnFocusRef.current = rememberFocusOrigin({
          previous: returnFocusRef.current,
          from,
          insideHost: Boolean(from && hostRef.current?.contains(from)),
        })
        holding.current.focus = true
        syncHold()
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        holding.current.focus = false
        syncHold()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        // Escape aqui só fecha a notificação: não deve fechar também um modal aberto atrás.
        event.stopPropagation()
        close(true)
      }}
    >
      <span className="toast-icon" aria-hidden="true">
        <Icon size={18} className={item.level === NOTIFICATION_LEVELS.PROGRESS ? 'spin' : undefined} />
      </span>
      <div className="toast-body">
        <strong className="toast-title">
          {item.title ? <span className="toast-sr-only">{meta.label}: </span> : null}
          {title}
        </strong>
        {item.message ? <p className="toast-message">{item.message}</p> : null}
        {item.count > 1 ? <p className="toast-count">{occurrences(item.count)}</p> : null}
      </div>
      {/* detail === 0: o clique veio do teclado (Enter/Espaço) ou de tecnologia assistiva; mouse e toque trazem detail >= 1. */}
      <button type="button" className="toast-close" onClick={(event) => close(event.detail === 0)} aria-label={`Fechar notificação: ${title}`}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Quem espera uma vaga. O botão resume a fila ("Mais 3 notificações em espera (1 erro)") e
 * abre uma lista temporária: título, mensagem e um botão de fechar para cada uma. Serve para
 * consultar o que está atrás quando a tela está cheia de notificações que não somem sozinhas.
 *
 * É só uma janela para a fila de agora: não guarda nada, não tem histórico, e some sozinha
 * quando a fila esvazia. A região role="status" existe sempre, vazia: o leitor de tela anuncia
 * o texto quando ele aparece ou muda (uma região inserida já com texto nem sempre é anunciada).
 *
 * Teclado: o botão e a lista vêm logo depois dos cartões (DOM = tela = Tab); Escape fecha a
 * lista e devolve o foco ao botão. Fechar um item pelo teclado nunca deixa o foco cair no <body>.
 */
function QueueNotice({ queued, store, hostRef, returnFocusRef }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const regionRef = useRef(null)
  const listId = useId()
  const errors = queued.filter((item) => item.level === NOTIFICATION_LEVELS.ERROR).length
  const summary = `Mais ${plural(queued.length, 'notificação', 'notificações')} em espera${errors > 0 ? ` (${plural(errors, 'erro', 'erros')})` : ''}`
  const expanded = open && queued.length > 0

  // Fila vazia: a lista não tem mais o que mostrar, e a próxima fila começa fechada.
  useEffect(() => {
    if (queued.length === 0) setOpen(false)
  }, [queued.length])

  const closeItem = (item, viaKeyboard) => {
    const focusInside = Boolean(regionRef.current?.contains(document.activeElement))
    if (viaKeyboard && focusInside) {
      // O botão de fechar que tinha o foco vai sumir. Com mais gente na fila, o foco fica no botão
      // da fila; se era o último item, volta para onde estava antes (ou, sem origem, para o primeiro cartão).
      const target = queued.length > 1 ? buttonRef.current : returnFocusRef.current
      const fallback = hostRef.current?.querySelector('.toast-close')
      if (shouldRestoreFocus({ viaKeyboard, focusInsideToast: true, target })) target.focus()
      else if (queued.length <= 1) fallback?.focus()
    }
    store.dismiss(item.id)
  }

  return (
    <div
      className="toast-queue"
      ref={regionRef}
      onFocus={(event) => {
        const from = event.relatedTarget
        returnFocusRef.current = rememberFocusOrigin({
          previous: returnFocusRef.current,
          from,
          insideHost: Boolean(from && hostRef.current?.contains(from)),
        })
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded) return
        // Escape aqui só fecha a lista: não deve fechar também um modal aberto atrás.
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }}
    >
      <p role="status" className="toast-sr-only">
        {queued.length > 0 ? `${summary}.` : ''}
      </p>
      {queued.length > 0 ? (
        <button
          type="button"
          ref={buttonRef}
          className={`toast-queue-pill${errors > 0 ? ' toast-queue-pill-error' : ''}`}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{summary}</span>
          {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      ) : null}
      {expanded ? (
        <ul id={listId} className="toast-queue-list" aria-label="Notificações em espera">
          {queued.map((item) => {
            const title = displayTitle(item)
            return (
              <li key={item.id} className={`toast-queue-item toast-queue-item-${item.level}`}>
                <div className="toast-queue-text">
                  <strong className="toast-queue-title">
                    {item.title ? <span className="toast-sr-only">{LEVEL_META[item.level].label}: </span> : null}
                    {title}
                  </strong>
                  {item.message ? <p className="toast-queue-message">{item.message}</p> : null}
                  {item.count > 1 ? <p className="toast-queue-count">{occurrences(item.count)}</p> : null}
                </div>
                <button type="button" className="toast-queue-close" onClick={(event) => closeItem(item, event.detail === 0)} aria-label={`Fechar notificação em espera: ${title}`}>
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Área de exibição das notificações. O contêiner fica sempre montado (vazio
 * ele não ocupa espaço nem captura clique); cada notificação anuncia a si
 * mesma pelo próprio papel ARIA: `alert` para erro, `status` para o resto.
 *
 * A ordem dos cartões vem pronta da store (erros, avisos, o resto): aqui nada é
 * reordenado nem depende de CSS, então a ordem do DOM é a da tela e a do teclado.
 */
export function NotificationViewport() {
  const store = useNotificationStore()
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const queued = useSyncExternalStore(store.subscribe, store.getQueued, store.getQueued)
  const hostRef = useRef(null)
  const returnFocusRef = useRef(null)

  return (
    <div className={`toast-host${queued.length > 0 ? ' toast-host-queued' : ''}`} ref={hostRef}>
      <div className="toast-stack">
        {items.map((item) => (
          <Toast key={item.id} item={item} store={store} hostRef={hostRef} returnFocusRef={returnFocusRef} />
        ))}
      </div>
      <QueueNotice queued={queued} store={store} hostRef={hostRef} returnFocusRef={returnFocusRef} />
    </div>
  )
}
