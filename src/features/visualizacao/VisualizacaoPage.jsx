import React, { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/shared/PageHeader.jsx'
import { ReadonlyBanner } from './components/ReadonlyBanner.jsx'
import { VisualizationTabs } from './components/VisualizationTabs.jsx'
import { VisualizationToolbar } from './components/VisualizationToolbar.jsx'
import { ReadonlyDataGrid } from './components/ReadonlyDataGrid.jsx'
import { VisualizationPagination } from './components/VisualizationPagination.jsx'
import { TABS } from './mockVisualizationData.js'
import { getFilteredRows, sortRows, paginate, clampPage, buildCsv, localDateIso } from './visualizationUtils.js'
import './visualizacao.css'

const EMPTY_FILTERS = { search: '', status: '', periodoInicio: '', periodoFim: '' }

function nowLabel() {
  const now = new Date()
  return `Atualizado agora às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Download local via Blob/URL nativos do navegador — sem biblioteca nenhuma. */
function downloadCsv(filename, csvText) {
  const blob = new Blob([`﻿${csvText}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Primeira versão da Visualização — consulta somente-leitura, 100% mock.
 * Substitui, no produto final, a necessidade de abrir o Google Sheets para
 * consultar dados; aqui ainda não existe nenhuma chamada real: tudo vem de
 * mockVisualizationData.js. Filtros/paginação/exportação server-side,
 * integração com a API e com o Supabase são trabalho futuro do Goran/Kobner.
 */
export function VisualizacaoPage() {
  const [activeTabId, setActiveTabId] = useState(TABS[0].id)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [showTechnicalId, setShowTechnicalId] = useState(false)
  const [loadState, setLoadState] = useState('data')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState(nowLabel())
  const [devForceError, setDevForceError] = useState(false)

  const activeTab = useMemo(() => TABS.find((tab) => tab.id === activeTabId) || TABS[0], [activeTabId])

  // Trocar de aba começa do zero: outra aba tem outras colunas e outro
  // vocabulário de status/período — manter filtro antigo aplicado à aba
  // nova não faria sentido.
  useEffect(() => {
    setFilters(EMPTY_FILTERS)
    setSort(null)
    setPage(1)
  }, [activeTabId])

  const filteredRows = useMemo(() => getFilteredRows(activeTab, filters), [activeTab, filters])
  const sortedRows = useMemo(() => sortRows(filteredRows, sort), [filteredRows, sort])

  // Página atual pode deixar de existir depois de um filtro mais restritivo
  // — nunca mostrar uma página "fantasma".
  useEffect(() => {
    setPage((current) => clampPage(current, sortedRows.length, pageSize))
  }, [sortedRows.length, pageSize])

  const pageRows = useMemo(() => paginate(sortedRows, page, pageSize), [sortedRows, page, pageSize])
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))

  const hasActiveFilters = Boolean(filters.search || filters.status || filters.periodoInicio || filters.periodoFim)

  function setFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
  }

  function handleRefresh() {
    setRefreshing(true)
    // Mock: só simula um breve carregamento, sem request real nenhum — os
    // dados continuam exatamente os mesmos, como pedido para esta etapa.
    window.setTimeout(() => {
      setRefreshing(false)
      setLoadState(devForceError ? 'error' : 'data')
      setLastUpdatedLabel(nowLabel())
    }, 450)
  }

  function handleExportCsv() {
    // Protótipo de frontend: exporta os mesmos dados mock já filtrados/
    // ordenados em tela. Produção: a exportação real será fornecida pelo
    // backend (Goran), garantindo autorização, volume e consistência com a
    // fonte de verdade — isto aqui nunca deve ser considerado definitivo.
    const csv = buildCsv(activeTab.columns, sortedRows)
    downloadCsv(`alm-${activeTab.id}-${localDateIso()}.csv`, csv)
  }

  return (
    <div className="page">
      <PageHeader title="Visualização" description="Consulte os dados registrados no ALM.">
        {import.meta.env.DEV ? (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            title="Só em desenvolvimento — alterna o estado de erro simulado"
            onClick={() => setDevForceError((current) => !current)}
          >
            {devForceError ? 'Dev: erro ligado' : 'Dev: simular erro'}
          </button>
        ) : null}
      </PageHeader>

      <ReadonlyBanner />

      <VisualizationTabs tabs={TABS} activeTabId={activeTabId} onChange={setActiveTabId} />

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
          resultCount={sortedRows.length}
          totalCount={activeTab.rows.length}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          lastUpdatedLabel={lastUpdatedLabel}
          onExportCsv={handleExportCsv}
          showTechnicalId={showTechnicalId}
          onToggleTechnicalId={setShowTechnicalId}
        />

        <ReadonlyDataGrid
          state={refreshing ? 'loading' : loadState}
          columns={activeTab.columns}
          rows={pageRows}
          sort={sort}
          onSortChange={setSort}
          showTechnicalId={showTechnicalId}
          idField={activeTab.idField}
          primaryKeyField={activeTab.primaryKeyField}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          onRetry={handleRefresh}
        />

        {loadState === 'data' && !refreshing ? (
          <VisualizationPagination
            page={page}
            totalPages={totalPages}
            totalRows={sortedRows.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(value) => { setPageSize(value); setPage(1) }}
          />
        ) : null}
      </section>
    </div>
  )
}
