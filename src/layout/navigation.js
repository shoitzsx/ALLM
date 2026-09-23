import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, LayoutDashboard, Plus, ScanBarcode } from 'lucide-react'

export const ROUTES = {
  dashboard: '/',
  receipts: '/recebimentos',
  newReceipt: '/novo',
  pending: '/pendencias',
  nfeReader: '/leitura-automatica',
}

export const NAV_ITEMS = [
  { path: ROUTES.dashboard, label: 'Visão geral', icon: LayoutDashboard },
  { path: ROUTES.receipts, label: 'Recebimentos', icon: ClipboardList },
  { path: ROUTES.newReceipt, label: 'Novo recebimento', icon: Plus },
  { path: ROUTES.pending, label: 'Pendências', icon: AlertTriangle, count: true },
  { path: ROUTES.nfeReader, label: 'Leitura automática (beta)', icon: ScanBarcode },
]

export function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, queryString = ''] = raw.split('?')
  return { path: path || '/', query: new URLSearchParams(queryString) }
}

export function useHashRoute() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash())
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return route
}

export function navigate(path) {
  const next = path.startsWith('#') ? path : `#${path}`
  if (window.location.hash === next) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  window.location.hash = next
}

export function isRouteActive(route, path) {
  if (path === ROUTES.dashboard) return route.path === '/'
  if (path === ROUTES.receipts) return route.path.startsWith('/recebimentos')
  return route.path === path
}
