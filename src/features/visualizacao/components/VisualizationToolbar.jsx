import React from 'react'
import { Download, RefreshCw, Search, X } from 'lucide-react'

export function VisualizationToolbar({
  search,
  onSearchChange,
  statusOptions,
  statusValue,
  onStatusChange,
  hasPeriodo,
  periodoInicio,
  periodoFim,
  onPeriodoInicioChange,
  onPeriodoFimChange,
  hasActiveFilters,
  onClearFilters,
  resultCount,
  totalCount,
  onRefresh,
  refreshing,
  lastUpdatedLabel,
  onExportCsv,
  showTechnicalId,
  onToggleTechnicalId,
}) {
  return (
    <>
      <div className="table-toolbar viz-toolbar">
        <div className="list-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Pesquisar nesta aba"
            aria-label="Pesquisar"
          />
          {search ? (
            <button className="search-clear" type="button" onClick={() => onSearchChange('')} aria-label="Limpar pesquisa">
              <X size={14} />
            </button>
          ) : null}
        </div>

        {statusOptions?.length ? (
          <select className="filter-select" value={statusValue} onChange={(event) => onStatusChange(event.target.value)} aria-label="Filtrar por status">
            <option value="">Todos os status</option>
            {statusOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}

        {hasPeriodo ? (
          <div className="viz-period-filter">
            <input type="date" value={periodoInicio} onChange={(event) => onPeriodoInicioChange(event.target.value)} aria-label="Data inicial" />
            <span>até</span>
            <input type="date" value={periodoFim} onChange={(event) => onPeriodoFimChange(event.target.value)} aria-label="Data final" />
          </div>
        ) : null}

        {hasActiveFilters ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClearFilters}>
            Limpar filtros
          </button>
        ) : null}

        <label className="filter-toggle">
          <input type="checkbox" checked={showTechnicalId} onChange={(event) => onToggleTechnicalId(event.target.checked)} />
          Mostrar ID técnico
        </label>

        <div className="viz-toolbar-actions">
          <button className="btn btn-secondary btn-sm" type="button" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Atualizar
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onExportCsv}>
            <Download size={14} /> Exportar CSV
          </button>
        </div>
      </div>

      <div className="active-filter-bar viz-result-bar">
        <span>
          <strong>{resultCount}</strong> de {totalCount} registro(s)
        </span>
        <span className="viz-last-updated">{lastUpdatedLabel}</span>
      </div>
    </>
  )
}
