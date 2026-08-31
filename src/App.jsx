import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  Boxes,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FileClock,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  PackageCheck,
  PackageOpen,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Truck,
  Upload,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react'
import {
  DIVERGENCE_TYPE_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  RECEBIMENTO_STATUS,
  RECEIPT_TYPE_OPTIONS,
  STATUS_OPTIONS,
  UNIT_OPTIONS,
  exportRecebimentosCsv,
  filterRecebimentos,
  getAllowedNextStatuses,
  getResponsibleName,
  hasOpenDivergences,
  isNfPending,
} from './data.js'
import { useRecebimentosStore } from './store.js'
import {
  Avatar,
  EmptyState,
  FieldError,
  Modal,
  StatusBadge,
  ToastHost,
  formatDate,
  formatDateTime,
  formatFileSize,
  getStatusMeta,
} from './ui.jsx'

const ROUTES = {
  dashboard: '/',
  receipts: '/recebimentos',
  newReceipt: '/novo',
  pending: '/pendencias',
}

const NAV_ITEMS = [
  { path: ROUTES.dashboard, label: 'Visão geral', icon: LayoutDashboard },
  { path: ROUTES.receipts, label: 'Recebimentos', icon: ClipboardList },
  { path: ROUTES.newReceipt, label: 'Novo recebimento', icon: Plus },
  { path: ROUTES.pending, label: 'Pendências', icon: AlertTriangle, count: true },
]

const WIZARD_STEPS = [
  { title: 'Identificação', subtitle: 'Pedido e fornecedor' },
  { title: 'Itens', subtitle: 'Materiais recebidos' },
  { title: 'Evidências', subtitle: 'Fotos e documentos' },
  { title: 'Revisão', subtitle: 'Conferir e enviar' },
]

const DOCUMENT_CARDS = [
  {
    category: 'Foto',
    title: 'Fotos do material',
    subtitle: 'Volumes, etiquetas e condições',
    icon: Camera,
    accept: 'image/*',
    capture: 'environment',
    multiple: true,
    featured: true,
  },
  {
    category: 'Nota Fiscal',
    title: 'Nota Fiscal',
    subtitle: 'PDF ou imagem digitalizada',
    icon: FileText,
    accept: 'application/pdf,image/*',
  },
  {
    category: 'DACTE',
    title: 'DACTE',
    subtitle: 'Documento de transporte',
    icon: Truck,
    accept: 'application/pdf,image/*',
  },
  {
    category: 'Pedido',
    title: 'Pedido de Compra',
    subtitle: 'Cópia do pedido',
    icon: ClipboardCheck,
    accept: 'application/pdf,image/*',
  },
  {
    category: 'Certificado',
    title: 'Certificados',
    subtitle: 'Qualidade e conformidade',
    icon: ShieldCheck,
    accept: 'application/pdf,image/*',
  },
  {
    category: 'Outro',
    title: 'Outros documentos',
    subtitle: 'Demais registros relacionados',
    icon: Paperclip,
    accept: 'application/pdf,image/*,.doc,.docx,.xls,.xlsx',
    multiple: true,
  },
]

const STATUS_BAR_CLASSES = {
  [RECEBIMENTO_STATUS.DIGITACAO]: '',
  [RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO]: 'docs',
  [RECEBIMENTO_STATUS.CONFERENCIA]: 'review',
  [RECEBIMENTO_STATUS.DIVERGENCIA]: 'divergence',
  [RECEBIMENTO_STATUS.FINALIZADO]: 'finalized',
}

const DIVERGENCE_LABELS = {
  'Quantidade incorreta': 'Quantidade incorreta',
  'Material avariado': 'Material avariado',
  'Material diferente': 'Material diferente do solicitado',
  'Falta de documentação': 'Falta de documentação',
  'Problema de embalagem': 'Problema de embalagem',
  Outro: 'Outro',
}

function getLocalDate() {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, queryString = ''] = raw.split('?')
  return { path: path || '/', query: new URLSearchParams(queryString) }
}

