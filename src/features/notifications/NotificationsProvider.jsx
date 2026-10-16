import React, { useEffect, useMemo, useState } from 'react'
import { NotificationsContext } from './NotificationsContext.js'
import { DEFAULT_MAX_VISIBLE, createNotificationStore } from './notificationStore.js'
import { createNotificationApi } from './notificationApi.js'
import { NotificationViewport } from './NotificationViewport.jsx'

/** Celular baixo: largura de celular e até 700px de altura. Mantenha igual ao bloco compacto de notifications.css. */
const COMPACT_QUERY = '(max-width: 920px) and (max-height: 700px)'
const COMPACT_MAX_VISIBLE = 2

/**
 * Fica na raiz do App (src/App.jsx), acima de qualquer rota — inclusive
 * `#/login`, que não monta o app autenticado. Assim todas as telas usam a
 * mesma store e a mesma área de exibição, e as notificações sobrevivem à
 * troca de rota.
 *
 * `durations` (ms por nível, `null` = não fecha sozinha) e `maxVisible` só são
 * lidos uma vez, na criação da store.
 */
export function NotificationsProvider({ children, durations, maxVisible }) {
  const [store] = useState(() => createNotificationStore({ durations, maxVisible }))
  const api = useMemo(() => createNotificationApi(store), [store])
  const value = useMemo(() => ({ store, api }), [store, api])

  // Ao desmontar, cancela todo timer pendente. No StrictMode (dev) este efeito
  // roda um ciclo montar→desmontar→montar logo na abertura, quando a store
  // ainda está vazia: o clear() é inofensivo e a store continua utilizável.
  useEffect(() => () => store.clear(), [store])

  // Celular baixo: apresentação compacta. Menos cartões na tela (o resto espera na fila, com o botão-resumo)
  // para o conjunto não cobrir o formulário. O limite de altura é o mesmo do bloco compacto de notifications.css.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(COMPACT_QUERY)
    const normal = Number.isInteger(maxVisible) && maxVisible > 0 ? maxVisible : DEFAULT_MAX_VISIBLE
    const sync = () => store.setMaxVisible(query.matches ? Math.min(normal, COMPACT_MAX_VISIBLE) : normal)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [store, maxVisible])

  // Aba em segundo plano: os relógios param e guardam o tempo que faltava, para nenhuma
  // notificação expirar sem que alguém tenha podido vê-la. Volta a correr quando a aba reaparece.
  useEffect(() => {
    const sync = () => store.setPageVisible(document.visibilityState !== 'hidden')
    sync() // a página pode ter sido aberta já em segundo plano
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [store])

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <NotificationViewport />
    </NotificationsContext.Provider>
  )
}
