import React from 'react'
import { Download, Filter, Search, X } from 'lucide-react'
import { RECEIPT_TYPE_OPTIONS, STATUS_OPTIONS } from '../../data.js'

export function FilterBar({
  filters,
  setFilter,
  clearFilters,
  activeCount,
  filtersOpen,
  setFiltersOpen,
  suppliers,
  responsibles,
  sortDirection,
  setSortDirection,
  totalCount,
  filteredCount,
  onExport,
  autoFocusSearch,
}) {
  return (
    <>
      <div className="table-toolbar">
        <div className="list-search">
          <Search size={16} />
          <input
            autoFocus={autoFocusSearch}
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
          <input type="checkbox" checked={Boolean(filters.nfPendente)} onChange={(event) => setFilter('nfPendente', event.target.checked || '')} />
          NF pendente
        </label>
        <button className="btn btn-secondary" type="button" onClick={() => setFiltersOpen((open) => !open)}>
          <Filter size={15} /> Filtros {activeCount ? `(${activeCount})` : ''}
        </button>
        <button className="icon-button" type="button" onClick={onExport} aria-label="Exportar CSV"><Download size={17} /></button>
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
            <span>{filteredCount} registro(s) encontrado(s)</span>
            <button className="btn btn-ghost btn-sm" type="button" onClick={clearFilters}>Limpar filtros</button>
          </div>
        </div>
      ) : null}

      <div className="active-filter-bar">
        <span><strong>{filteredCount}</strong> de {totalCount} recebimentos</span>
        {filters.search ? <span className="filter-chip">Busca: {filters.search}<button type="button" onClick={() => setFilter('search', '')}><X size={11} /></button></span> : null}
        {activeCount ? <button className="panel-link" type="button" onClick={clearFilters}>Limpar tudo</button> : null}
        <button className="panel-link sort-link" type="button" onClick={() => setSortDirection((direction) => direction === 'desc' ? 'asc' : 'desc')}>
          Data {sortDirection === 'desc' ? 'mais recente' : 'mais antiga'}
        </button>
      </div>
    </>
  )
}