function useHashRoute() {
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

function navigate(path) {
  const next = path.startsWith('#') ? path : `#${path}`
  if (window.location.hash === next) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  window.location.hash = next
}

function displayResponsible(receipt) {
  return getResponsibleName(receipt) || 'Não informado'
}

function getActorName(actor) {
  if (!actor) return 'Sistema'
  if (typeof actor === 'string') return actor
  return actor.nome || actor.name || 'Sistema'
}

function readImagePreview(file) {
  if (!file.type?.startsWith('image/') || file.size > 2 * 1024 * 1024) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function downloadCsv(receipts) {
  const csv = exportRecebimentosCsv(receipts)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `recebimentos-alm-${getLocalDate()}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function AppShell({ route, pendingCount, currentUser, children, onToast }) {
  const [globalSearch, setGlobalSearch] = useState('')
  const searchRef = useRef(null)

  useEffect(() => {
    const onShortcut = (event) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  const isActive = (path) => {
    if (path === ROUTES.dashboard) return route.path === '/'
    if (path === ROUTES.receipts) return route.path.startsWith('/recebimentos')
    return route.path === path
  }

  const submitGlobalSearch = (event) => {
    event.preventDefault()
    const value = globalSearch.trim()
    navigate(`${ROUTES.receipts}${value ? `?q=${encodeURIComponent(value)}` : ''}`)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegação principal">
        <button className="brand" type="button" onClick={() => navigate('/')} aria-label="Ir para visão geral">
          <span className="brand-mark">ALM</span>
          <span className="brand-copy">
            <strong>Recebimentos</strong>
            <span>Almoxarifado</span>
          </span>
        </button>

        <div className="sidebar-context">Operação</div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
              >
                <Icon size={18} strokeWidth={2} />
                <span>{item.label}</span>
                {item.count && pendingCount ? <span className="nav-count">{pendingCount}</span> : null}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="environment-card">
            <span>MVP local ativo</span>
            <p>Os dados desta demonstração ficam salvos neste navegador.</p>
          </div>
          <div className="sidebar-user">
            <Avatar name={currentUser?.nome || currentUser?.name} />
            <span className="sidebar-user-copy">
              <strong>{currentUser?.nome || currentUser?.name}</strong>
              <span>{currentUser?.perfil || currentUser?.role}</span>
            </span>
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <form className="top-search" onSubmit={submitGlobalSearch} role="search">
            <Search size={17} />
            <input
              ref={searchRef}
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Buscar protocolo, pedido, NF, fornecedor ou material"
              aria-label="Busca global"
            />
            <kbd>/</kbd>
          </form>
          <div className="topbar-actions">
            <button
              className="icon-button notification-button"
              type="button"
              aria-label="Ver pendências"
              onClick={() => navigate(ROUTES.pending)}
            >
              <Bell size={18} />
            </button>
            <span className="topbar-divider" />
            <button
              className="topbar-user"
              type="button"
              onClick={() => onToast('Perfil demonstrativo', 'A autenticação corporativa será conectada na implantação.')}
            >
              <Avatar name={currentUser?.nome || currentUser?.name} />
              <span className="topbar-user-copy">
                <strong>{currentUser?.nome || currentUser?.name}</strong>
                <span>{currentUser?.perfil || currentUser?.role}</span>
              </span>
              <ChevronDown size={14} color="#70848a" />
            </button>
          </div>
        </header>

        <header className="mobile-topbar">
          <button className="mobile-brand" type="button" onClick={() => navigate('/')}>
            <span className="brand-mark">ALM</span>
            <strong>Recebimentos</strong>
          </button>
          <div className="mobile-top-actions">
            <button className="icon-button" type="button" onClick={() => navigate(`${ROUTES.receipts}?focus=search`)} aria-label="Buscar">
              <Search size={19} />
            </button>
            <button className="icon-button notification-button" type="button" onClick={() => navigate(ROUTES.pending)} aria-label="Pendências">
              <Bell size={19} />
            </button>
          </div>
        </header>

        {children}
      </main>

      <nav className="mobile-nav" aria-label="Navegação mobile">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`mobile-nav-button ${item.path === ROUTES.newReceipt ? 'primary' : ''} ${isActive(item.path) ? 'active' : ''}`}
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
            >
              <Icon size={20} />
              <span>{item.path === ROUTES.newReceipt ? 'Novo' : item.label.replace('Visão geral', 'Início')}</span>
              {item.count && pendingCount ? <span className="nav-count">{pendingCount}</span> : null}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function PageHeader({ eyebrow, title, description, children }) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  )
}

function KpiCard({ icon: Icon, value, label, tone = '', trend }) {
  return (
    <article className={`kpi-card ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-top">
        <span className="kpi-icon"><Icon size={18} /></span>
        {trend ? <span className="kpi-trend"><TrendingUp size={12} />{trend}</span> : null}
      </div>
      <div className="kpi-value">{value}</div>
      <p className="kpi-label">{label}</p>
    </article>
  )
}

function DashboardPage({ store }) {
  const { receipts, metrics } = store
  const maxStatus = Math.max(1, ...metrics.porStatus.map((item) => item.total))
  const attention = receipts
    .filter((item) => isNfPending(item) || hasOpenDivergences(item))
    .slice(0, 5)
  const recent = [...receipts]
    .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)))
    .slice(0, 5)

  return (
    <div className="page">
      <PageHeader
        eyebrow="Visão operacional"
        title="Bom dia, Marcos"
        description="Acompanhe os recebimentos e resolva o que precisa de atenção hoje."
      >
        <button className="period-control" type="button">
          <CalendarDays size={15} /> Agosto de 2026 <ChevronDown size={13} />
        </button>
        <button className="btn btn-primary" type="button" onClick={() => navigate(ROUTES.newReceipt)}>
          <Plus size={17} /> Novo recebimento
        </button>
      </PageHeader>

      <div className="demo-notice">
        <WifiOff size={15} />
        <span><strong>Ambiente de validação:</strong> alterações e novos registros são mantidos localmente neste navegador.</span>
      </div>

      <section className="kpi-grid" aria-label="Indicadores do período">
        <KpiCard icon={PackageOpen} value={metrics.totalRecebimentos} label="Recebimentos no período" trend="+12%" />
        <KpiCard icon={Boxes} value={metrics.materiaisHoje} label="Materiais recebidos hoje" tone="blue" trend={`${metrics.recebimentosHoje} registros`} />
        <KpiCard icon={FileClock} value={metrics.documentacaoPendente} label="Documentações pendentes" tone="amber" />
        <KpiCard icon={AlertTriangle} value={metrics.divergenciasAbertas} label="Divergências abertas" tone="red" />
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-column">
          <article className="panel">
            <header className="panel-header">
              <div>
                <h2>Recebimentos por status</h2>
                <p>Distribuição dos registros ativos no período</p>
              </div>
              <button className="panel-link" type="button" onClick={() => navigate(ROUTES.receipts)}>
                Ver todos <ChevronRight size={14} />
              </button>
            </header>
            <div className="status-bars">
              {metrics.porStatus.map((item) => {
                const suffix = STATUS_BAR_CLASSES[item.status]
                return (
                  <div className="status-bar-row" key={item.status}>
                    <div className="status-bar-label">
                      <span className={`status-dot ${suffix ? `dot-${suffix}` : ''}`} />
                      <span>{getStatusMeta(item.status).shortLabel}</span>
                    </div>
                    <div className="bar-track">
                      <div className={`bar-fill ${suffix ? `fill-${suffix}` : ''}`} style={{ width: `${Math.max(8, (item.total / maxStatus) * 100)}%` }} />
                    </div>
                    <span className="status-count">{item.total}</span>
                  </div>
                )
              })}
            </div>
          </article>

          <article className="panel table-panel">
            <header className="panel-header">
              <div>
                <h2>Recebimentos recentes</h2>
                <p>Últimas movimentações registradas</p>
              </div>
              <button className="panel-link" type="button" onClick={() => navigate(ROUTES.receipts)}>
                Abrir consulta <ChevronRight size={14} />
              </button>
            </header>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Protocolo</th><th>Fornecedor</th><th>Pedido</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {recent.map((receipt) => (
                    <tr key={receipt.id} onClick={() => navigate(`/recebimentos/${encodeURIComponent(receipt.id)}`)}>
                      <td><span className="protocol-link">{receipt.protocolo}</span></td>
                      <td><div className="table-main"><strong>{receipt.fornecedor}</strong><span>{formatDate(receipt.dataRecebimento)}</span></div></td>
                      <td>{receipt.pedido || '—'}</td>
                      <td><StatusBadge status={receipt.status} compact /></td>
                      <td><ChevronRight size={15} color="#70848a" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-records">
              {recent.map((receipt) => <ReceiptMobileCard key={receipt.id} receipt={receipt} />)}
            </div>
          </article>
        </div>

        <div className="dashboard-column">
          <article className="quick-action">
            <h3>Material chegando?</h3>
            <p>Abra um registro, fotografe os volumes e mantenha tudo no mesmo protocolo.</p>
            <button className="btn" type="button" onClick={() => navigate(ROUTES.newReceipt)}>
              <Plus size={16} /> Registrar agora
            </button>
          </article>

          <article className="panel">
            <header className="panel-header">
              <div>
                <h2>Requer atenção</h2>
                <p>Pendências com ação necessária</p>
              </div>
              <button className="panel-link" type="button" onClick={() => navigate(ROUTES.pending)}>
                Ver fila <ChevronRight size={14} />
              </button>
            </header>
            {attention.length ? (
              <div className="attention-list">
                {attention.map((receipt) => {
                  const divergence = hasOpenDivergences(receipt)
                  return (
                    <button className="attention-item" key={receipt.id} type="button" onClick={() => navigate(`/recebimentos/${receipt.id}`)}>
                      <span className={`attention-icon ${divergence ? 'danger' : ''}`}>
                        {divergence ? <AlertTriangle size={16} /> : <FileClock size={16} />}
                      </span>
                      <span className="attention-copy">
                        <strong>{receipt.fornecedor}</strong>
                        <span>{divergence ? 'Divergência aguardando tratamento' : 'Nota Fiscal pendente'} · {receipt.protocolo}</span>
                      </span>
                      <ChevronRight size={15} color="#70848a" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <EmptyState icon={CheckCircle2} title="Tudo em dia" description="Nenhuma pendência operacional neste momento." />
            )}
          </article>
        </div>
      </section>
    </div>
  )
}

function ReceiptMobileCard({ receipt }) {
  return (
    <article className="mobile-record-card" role="button" tabIndex={0} onClick={() => navigate(`/recebimentos/${receipt.id}`)} onKeyDown={(event) => event.key === 'Enter' && navigate(`/recebimentos/${receipt.id}`)}>
      <div className="mobile-record-top">
        <strong>{receipt.protocolo}</strong>
        <StatusBadge status={receipt.status} compact />
      </div>
      <h3>{receipt.fornecedor}</h3>
      <p>{(receipt.itens || [])[0]?.descricao || 'Sem item informado'}</p>
      <div className="mobile-record-meta">
        <div><span>Pedido</span><strong>{receipt.pedido || '—'}</strong></div>
        <div><span>NF</span><strong>{receipt.numeroNf || 'Pendente'}</strong></div>
        <div><span>Recebimento</span><strong>{formatDate(receipt.dataRecebimento)}</strong></div>
        <div><span>Itens</span><strong>{receipt.itens?.length || 0}</strong></div>
      </div>
    </article>
  )
}

function ReceiptsPage({ store, initialQuery }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState({
    search: initialQuery.get('q') || '',
    status: '',
    tipo: '',
    fornecedor: '',
    responsavel: '',
    periodoInicio: '',
    periodoFim: '',
    nfPendente: false,
  })
  const [sortDirection, setSortDirection] = useState('desc')

  useEffect(() => {
    const value = initialQuery.get('q') || ''
    if (value) setFilters((current) => ({ ...current, search: value }))
  }, [initialQuery])

  const suppliers = useMemo(() => [...new Set(store.receipts.map((item) => item.fornecedor))].sort(), [store.receipts])
  const responsibles = useMemo(() => [...new Set(store.receipts.map(displayResponsible))].sort(), [store.receipts])
  const filtered = useMemo(() => {
    const result = filterRecebimentos(store.receipts, filters)
    return [...result].sort((a, b) => {
      const compared = String(a.dataRecebimento).localeCompare(String(b.dataRecebimento))
      return sortDirection === 'desc' ? -compared : compared
    })
  }, [store.receipts, filters, sortDirection])

  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }))
  const clearFilters = () => setFilters({ search: '', status: '', tipo: '', fornecedor: '', responsavel: '', periodoInicio: '', periodoFim: '', nfPendente: false })
  const activeCount = Object.entries(filters).filter(([key, value]) => key !== 'search' && Boolean(value)).length

  return (
    <div className="page">
      <PageHeader
        eyebrow="Consulta centralizada"
        title="Recebimentos"
        description="Pesquise pedidos, notas, materiais e fornecedores em um único lugar."
      >
        <button className="btn btn-secondary" type="button" onClick={() => downloadCsv(filtered)}>
          <FileSpreadsheet size={16} /> Exportar Excel
        </button>
        <button className="btn btn-primary" type="button" onClick={() => navigate(ROUTES.newReceipt)}>
          <Plus size={16} /> Novo recebimento
        </button>
      </PageHeader>

      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="list-search">
            <Search size={16} />
            <input
              autoFocus={initialQuery.get('focus') === 'search'}
              value={filters.search}
              onChange={(event) => setFilter('search', event.target.value)}
              placeholder="Buscar protocolo, pedido, NF, fornecedor ou item"
              aria-label="Pesquisar recebimentos"
            />
            {filters.search ? <button className="search-clear" type="button" onClick={() => setFilter('search', '')} aria-label="Limpar pesquisa"><X size={14} /></button> : null}
          </div>
          <select className="filter-select" value={filters.status} onChange={(event) => setFilter('status', event.target.value)} aria-label="Filtrar por status">
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.shortLabel}</option>)}
          </select>
          <label className="filter-toggle">
            <input type="checkbox" checked={filters.nfPendente} onChange={(event) => setFilter('nfPendente', event.target.checked)} />
            NF pendente
          </label>
          <button className="btn btn-secondary" type="button" onClick={() => setFiltersOpen((open) => !open)}>
            <Filter size={15} /> Filtros {activeCount ? `(${activeCount})` : ''}
          </button>
          <button className="icon-button" type="button" onClick={() => downloadCsv(filtered)} aria-label="Exportar CSV"><Download size={17} /></button>
        </div>

        {filtersOpen ? (
          <div className="advanced-filters">
            <div className="form-grid">
              <div className="field">
                <label>Data inicial</label>
                <input type="date" value={filters.periodoInicio} onChange={(event) => setFilter('periodoInicio', event.target.value)} />
              </div>
              <div className="field">
                <label>Data final</label>
                <input type="date" value={filters.periodoFim} onChange={(event) => setFilter('periodoFim', event.target.value)} />
              </div>
              <div className="field">
                <label>Fornecedor</label>
                <select value={filters.fornecedor} onChange={(event) => setFilter('fornecedor', event.target.value)}>
                  <option value="">Todos</option>
                  {suppliers.map((supplier) => <option value={supplier} key={supplier}>{supplier}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Tipo</label>
                <select value={filters.tipo} onChange={(event) => setFilter('tipo', event.target.value)}>
                  <option value="">Todos</option>
                  {RECEIPT_TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Responsável</label>
                <select value={filters.responsavel} onChange={(event) => setFilter('responsavel', event.target.value)}>
                  <option value="">Todos</option>
                  {responsibles.map((name) => <option value={name} key={name}>{name}</option>)}
                </select>
              </div>
            </div>
            <div className="advanced-filter-actions">
              <span>{filtered.length} registro(s) encontrado(s)</span>
              <button className="btn btn-ghost btn-sm" type="button" onClick={clearFilters}>Limpar filtros</button>
            </div>
          </div>
        ) : null}

        <div className="active-filter-bar">
          <span><strong>{filtered.length}</strong> de {store.receipts.length} recebimentos</span>
          {filters.search ? <span className="filter-chip">Busca: {filters.search}<button type="button" onClick={() => setFilter('search', '')}><X size={11} /></button></span> : null}
          {activeCount ? <button className="panel-link" type="button" onClick={clearFilters}>Limpar tudo</button> : null}
          <button className="panel-link sort-link" type="button" onClick={() => setSortDirection((direction) => direction === 'desc' ? 'asc' : 'desc')}>
            Data {sortDirection === 'desc' ? 'mais recente' : 'mais antiga'}
          </button>
        </div>

        {filtered.length ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Protocolo</th><th>Pedido / NF</th><th>Fornecedor</th><th>Data</th><th>Itens</th><th>Tipo</th><th>Responsável</th><th>Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((receipt) => (
                    <tr key={receipt.id} onClick={() => navigate(`/recebimentos/${encodeURIComponent(receipt.id)}`)}>
                      <td><span className="protocol-link">{receipt.protocolo}</span></td>
                      <td><div className="table-main"><strong>PC {receipt.pedido || '—'}</strong>{receipt.numeroNf ? <span>NF {receipt.numeroNf}</span> : <span className="nf-pending"><FileClock size={11} /> NF pendente</span>}</div></td>
                      <td><div className="table-main"><strong>{receipt.fornecedor}</strong><span>{receipt.cnpjFornecedor || 'Cadastro local'}</span></div></td>
                      <td>{formatDate(receipt.dataRecebimento)}</td>
                      <td><span className="table-items-count">{receipt.itens?.length || 0}</span></td>
                      <td>{receipt.tipo}</td>
                      <td><div className="table-main"><strong>{displayResponsible(receipt)}</strong><span>Almoxarifado</span></div></td>
                      <td><StatusBadge status={receipt.status} compact /></td>
                      <td><ChevronRight size={15} color="#70848a" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-records">
              {filtered.map((receipt) => <ReceiptMobileCard key={receipt.id} receipt={receipt} />)}
            </div>
            <footer className="pagination">
              <span>Mostrando {filtered.length} registro(s)</span>
              <div className="pagination-controls"><button className="page-number active" type="button">1</button></div>
            </footer>
          </>
        ) : (
          <EmptyState
            icon={Search}
            title="Nenhum recebimento encontrado"
            description="Tente remover alguns filtros ou pesquise por outro termo."
            action={<button className="btn btn-secondary" type="button" onClick={clearFilters}>Limpar filtros</button>}
          />
        )}
      </section>
    </div>
  )
}

function createEmptyItem(index = 0) {
  return {
    id: `temp-${Date.now()}-${index}`,
    numero: String((index + 1) * 10),
    codigo: '',
    descricao: '',
    quantidadeSolicitada: '',
    quantidadeRecebida: '1',
    unidade: 'UN',
  }
}

function NewReceiptPage({ store, pushToast }) {
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    pedido: '',
    dataRecebimento: getLocalDate(),
    fornecedor: '',
    cnpjFornecedor: '',
    tipo: 'Estoque',
    numeroNf: '',
    serieNf: '',
    observacoes: '',
    itens: [createEmptyItem(0)],
    anexos: [],
  })

  const setField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined }))
  }

  const validateStep = (targetStep = step) => {
    const nextErrors = {}
    if (targetStep === 0) {
      if (!form.pedido.trim()) nextErrors.pedido = 'Informe o número do Pedido de Compra.'
      if (!form.dataRecebimento) nextErrors.dataRecebimento = 'Informe a data do recebimento.'
      if (!form.fornecedor.trim()) nextErrors.fornecedor = 'Informe o fornecedor.'
      if (!form.tipo) nextErrors.tipo = 'Selecione o tipo de recebimento.'
    }
    if (targetStep === 1) {
      form.itens.forEach((item, index) => {
        if (!item.descricao.trim()) nextErrors[`item-${index}-descricao`] = 'Informe a descrição.'
        if (!(Number(item.quantidadeRecebida) > 0)) nextErrors[`item-${index}-quantidade`] = 'A quantidade deve ser maior que zero.'
        if (!item.unidade) nextErrors[`item-${index}-unidade`] = 'Selecione a unidade.'
      })
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const nextStep = () => {
    if (!validateStep(step)) return
    setStep((current) => Math.min(3, current + 1))
  }

  const updateItem = (index, name, value) => {
    setForm((current) => ({
      ...current,
      itens: current.itens.map((item, itemIndex) => itemIndex === index ? { ...item, [name]: value } : item),
    }))
    setErrors((current) => ({ ...current, [`item-${index}-${name}`]: undefined }))
  }

  const addItem = () => setForm((current) => ({ ...current, itens: [...current.itens, createEmptyItem(current.itens.length)] }))
  const removeItem = (index) => setForm((current) => ({ ...current, itens: current.itens.filter((_, itemIndex) => itemIndex !== index) }))

  const addFiles = async (category, fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const attachments = await Promise.all(files.map(async (file) => ({
      file,
      name: file.name,
      nome: file.name,
      categoria: category,
      mimeType: file.type,
      size: file.size,
      tamanho: file.size,
      url: await readImagePreview(file),
    })))
    setForm((current) => ({ ...current, anexos: [...current.anexos, ...attachments] }))
    pushToast('Arquivo incluído', `${files.length} arquivo(s) adicionado(s) ao recebimento.`)
  }

  const removeLocalFile = (index) => setForm((current) => ({ ...current, anexos: current.anexos.filter((_, fileIndex) => fileIndex !== index) }))

  const save = async (sendToFlow) => {
    if (sendToFlow && (!validateStep(0) || !validateStep(1))) {
      setStep(!form.pedido || !form.fornecedor ? 0 : 1)
      return
    }
    setSaving(true)
    try {
      let receipt = store.createRecebimento({
        ...form,
        itens: form.itens.map(({ id, ...item }) => item),
      })
      if (sendToFlow) {
        const nextStatus = isNfPending(receipt)
          ? RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO
          : RECEBIMENTO_STATUS.CONFERENCIA
        receipt = store.transitionStatus(receipt.id, nextStatus, {
          note: isNfPending(receipt) ? 'Registro enviado com documentação pendente.' : 'Registro enviado para conferência.',
        })
      }
      pushToast(
        sendToFlow ? 'Recebimento enviado' : 'Rascunho salvo',
        `${receipt.protocolo} foi criado com sucesso.`,
      )
      navigate(`/recebimentos/${receipt.id}`)
    } catch (error) {
      pushToast('Não foi possível salvar', error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Registro de entrada"
        title="Novo recebimento"
        description="Registre os dados no ritmo da operação. A NF poderá ser anexada depois."
      />

      <section className="wizard-shell">
        <aside className="stepper-card">
          <div className="stepper-title">Progresso do registro</div>
          <div className="stepper">
            {WIZARD_STEPS.map((wizardStep, index) => (
              <button
                className={`step-button ${index === step ? 'active' : ''} ${index < step ? 'complete' : ''}`}
                key={wizardStep.title}
                type="button"
                onClick={() => index <= step && setStep(index)}
              >
                <span className="step-number">{index < step ? <Check size={14} /> : index + 1}</span>
                <span className="step-copy"><strong>{wizardStep.title}</strong><span>{wizardStep.subtitle}</span></span>
              </button>
            ))}
          </div>
          <div className="autosave-note"><CheckCircle2 size={14} /> O responsável será registrado automaticamente.</div>
        </aside>

        <article className="form-card">
          <header className="form-card-header">
            <div>
              <h2>{WIZARD_STEPS[step].title}</h2>
              <p>{step === 0 && 'Comece pelos dados que identificam a entrega.'}{step === 1 && 'Adicione todos os materiais vinculados ao pedido.'}{step === 2 && 'Centralize as fotos e documentos deste recebimento.'}{step === 3 && 'Revise as informações antes de enviar.'}</p>
            </div>
            <span className="step-pill">Etapa {step + 1} de 4</span>
          </header>

          <div className="form-card-body">
            {step === 0 ? (
              <div className="form-grid">
                <div className="field">
                  <label>Pedido de Compra <span className="required-hint">Obrigatório</span></label>
                  <div className="input-with-icon"><Search size={15} /><input className={errors.pedido ? 'error' : ''} value={form.pedido} onChange={(event) => setField('pedido', event.target.value)} placeholder="Ex.: 4500873245" /></div>
                  <FieldError>{errors.pedido}</FieldError>
                  <span className="field-help">A consulta automática ao ERP será conectada em uma fase posterior.</span>
                </div>
                <div className="field">
                  <label>Data do recebimento <span className="required-hint">Obrigatório</span></label>
                  <input className={errors.dataRecebimento ? 'error' : ''} type="date" max={getLocalDate()} value={form.dataRecebimento} onChange={(event) => setField('dataRecebimento', event.target.value)} />
                  <FieldError>{errors.dataRecebimento}</FieldError>
                </div>
                <div className="field field-full">
                  <label>Fornecedor <span className="required-hint">Obrigatório</span></label>
                  <div className="input-with-icon"><Building2 size={15} /><input className={errors.fornecedor ? 'error' : ''} list="supplier-options" value={form.fornecedor} onChange={(event) => setField('fornecedor', event.target.value)} placeholder="Digite ou selecione o fornecedor" /></div>
                  <datalist id="supplier-options">{store.suppliers.map((option) => <option value={option.value || option.label} key={option.value || option.label} />)}</datalist>
                  <FieldError>{errors.fornecedor}</FieldError>
                </div>
                <div className="field">
                  <label>CNPJ <span className="optional">Opcional no MVP</span></label>
                  <input value={form.cnpjFornecedor} onChange={(event) => setField('cnpjFornecedor', event.target.value)} placeholder="00.000.000/0000-00" />
                </div>
                <div className="field">
                  <label>Tipo de recebimento <span className="required-hint">Obrigatório</span></label>
                  <select className={errors.tipo ? 'error' : ''} value={form.tipo} onChange={(event) => setField('tipo', event.target.value)}>
                    {RECEIPT_TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                  <FieldError>{errors.tipo}</FieldError>
                </div>
                <div className="field field-full">
                  <div className="field-label">Responsável pelo registro</div>
                  <div className="responsible-preview">
                    <Avatar name={store.currentUser.nome || store.currentUser.name} />
                    <div><strong>{store.currentUser.nome || store.currentUser.name}</strong><span>{store.currentUser.perfil || store.currentUser.role} · identificado automaticamente</span></div>
                    <ShieldCheck size={16} color="#087c64" style={{ marginLeft: 'auto' }} />
                  </div>
                </div>
                <div className="field field-full">
                  <label>Observações <span className="optional">Opcional</span></label>
                  <textarea value={form.observacoes} onChange={(event) => setField('observacoes', event.target.value)} placeholder="Ex.: entrega no portão 2, volumes lacrados, contato do solicitante..." />
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="items-editor">
                {form.itens.map((item, index) => (
                  <div className="item-editor-card" key={item.id}>
                    <div className="item-editor-head">
                      <strong>Item {index + 1}</strong>
                      {form.itens.length > 1 ? <button className="icon-button" type="button" onClick={() => removeItem(index)} aria-label={`Remover item ${index + 1}`}><Trash2 size={15} /></button> : null}
                    </div>
                    <div className="item-grid">
                      <div className="field"><label>Linha</label><input value={item.numero} onChange={(event) => updateItem(index, 'numero', event.target.value)} placeholder="10" /></div>
                      <div className="field"><label>Código</label><input value={item.codigo} onChange={(event) => updateItem(index, 'codigo', event.target.value)} placeholder="MAT-000123" /></div>
                      <div className="field description-field"><label>Descrição <span className="required-hint">Obrigatório</span></label><input className={errors[`item-${index}-descricao`] ? 'error' : ''} value={item.descricao} onChange={(event) => updateItem(index, 'descricao', event.target.value)} placeholder="Descrição do material recebido" /><FieldError>{errors[`item-${index}-descricao`]}</FieldError></div>
                      <div className="field"><label>Qtd. solicitada</label><input type="number" min="0" step="0.001" value={item.quantidadeSolicitada} onChange={(event) => updateItem(index, 'quantidadeSolicitada', event.target.value)} placeholder="—" /></div>
                      <div className="field"><label>Qtd. recebida</label><input className={errors[`item-${index}-quantidade`] ? 'error' : ''} type="number" min="0.001" step="0.001" inputMode="decimal" value={item.quantidadeRecebida} onChange={(event) => updateItem(index, 'quantidadeRecebida', event.target.value)} /><FieldError>{errors[`item-${index}-quantidade`]}</FieldError></div>
                      <div className="field"><label>Unidade</label><select value={item.unidade} onChange={(event) => updateItem(index, 'unidade', event.target.value)}>{UNIT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.value}</option>)}</select></div>
                    </div>
                    {item.quantidadeSolicitada && Number(item.quantidadeSolicitada) !== Number(item.quantidadeRecebida) ? <div className="info-strip warning"><AlertTriangle size={14} /> A quantidade recebida difere da solicitada. Será possível registrar uma divergência na conferência.</div> : null}
                  </div>
                ))}
                <button className="add-item-button" type="button" onClick={addItem}><Plus size={15} /> Adicionar outro item</button>
              </div>
            ) : null}

            {step === 2 ? (
              <div>
                <div className="form-grid document-meta-fields">
                  <div className="field">
                    <label>Número da NF/documento <span className="optional">Pode ficar pendente</span></label>
                    <input value={form.numeroNf} onChange={(event) => setField('numeroNf', event.target.value)} placeholder="Informe se já estiver disponível" />
                  </div>
                  <div className="field">
                    <label>Série <span className="optional">Opcional</span></label>
                    <input value={form.serieNf} onChange={(event) => setField('serieNf', event.target.value)} placeholder="Ex.: 1" />
                  </div>
                </div>
                {!form.numeroNf ? <div className="info-strip warning"><FileClock size={15} /><span><strong>NF ainda não disponível.</strong> O registro seguirá como “Aguardando documentação” e poderá ser complementado depois.</span></div> : null}
                <div className="upload-grid upload-grid-spaced">
                  {DOCUMENT_CARDS.map((card) => {
                    const Icon = card.icon
                    const files = form.anexos.map((file, index) => ({ ...file, originalIndex: index })).filter((file) => file.categoria === card.category)
                    return (
                      <div className={`upload-card ${card.featured ? 'featured' : ''}`} key={card.category}>
                        <div className="upload-card-head">
                          <div className="upload-card-title"><span><Icon size={15} /></span><div><strong>{card.title}</strong><small>{card.subtitle}</small></div></div>
                          {files.length ? <span className="table-items-count">{files.length}</span> : null}
                        </div>
                        <label className="upload-zone">
                          <Upload size={19} />
                          <strong>{card.category === 'Foto' ? 'Tirar foto ou selecionar da galeria' : 'Selecionar arquivo'}</strong>
                          <span>{card.multiple ? 'Você pode incluir vários arquivos' : 'PDF ou imagem, até 10 MB'}</span>
                          <input type="file" accept={card.accept} capture={card.capture} multiple={card.multiple} onChange={(event) => { addFiles(card.category, event.target.files); event.target.value = '' }} />
                        </label>
                        {files.length ? <div className="file-list">{files.map((file) => <div className="file-row" key={`${file.name}-${file.originalIndex}`}><span className="file-row-icon">{file.mimeType?.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />}</span><div><strong>{file.name}</strong><span>{formatFileSize(file.size)}</span></div><button className="icon-button" type="button" onClick={() => removeLocalFile(file.originalIndex)} aria-label="Remover arquivo"><X size={14} /></button></div>)}</div> : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="review-stack">
                <section className="review-section">
                  <header className="review-section-header"><h3>Identificação</h3><button className="panel-link" type="button" onClick={() => setStep(0)}>Editar</button></header>
                  <div className="summary-grid">
                    <div className="summary-field"><span>Pedido</span><strong>{form.pedido || 'Não informado'}</strong></div>
                    <div className="summary-field"><span>Fornecedor</span><strong>{form.fornecedor || 'Não informado'}</strong></div>
                    <div className="summary-field"><span>Recebimento</span><strong>{formatDate(form.dataRecebimento)}</strong></div>
                    <div className="summary-field"><span>Tipo</span><strong>{form.tipo}</strong></div>
                    <div className="summary-field"><span>Responsável</span><strong>{store.currentUser.nome || store.currentUser.name}</strong></div>
                    <div className="summary-field"><span>NF</span><strong>{form.numeroNf || 'Pendente'}</strong></div>
                  </div>
                </section>
                <section className="review-section">
                  <header className="review-section-header"><h3>Itens recebidos</h3><button className="panel-link" type="button" onClick={() => setStep(1)}>Editar</button></header>
                  <div className="checklist">{form.itens.map((item, index) => <div className="checklist-item" key={item.id}><span className="checklist-icon"><Check size={12} /></span><span><strong>{index + 1}. {item.descricao || 'Descrição pendente'}</strong> · {item.quantidadeRecebida} {item.unidade}</span></div>)}</div>
                </section>
                <section className="review-section">
                  <header className="review-section-header"><h3>Documentos e pendências</h3><button className="panel-link" type="button" onClick={() => setStep(2)}>Editar</button></header>
                  <div className="checklist">
                    <div className="checklist-item"><span className={`checklist-icon ${form.numeroNf && form.anexos.some((file) => file.categoria === 'Nota Fiscal') ? '' : 'pending'}`}>{form.numeroNf && form.anexos.some((file) => file.categoria === 'Nota Fiscal') ? <Check size={12} /> : <FileClock size={12} />}</span><span>{form.numeroNf ? `NF ${form.numeroNf}` : 'Número da NF pendente'} · {form.anexos.some((file) => file.categoria === 'Nota Fiscal') ? 'arquivo incluído' : 'arquivo pendente'}</span></div>
                    <div className="checklist-item"><span className="checklist-icon"><Paperclip size={12} /></span><span>{form.anexos.length} arquivo(s) selecionado(s), sendo {form.anexos.filter((file) => file.categoria === 'Foto').length} foto(s)</span></div>
                  </div>
                </section>
                <div className={`info-strip ${form.numeroNf && form.anexos.some((file) => file.categoria === 'Nota Fiscal') ? '' : 'warning'}`}>
                  {form.numeroNf && form.anexos.some((file) => file.categoria === 'Nota Fiscal') ? <ClipboardCheck size={16} /> : <FileClock size={16} />}
                  <span>{form.numeroNf && form.anexos.some((file) => file.categoria === 'Nota Fiscal') ? 'O recebimento seguirá para Em conferência.' : 'O recebimento será salvo como Aguardando documentação e poderá ser complementado depois.'}</span>
                </div>
              </div>
            ) : null}
          </div>

          <footer className="wizard-footer">
            <button className="btn btn-ghost" type="button" disabled={saving} onClick={() => save(false)}>Salvar e continuar depois</button>
            <div className="wizard-footer-group">
              {step > 0 ? <button className="btn btn-secondary" type="button" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={15} /> Voltar</button> : <button className="btn btn-secondary" type="button" onClick={() => navigate(ROUTES.receipts)}>Cancelar</button>}
              {step < 3 ? <button className="btn btn-primary" type="button" onClick={nextStep}>Continuar <ArrowRight size={15} /></button> : <button className="btn btn-primary btn-lg" type="button" disabled={saving} onClick={() => save(true)}>{saving ? <RefreshCw className="spin" size={16} /> : <ClipboardCheck size={16} />} Enviar para conferência</button>}
            </div>
          </footer>
        </article>
      </section>
    </div>
  )
}

function DetailPage({ store, receiptId, pushToast }) {
  const receipt = store.receipts.find((item) => item.id === receiptId || item.protocolo === receiptId)
  const [documentModal, setDocumentModal] = useState(false)
  const [divergenceModal, setDivergenceModal] = useState(false)
  const [resolveTarget, setResolveTarget] = useState(null)
  const [documentForm, setDocumentForm] = useState({ category: 'Nota Fiscal', numeroNf: '', serieNf: '', files: [] })
  const [divergenceForm, setDivergenceForm] = useState({ tipo: 'Quantidade incorreta', itemId: '', descricao: '' })
  const [resolution, setResolution] = useState('')

  if (!receipt) {
    return <div className="page"><EmptyState icon={PackageOpen} title="Recebimento não encontrado" description="O registro pode ter sido arquivado ou o endereço está incorreto." action={<button className="btn btn-secondary" onClick={() => navigate(ROUTES.receipts)}>Voltar à consulta</button>} /></div>
  }

  const visibleAttachments = (receipt.anexos || []).filter((file) => !file.removido)
  const photos = visibleAttachments.filter((file) => (file.categoria || file.tipo) === 'Foto')
  const docs = visibleAttachments.filter((file) => (file.categoria || file.tipo) !== 'Foto')
  const openDivergences = (receipt.divergencias || []).filter((item) => !item.resolvida)
  const allowedStatuses = getAllowedNextStatuses(receipt, store.currentUser)
  const nfPending = isNfPending(receipt)

  const tryTransition = (status, note) => {
    try {
      store.transitionStatus(receipt.id, status, { note })
      pushToast('Status atualizado', `${receipt.protocolo} agora está em “${status}”.`)
    } catch (error) {
      pushToast('Ação não concluída', error.message, 'error')
    }
  }

  const contextualAction = () => {
    if (receipt.status === RECEBIMENTO_STATUS.DIGITACAO) {
      const target = nfPending ? RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO : RECEBIMENTO_STATUS.CONFERENCIA
      return { label: nfPending ? 'Enviar com pendência' : 'Enviar para conferência', icon: ArrowRight, onClick: () => tryTransition(target, 'Registro encaminhado pelo Almoxarifado.') }
    }
    if (receipt.status === RECEBIMENTO_STATUS.AGUARDANDO_DOCUMENTACAO) {
      return nfPending
        ? { label: 'Adicionar Nota Fiscal', icon: FilePlus2, onClick: () => { setDocumentForm((current) => ({ ...current, category: 'Nota Fiscal', numeroNf: receipt.numeroNf || '' })); setDocumentModal(true) } }
        : { label: 'Iniciar conferência', icon: ClipboardCheck, onClick: () => tryTransition(RECEBIMENTO_STATUS.CONFERENCIA, 'Documentação recebida; conferência iniciada.') }
    }
    if (receipt.status === RECEBIMENTO_STATUS.CONFERENCIA) {
      return { label: 'Finalizar recebimento', icon: CheckCircle2, onClick: () => tryTransition(RECEBIMENTO_STATUS.FINALIZADO, 'Conferência física e documental concluída.') }
    }
    if (receipt.status === RECEBIMENTO_STATUS.DIVERGENCIA && !openDivergences.length) {
      return { label: 'Devolver à conferência', icon: RefreshCw, onClick: () => tryTransition(RECEBIMENTO_STATUS.CONFERENCIA, 'Divergências resolvidas; devolvido para conferência.') }
    }
    return null
  }

  const primaryAction = contextualAction()

  const saveDocument = async () => {
    if (!documentForm.files.length) {
      pushToast('Selecione um arquivo', 'Escolha ao menos um documento para anexar.', 'error')
      return
    }
    if (documentForm.category === 'Nota Fiscal' && !documentForm.numeroNf.trim() && !receipt.numeroNf) {
      pushToast('Número da NF necessário', 'Informe o número para identificar o documento.', 'error')
      return
    }
    try {
      if (documentForm.category === 'Nota Fiscal') {
        store.updateRecebimento(receipt.id, { numeroNf: documentForm.numeroNf || receipt.numeroNf, serieNf: documentForm.serieNf || receipt.serieNf })
      }
      store.addAttachments(receipt.id, documentForm.files, { category: documentForm.category })
      setDocumentModal(false)
      setDocumentForm({ category: 'Nota Fiscal', numeroNf: '', serieNf: '', files: [] })
      pushToast('Documento anexado', 'O arquivo já está vinculado ao histórico do recebimento.')
    } catch (error) {
      pushToast('Não foi possível anexar', error.message, 'error')
    }
  }

  const saveDivergence = () => {
    try {
      store.addDivergence(receipt.id, divergenceForm)
      setDivergenceModal(false)
      setDivergenceForm({ tipo: 'Quantidade incorreta', itemId: '', descricao: '' })
      pushToast('Divergência registrada', 'O recebimento foi encaminhado para tratamento.')
    } catch (error) {
      pushToast('Não foi possível registrar', error.message, 'error')
    }
  }

  const saveResolution = () => {
    try {
      store.resolveDivergence(receipt.id, resolveTarget.id, resolution)
      setResolveTarget(null)
      setResolution('')
      pushToast('Divergência resolvida', 'A solução ficou registrada na auditoria.')
    } catch (error) {
      pushToast('Não foi possível resolver', error.message, 'error')
    }
  }

  const history = [
    ...(receipt.historicoStatus || []).map((entry) => ({ ...entry, kind: 'status', date: entry.data })),
    ...(receipt.historicoAlteracoes || []).map((entry) => ({ ...entry, kind: 'audit', date: entry.data })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)))

  return (
    <div className="page">
      <button className="detail-back" type="button" onClick={() => navigate(ROUTES.receipts)}><ArrowLeft size={14} /> Voltar aos recebimentos</button>

      <section className="detail-hero">
        <div>
          <div className="detail-title-row"><h1>{receipt.protocolo}</h1><StatusBadge status={receipt.status} /></div>
          <p className="detail-subtitle">{receipt.fornecedor} · Pedido {receipt.pedido || 'não informado'}</p>
          <div className="detail-meta-row">
            <span className="detail-meta"><CalendarDays size={14} /> Recebido em {formatDate(receipt.dataRecebimento, { month: 'long' })}</span>
            <span className="detail-meta"><UserRound size={14} /> {displayResponsible(receipt)}</span>
            <span className="detail-meta"><Paperclip size={14} /> {visibleAttachments.length} anexos</span>
          </div>
        </div>
        <div className="page-actions detail-hero-actions">
          <button className="btn btn-secondary" type="button" onClick={() => setDocumentModal(true)}><Paperclip size={15} /> Anexar</button>
          {receipt.status !== RECEBIMENTO_STATUS.FINALIZADO ? <button className="btn btn-secondary" type="button" onClick={() => setDivergenceModal(true)}><AlertTriangle size={15} /> Divergência</button> : null}
          {primaryAction ? <button className="btn btn-primary" type="button" onClick={primaryAction.onClick}><primaryAction.icon size={16} /> {primaryAction.label}</button> : null}
        </div>
      </section>

      {nfPending ? <div className="info-strip warning detail-warning"><FileClock size={16} /><span><strong>Documentação pendente:</strong> informe o número e anexe a Nota Fiscal antes de finalizar este recebimento.</span><button className="panel-link" type="button" onClick={() => setDocumentModal(true)}>Anexar agora</button></div> : null}
      {receipt.status === RECEBIMENTO_STATUS.FINALIZADO ? <div className="info-strip"><ShieldCheck size={16} /><span>Registro finalizado e protegido. Alterações excepcionais exigem perfil Administrador e permanecem auditadas.</span></div> : null}

      <section className="detail-layout detail-layout-spaced">
        <div className="detail-main">
          <article className="panel">
            <header className="panel-header"><div><h2>Dados gerais</h2><p>Informações que identificam o recebimento</p></div><MoreHorizontal size={18} color="#70848a" /></header>
            <div className="detail-section-body definition-grid">
              <div className="definition-item"><span>Pedido de Compra</span><strong>{receipt.pedido || 'Não informado'}</strong></div>
              <div className="definition-item"><span>Nota Fiscal</span><strong>{receipt.numeroNf ? `${receipt.numeroNf}${receipt.serieNf ? ` · Série ${receipt.serieNf}` : ''}` : 'Pendente'}</strong></div>
              <div className="definition-item"><span>Tipo</span><strong>{receipt.tipo}</strong></div>
              <div className="definition-item"><span>Fornecedor</span><strong>{receipt.fornecedor}</strong></div>
              <div className="definition-item"><span>CNPJ</span><strong>{receipt.cnpjFornecedor || 'Não informado'}</strong></div>
              <div className="definition-item"><span>Última atualização</span><strong>{formatDateTime(receipt.atualizadoEm)}</strong></div>
              <div className="definition-item wide"><span>Observações</span><strong>{receipt.observacoes || 'Nenhuma observação registrada.'}</strong></div>
            </div>
          </article>

          <article className="panel">
            <header className="panel-header"><div><h2>Itens recebidos</h2><p>{receipt.itens?.length || 0} item(ns) vinculado(s) a este pedido</p></div><span className="table-items-count">{receipt.itens?.length || 0}</span></header>
            <div className="detail-items">
              {(receipt.itens || []).map((item, index) => {
                const mismatch = item.quantidadeSolicitada != null && Number(item.quantidadeSolicitada) !== Number(item.quantidadeRecebida)
                return (
                  <div className="detail-item-row" key={item.id || index}>
                    <span className="item-sequence">{index + 1}</span>
                    <div className="detail-item-description"><strong>{item.descricao}</strong><span>Linha {item.numero || '—'} · Código {item.codigo || 'não informado'}</span></div>
                    <div className="item-quantity ordered-quantity"><span>Solicitada</span><strong>{item.quantidadeSolicitada ?? '—'} {item.unidade}</strong></div>
                    <div className="item-quantity"><span>Recebida</span><strong className={mismatch ? 'quantity-alert' : ''}>{item.quantidadeRecebida} {item.unidade}</strong></div>
                    <span>{mismatch ? <AlertTriangle size={16} color="#a63a38" /> : <CheckCircle2 size={16} color="#087c64" />}</span>
                  </div>
                )
              })}
            </div>
          </article>

          <article className="panel">
            <header className="panel-header"><div><h2>Documentos</h2><p>Arquivos vinculados permanentemente ao protocolo</p></div><button className="btn btn-secondary btn-sm" type="button" onClick={() => setDocumentModal(true)}><Plus size={14} /> Adicionar</button></header>
            <div className="detail-section-body">
              <div className="documents-grid">
                {docs.map((file) => (
                  <div className="document-card" key={file.id}>
                    <span className="document-icon"><FileText size={16} /></span>
                    <span className="document-copy"><strong>{file.nome}</strong><span>{file.categoria || file.tipo} · {formatFileSize(file.tamanho)}</span></span>
                    <button className="icon-button" type="button" onClick={() => pushToast('Arquivo demonstrativo', 'A visualização binária será ativada com o armazenamento corporativo.')} aria-label="Visualizar arquivo"><Eye size={15} /></button>
                  </div>
                ))}
                {!docs.some((file) => (file.categoria || file.tipo) === 'Nota Fiscal') ? (
                  <button className="document-card pending" type="button" onClick={() => { setDocumentForm((current) => ({ ...current, category: 'Nota Fiscal' })); setDocumentModal(true) }}>
                    <span className="document-icon"><FileClock size={16} /></span><span className="document-copy"><strong>Nota Fiscal pendente</strong><span>Clique para anexar</span></span><Plus size={15} color="#8c5d0a" />
                  </button>
                ) : null}
                {!docs.length && !nfPending ? <EmptyState icon={FileText} title="Sem documentos" description="Nenhum documento foi anexado ainda." /> : null}
              </div>
            </div>
          </article>

          {photos.length ? (
            <article className="panel">
              <header className="panel-header"><div><h2>Fotos do recebimento</h2><p>Volumes, etiquetas e condições registradas</p></div><button className="btn btn-secondary btn-sm" type="button" onClick={() => { setDocumentForm((current) => ({ ...current, category: 'Foto' })); setDocumentModal(true) }}><Camera size={14} /> Mais fotos</button></header>
              <div className="detail-section-body photo-grid">
                {photos.map((photo) => <div className="photo-card" key={photo.id}>{photo.url ? <img src={photo.url} alt={photo.nome} /> : <div className="photo-placeholder"><ImageIcon size={24} /></div>}<span className="photo-label">{photo.nome}</span></div>)}
              </div>
            </article>
          ) : null}
        </div>

        <aside className="detail-side">
          <article className="panel">
            <header className="panel-header"><div><h2>Divergências</h2><p>{openDivergences.length} aberta(s)</p></div>{receipt.status !== RECEBIMENTO_STATUS.FINALIZADO ? <button className="icon-button" type="button" onClick={() => setDivergenceModal(true)} aria-label="Registrar divergência"><Plus size={16} /></button> : null}</header>
            {(receipt.divergencias || []).length ? (
              <div className="divergence-list">
                {receipt.divergencias.map((divergence) => (
                  <div className={`divergence-card ${divergence.resolvida ? 'resolved' : ''}`} key={divergence.id}>
                    <div className="divergence-head"><strong>{DIVERGENCE_LABELS[divergence.tipo] || divergence.tipo}</strong><span className={`divergence-status ${divergence.resolvida ? 'resolved' : ''}`}>{divergence.resolvida ? 'Resolvida' : 'Aberta'}</span></div>
                    <p>{divergence.descricao}</p>
                    {divergence.resolucao ? <p><strong>Solução:</strong> {divergence.resolucao}</p> : null}
                    <div className="divergence-meta"><span>{formatDateTime(divergence.criadaEm)} · {getActorName(divergence.criadaPor)}</span>{!divergence.resolvida ? <button className="panel-link" type="button" onClick={() => setResolveTarget(divergence)}>Resolver</button> : <CheckCircle2 size={13} />}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={CheckCircle2} title="Sem divergências" description="Nenhuma ocorrência foi registrada neste recebimento." action={receipt.status !== RECEBIMENTO_STATUS.FINALIZADO ? <button className="btn btn-secondary btn-sm" type="button" onClick={() => setDivergenceModal(true)}>Registrar divergência</button> : null} />
            )}
          </article>

          <article className="panel">
            <header className="panel-header"><div><h2>Histórico</h2><p>Rastreabilidade do registro</p></div><History size={17} color="#70848a" /></header>
            <div className="timeline">
              {history.slice(0, 10).map((entry, index) => {
                const isStatus = entry.kind === 'status'
                return (
                  <div className="timeline-item" key={`${entry.id || index}-${entry.kind}`}>
                    <span className="timeline-node">{isStatus ? <RefreshCw size={10} /> : <Check size={10} />}</span>
                    <span className="timeline-copy">
                      <strong>{isStatus ? (entry.de ? `Status alterado para ${entry.para}` : 'Recebimento criado') : entry.acao}</strong>
                      <span>{formatDateTime(entry.date)} · {getActorName(entry.usuario)}</span>
                      {(entry.observacao || entry.detalhes) ? <small>{entry.observacao || entry.detalhes}</small> : null}
                    </span>
                  </div>
                )
              })}
            </div>
          </article>

          {allowedStatuses.length ? (
            <article className="panel workflow-panel">
              <header className="panel-header"><div><h2>Próximas etapas</h2><p>Ações permitidas para seu perfil</p></div></header>
              <div className="workflow-actions">
                {allowedStatuses.map((option) => <button className="btn btn-secondary btn-sm" key={option.value} type="button" onClick={() => tryTransition(option.value, 'Movimentação manual registrada.')}><ArrowRight size={13} /> {option.shortLabel}</button>)}
              </div>
            </article>
          ) : null}
        </aside>
      </section>

      <Modal
        open={documentModal}
        title="Adicionar documento"
        description="O arquivo ficará vinculado ao protocolo e registrado na auditoria."
        onClose={() => setDocumentModal(false)}
        footer={<><button className="btn btn-secondary" type="button" onClick={() => setDocumentModal(false)}>Cancelar</button><button className="btn btn-primary" type="button" onClick={saveDocument}><Upload size={15} /> Anexar arquivo</button></>}
      >
        <div className="form-grid">
          <div className="field field-full"><label>Tipo de documento</label><select value={documentForm.category} onChange={(event) => setDocumentForm((current) => ({ ...current, category: event.target.value }))}>{DOCUMENT_TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></div>
          {documentForm.category === 'Nota Fiscal' ? <><div className="field"><label>Número da NF</label><input value={documentForm.numeroNf || receipt.numeroNf || ''} onChange={(event) => setDocumentForm((current) => ({ ...current, numeroNf: event.target.value }))} placeholder="Ex.: 248913" /></div><div className="field"><label>Série <span className="optional">Opcional</span></label><input value={documentForm.serieNf || receipt.serieNf || ''} onChange={(event) => setDocumentForm((current) => ({ ...current, serieNf: event.target.value }))} placeholder="Ex.: 1" /></div></> : null}
          <div className="field field-full">
            <div className="field-label">Arquivo</div>
            <label className="upload-zone"><Upload size={20} /><strong>Selecionar do dispositivo</strong><span>PDF ou imagem, até 10 MB por arquivo</span><input type="file" multiple={documentForm.category === 'Foto' || documentForm.category === 'Outro'} accept={documentForm.category === 'Foto' ? 'image/*' : 'application/pdf,image/*'} capture={documentForm.category === 'Foto' ? 'environment' : undefined} onChange={(event) => setDocumentForm((current) => ({ ...current, files: Array.from(event.target.files || []) }))} /></label>
            {documentForm.files.length ? <div className="file-list">{documentForm.files.map((file) => <div className="file-row" key={file.name}><span className="file-row-icon"><FileText size={14} /></span><div><strong>{file.name}</strong><span>{formatFileSize(file.size)}</span></div><CheckCircle2 size={15} color="#087c64" /></div>)}</div> : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={divergenceModal}
        title="Registrar divergência"
        description="Descreva o problema para direcionar o tratamento e preservar a evidência."
        onClose={() => setDivergenceModal(false)}
        footer={<><button className="btn btn-secondary" type="button" onClick={() => setDivergenceModal(false)}>Cancelar</button><button className="btn btn-primary" type="button" onClick={saveDivergence}><AlertTriangle size={15} /> Registrar</button></>}
      >
        <div className="form-grid">
          <div className="field"><label>Tipo</label><select value={divergenceForm.tipo} onChange={(event) => setDivergenceForm((current) => ({ ...current, tipo: event.target.value }))}>{DIVERGENCE_TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></div>
          <div className="field"><label>Item afetado <span className="optional">Opcional</span></label><select value={divergenceForm.itemId} onChange={(event) => setDivergenceForm((current) => ({ ...current, itemId: event.target.value }))}><option value="">Recebimento geral</option>{(receipt.itens || []).map((item, index) => <option value={item.id} key={item.id}>{index + 1}. {item.descricao}</option>)}</select></div>
          <div className="field field-full"><label>Descrição <span className="required-hint">Obrigatório</span></label><textarea value={divergenceForm.descricao} onChange={(event) => setDivergenceForm((current) => ({ ...current, descricao: event.target.value }))} placeholder="Descreva o que foi encontrado, a quantidade ou a condição do material..." /></div>
          <div className="info-strip warning field-full"><AlertTriangle size={15} /><span>Se o registro estiver em conferência, ele passará automaticamente para “Divergência identificada”.</span></div>
        </div>
      </Modal>

      <Modal
        open={Boolean(resolveTarget)}
        title="Resolver divergência"
        description={resolveTarget?.descricao}
        onClose={() => setResolveTarget(null)}
        size="sm"
        footer={<><button className="btn btn-secondary" type="button" onClick={() => setResolveTarget(null)}>Cancelar</button><button className="btn btn-primary" type="button" onClick={saveResolution}><CheckCircle2 size={15} /> Marcar como resolvida</button></>}
      >
        <div className="field"><label>Como foi resolvida? <span className="required-hint">Obrigatório</span></label><textarea value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Ex.: fornecedor substituiu as peças e a nova quantidade foi conferida..." /></div>
      </Modal>
    </div>
  )
}

function PendingPage({ receipts }) {
  const docs = receipts.filter((item) => isNfPending(item) && item.status !== RECEBIMENTO_STATUS.DIGITACAO)
  const review = receipts.filter((item) => item.status === RECEBIMENTO_STATUS.CONFERENCIA)
  const divergence = receipts.filter((item) => hasOpenDivergences(item))

  const columns = [
    { key: 'docs', title: 'Documentação pendente', icon: FileClock, items: docs, description: 'Anexar a NF e completar os documentos', action: 'Anexar documentação' },
    { key: 'review', title: 'Aguardando conferência', icon: ClipboardCheck, items: review, description: 'Validar material e documentos recebidos', action: 'Conferir recebimento' },
    { key: 'divergence', title: 'Divergências abertas', icon: AlertTriangle, items: divergence, description: 'Tratar ocorrência e registrar solução', action: 'Revisar divergência' },
  ]

  return (
    <div className="page">
      <PageHeader eyebrow="Fila operacional" title="Pendências" description="Cada cartão mostra o próximo passo necessário para o recebimento avançar.">
        <button className="btn btn-secondary" type="button" onClick={() => navigate(ROUTES.receipts)}><ClipboardList size={16} /> Ver todos</button>
        <button className="btn btn-primary" type="button" onClick={() => navigate(ROUTES.newReceipt)}><Plus size={16} /> Novo recebimento</button>
      </PageHeader>

      <section className="pending-columns">
        {columns.map((column) => {
          const Icon = column.icon
          return (
            <article className="pending-column" key={column.key}>
              <header className="pending-column-header"><span className="pending-column-title"><Icon size={16} /> {column.title}</span><span className="pending-column-count">{column.items.length}</span></header>
              <div className="pending-card-list">
                {column.items.length ? column.items.map((receipt) => (
                  <div className="pending-card" key={receipt.id} role="button" tabIndex={0} onClick={() => navigate(`/recebimentos/${receipt.id}`)} onKeyDown={(event) => event.key === 'Enter' && navigate(`/recebimentos/${receipt.id}`)}>
                    <div className="pending-card-top"><strong>{receipt.protocolo}</strong><StatusBadge status={receipt.status} compact /></div>
                    <h3>{receipt.fornecedor}</h3>
                    <p>{column.description}. Pedido {receipt.pedido || 'não informado'} · recebido {formatDate(receipt.dataRecebimento)}.</p>
                    <div className="next-action"><span>{column.action}</span><ArrowUpRight size={13} /></div>
                  </div>
                )) : <div className="panel"><EmptyState icon={CheckCircle2} title="Fila em dia" description="Nenhum registro nesta etapa." /></div>}
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}

export default function App() {
  const route = useHashRoute()
  const store = useRecebimentosStore()
  const [toasts, setToasts] = useState([])

  const pushToast = (title, message, type = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((current) => [...current, { id, title, message, type }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4400)
  }

  const pendingCount = store.receipts.filter((item) => isNfPending(item) || hasOpenDivergences(item) || item.status === RECEBIMENTO_STATUS.CONFERENCIA).length
  let content

  if (route.path === ROUTES.dashboard) {
    content = <DashboardPage store={store} />
  } else if (route.path === ROUTES.receipts) {
    content = <ReceiptsPage store={store} initialQuery={route.query} />
  } else if (route.path === ROUTES.newReceipt) {
    content = <NewReceiptPage store={store} pushToast={pushToast} />
  } else if (route.path === ROUTES.pending) {
    content = <PendingPage receipts={store.receipts} />
  } else if (route.path.startsWith('/recebimentos/')) {
    const receiptId = decodeURIComponent(route.path.split('/').filter(Boolean)[1] || '')
    content = <DetailPage store={store} receiptId={receiptId} pushToast={pushToast} />
  } else {
    content = <div className="page"><EmptyState icon={CircleAlert} title="Página não encontrada" description="O endereço informado não existe nesta aplicação." action={<button className="btn btn-primary" onClick={() => navigate('/')}>Ir para visão geral</button>} /></div>
  }

  return (
    <>
      <AppShell route={route} pendingCount={pendingCount} currentUser={store.currentUser} onToast={pushToast}>
        {content}
      </AppShell>
      <ToastHost toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </>
  )
}
