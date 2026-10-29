import React, { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/shared/PageHeader.jsx'
import { ReadonlyBanner } from './components/ReadonlyBanner.jsx'
import { VisualizationTabs } from './components/VisualizationTabs.jsx'
import { VisualizationToolbar } from './components/VisualizationToolbar.jsx'
import { ReadonlyDataGrid } from './components/ReadonlyDataGrid.jsx'
import { VisualizationPagination } from './components/VisualizationPagination.jsx'
import { TABS } from './mockVisualizationData.js'
import { localDateIso } from './visualizationUtils.js'
import { api } from '../../api.js'
import { useAuth } from '../auth/AuthProvider.jsx'
import './visualizacao.css'

const EMPTY_FILTERS = { search: '', status: '', periodoInicio: '', periodoFim: '' }

function nowLabel() {
  const now = new Date()
  return `Atualizado agora às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Download local via Blob/URL nativos do navegador — sem biblioteca nenhuma. */
function downloadCsv(filename, blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function VisualizacaoPage() {
  const { user } = useAuth()
  const tabs = useMemo(() => TABS.filter((tab) => {
    const required = tab.id === 'usuarios' || tab.id === 'auditoria' ? 'usuarios.read'
      : tab.id === 'chegadas' ? 'chegadas.read'
        : tab.id === 'anexos' ? 'anexos.read' : 'recebimentos.read'
    return user?.permissoes?.includes(required)
  }), [user])
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id || 'recebimentos')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [showTechnicalId, setShowTechnicalId] = useState(false)
  const [loadState, setLoadState] = useState('loading')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState(nowLabel())
  const [rows, setRows] = useState([])
  const [totalRows, setTotalRows] = useState(0)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) || tabs[0] || TABS[0], [tabs, activeTabId])

  useEffect(() => {
    if (tabs.length && !tabs.some((tab) => tab.id === activeTabId)) setActiveTabId(tabs[0].id)
  }, [tabs, activeTabId])

  // Trocar de aba começa do zero: outra aba tem outras colunas e outro
  // vocabulário de status/período — manter filtro antigo aplicado à aba
  // nova não faria sentido.
  useEffect(() => {
    setFilters(EMPTY_FILTERS)
    setSort(null)
    setPage(1)
  }, [activeTabId])

  const params = useMemo(() => ({
    page: String(page), pageSize: String(pageSize),
    search: filters.search, status: filters.status,
    periodoInicio: filters.periodoInicio, periodoFim: filters.periodoFim,
    ...(sort ? { sortKey: sort.key, sortDirection: sort.direction } : {}),
  }), [page, pageSize, filters, sort])

  useEffect(() => {
    let active = true
    setLoadState('loading')
    api.visualizacao(activeTabId, params).then((result) => {
      if (!active) return
      setRows(result.data || [])
      setTotalRows(result.pagination?.total || 0)
      setLoadState('data')
      setError('')
      setLastUpdatedLabel(nowLabel())
    }).catch((cause) => {
      if (!active) return
      setLoadState('error')
      setError(cause.message || 'Não foi possível carregar os dados.')
    }).finally(() => { if (active) setRefreshing(false) })
    return () => { active = false }
  }, [activeTabId, params, refreshToken])

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

  const hasActiveFilters = Boolean(filters.search || filters.status || filters.periodoInicio || filters.periodoFim)

  function setFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
    setPage(1)
  }

  function handleRefresh() {
    setRefreshing(true)
    setRefreshToken((value) => value + 1)
  }

  async function handleExportCsv() {
    try {
      const blob = await api.exportarVisualizacao(activeTab.id, params)
      downloadCsv(`alm-${activeTab.id}-${localDateIso()}.csv`, blob)
      setError('')
    } catch (cause) {
      setError(cause.message || 'Não foi possível exportar o CSV.')
    }
  }

  return (
    <div className="page">
      <PageHeader title="Visualização" description="Consulte os dados registrados no ALM.">
      </PageHeader>

      {error ? <div role="alert" className="info-strip warning">{error}</div> : null}

      <ReadonlyBanner />

      <VisualizationTabs tabs={tabs} activeTabId={activeTabId} onChange={setActiveTabId} />

      <section className="panel viz-panel">
        <VisualizationToolbar
          search={filters.search}
          onSearchChange={(value) => setFilter('search', value)}
          statusOptions={activeTab.statusOptions}
          statusValue={filters.status}
          onStatusChange={(value) => setFilter('status', value)}
          hasPeriodo={Boolean(activeTab.periodoField)}
          periodoInicio={filters.periodoInicio}
          periodoFim={filters.periodoFim}
          onPeriodoInicioChange={(value) => setFilter('periodoInicio', value)}
          onPeriodoFimChange={(value) => setFilter('periodoFim', value)}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          resultCount={totalRows}
          totalCount={totalRows}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          lastUpdatedLabel={lastUpdatedLabel}
          onExportCsv={handleExportCsv}
          showTechnicalId={showTechnicalId}
          onToggleTechnicalId={setShowTechnicalId}
        />

        <ReadonlyDataGrid
          state={loadState}
          columns={activeTab.columns}
          rows={rows}
          sort={sort}
          onSortChange={setSort}
          showTechnicalId={showTechnicalId}
          idField={activeTab.idField}
          primaryKeyField={activeTab.primaryKeyField}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          onRetry={handleRefresh}
        />

        {loadState === 'data' ? (
          <VisualizationPagination
            page={page}
            totalPages={totalPages}
            totalRows={totalRows}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
          />
        ) : null}
      </section>
    </div>
  )
}
