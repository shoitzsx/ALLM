import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, DoorOpen, LayoutDashboard, Plus, ScanBarcode, ScanLine, TableProperties } from 'lucide-react'

export const ROUTES = {
  dashboard: '/',
  receipts: '/recebimentos',
  newReceipt: '/novo',
  pending: '/pendencias',
  nfeReader: '/leitura-automatica',
  portaria: '/portaria',
  // Mesma PortariaPage, já na etapa do scanner (antes só um estado interno,
  // sem endereço — e o botão "Nova chegada" some no celular).
  portariaRegistrar: '/portaria/registrar',
  visualizacao: '/visualizacao',
  // Rota de preview/dev para a tela de login (ver src/features/auth/).
  // Deliberadamente fora dos menus — não faz parte da navegação real
  // ainda, só é acessada digitando #/login na URL.
  login: '/login',
}

// Duas áreas operacionais sobre o MESMO shell (Sidebar/MobileNav/MobileHeader):
// a área vem da rota, e cada componente de layout lê daqui os itens da área.
// Trocar de área é só navegar — não há sessão nem permissão por trás disso
// (autenticação real é do Goran/Kobner; ver src/features/auth/).
export const AREAS = { almoxarifado: 'almoxarifado', portaria: 'portaria' }

// `primaryAction`: ação principal da área, destacada na barra inferior.
// `beta`: módulo em teste, listado à parte no menu lateral.
const ALMOXARIFADO_ITEMS = [
  { path: ROUTES.dashboard, label: 'Visão geral', mobileLabel: 'Início', icon: LayoutDashboard },
  { path: ROUTES.receipts, label: 'Recebimentos', icon: ClipboardList },
  { path: ROUTES.newReceipt, label: 'Novo recebimento', mobileLabel: 'Novo', icon: Plus, primaryAction: true },
  { path: ROUTES.pending, label: 'Pendências', icon: AlertTriangle, count: true },
  { path: ROUTES.visualizacao, label: 'Visualização', icon: TableProperties },
  { path: ROUTES.nfeReader, label: 'Leitura automática', icon: ScanBarcode, beta: true },
]

const PORTARIA_ITEMS = [
  { path: ROUTES.portaria, label: 'Painel do dia', mobileLabel: 'Painel', icon: DoorOpen },
  { path: ROUTES.portariaRegistrar, label: 'Registrar chegada', mobileLabel: 'Registrar', icon: ScanLine, primaryAction: true },
]

export const AREA_CONFIG = {
  [AREAS.almoxarifado]: {
    id: AREAS.almoxarifado,
    label: 'Almoxarifado',
    product: 'Recebimentos',
    subtitle: 'Almoxarifado',
    navLabel: 'Menu do Almoxarifado',
    home: ROUTES.dashboard,
    switchTo: AREAS.portaria,
    items: ALMOXARIFADO_ITEMS,
    mobilePrimary: [ROUTES.dashboard, ROUTES.receipts, ROUTES.newReceipt, ROUTES.pending],
  },
  [AREAS.portaria]: {
    id: AREAS.portaria,
    label: 'Portaria',
    product: 'Portaria',
    subtitle: 'Controle de chegadas',
    navLabel: 'Menu da Portaria',
    home: ROUTES.portaria,
    switchTo: AREAS.almoxarifado,
    items: PORTARIA_ITEMS,
    mobilePrimary: [ROUTES.portaria, ROUTES.portariaRegistrar],
  },
}

export function getAreaForPath(path) {
  return path === ROUTES.portaria || String(path).startsWith(`${ROUTES.portaria}/`) ? AREAS.portaria : AREAS.almoxarifado
}

export function getNavItems(area) {
  return AREA_CONFIG[area].items
}

// Barra inferior: até 4 destinos fixos + "Mais". Qualquer item novo da área
// cai em "Mais" automaticamente, em vez de forçar outra coluna.
export function getMobileNavItems(area) {
  const { items, mobilePrimary } = AREA_CONFIG[area]
  return {
    primary: items.filter((item) => mobilePrimary.includes(item.path)),
    more: items.filter((item) => !mobilePrimary.includes(item.path)),
  }
}

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
