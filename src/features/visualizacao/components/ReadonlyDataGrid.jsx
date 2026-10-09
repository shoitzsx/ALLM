import React, { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Check, Copy, RefreshCw, Search } from 'lucide-react'
import { EmptyState, formatDate, formatDateTime, formatFileSize } from '../../../ui.jsx'

function VizChip({ value, tone = 'neutral', label }) {
  return <span className={`viz-chip viz-chip-${tone}`}>{label ?? String(value)}</span>
}

function BooleanChip({ value }) {
  return <VizChip value={value} tone={value ? 'success' : 'neutral'} label={value ? 'Sim' : 'Não'} />
}

function renderCellValue(row, column) {
  const raw = row[column.key]
  switch (column.type) {
    case 'date':
      return raw ? formatDate(raw) : '—'
    case 'datetime':
      return raw ? formatDateTime(raw) : '—'
    case 'filesize':
      return formatFileSize(Number(raw) || 0)
    case 'boolean':
      return <BooleanChip value={Boolean(raw)} />
    case 'badge': {
      const tone = (column.badgeTones && column.badgeTones[raw]) || 'neutral'
      const label = (column.badgeLabels && column.badgeLabels[raw]) || String(raw ?? '—')
      return <VizChip value={raw} tone={tone} label={label} />
    }
    default:
      return raw === '' || raw === null || raw === undefined ? '—' : String(raw)
  }
}

function SortButton({ column, sort, onSortChange }) {
  const active = sort?.key === column.key
  const direction = active ? sort.direction : null
  function handleClick() {
    if (!active) return onSortChange({ key: column.key, direction: 'asc', type: column.type })
    if (direction === 'asc') return onSortChange({ key: column.key, direction: 'desc', type: column.type })
    return onSortChange(null)
  }
  return (
    <button type="button" className="viz-sort-button" onClick={handleClick}>
      {column.label}
      {active ? (direction === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
    </button>
  )
}

/**
 * Grid genérico, somente leitura — uma única implementação de tabela
 * dirigida pela configuração de colunas de cada aba (ver TABS em
 * mockVisualizationData.js), em vez de uma tabela bespoke por aba.
 */
export function ReadonlyDataGrid({ state, columns, rows, sort, onSortChange, showTechnicalId, idField, primaryKeyField, onClearFilters, onRetry }) {
  const [copiedId, setCopiedId] = useState(null)

  function handleCopy(row) {
    const value = String(row[primaryKeyField] ?? row[idField] ?? '')
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopiedId(row[idField])
    window.setTimeout(() => setCopiedId((current) => (current === row[idField] ? null : current)), 1200)
  }

  if (state === 'loading') {
    return <EmptyState icon={RefreshCw} iconClassName="spin" title="Carregando dados…" description="Buscando os dados mock desta aba." />
  }

  if (state === 'error') {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Não foi possível carregar os dados"
        description="Isto é uma simulação local de erro, só para validar o estado visual. Tente atualizar novamente."
        action={
          <button className="btn btn-secondary" type="button" onClick={onRetry}>
            Tentar novamente
          </button>
        }
      />
    )
  }

  if (!rows.length) {
    return (
      <EmptyState
        icon={Search}
        title="Nenhum registro encontrado"
        description="Tente remover alguns filtros ou pesquisar por outro termo."
        action={
          <button className="btn btn-secondary" type="button" onClick={onClearFilters}>
            Limpar filtros
          </button>
        }
      />
    )
  }

  return (
    <div className="table-scroll viz-table-scroll">
      <table className="data-table viz-data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} aria-sort={sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} style={column.align === 'right' ? { textAlign: 'right' } : undefined}>
                <SortButton column={column} sort={sort} onSortChange={onSortChange} />
              </th>
            ))}
            {showTechnicalId ? <th>ID técnico</th> : null}
            <th className="viz-action-col">
              <span className="sr-only-label">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[idField] || row[primaryKeyField]}>
              {columns.map((column) => {
                const content = renderCellValue(row, column)
                const isTextual = typeof content === 'string'
                const truncateStyle = column.truncate ? { maxWidth: `${column.truncate}ch` } : undefined
                return (
                  <td key={column.key} className={column.type === 'mono' ? 'viz-mono' : ''} style={{ ...(column.align === 'right' ? { textAlign: 'right' } : null), ...truncateStyle }}>
                    {column.truncate && isTextual ? (
                      <span className="viz-truncate" title={content}>
                        {content}
                      </span>
                    ) : (
                      content
                    )}
                  </td>
                )
              })}
              {showTechnicalId ? <td className="viz-mono viz-id-col">{row[idField]}</td> : null}
              <td className="viz-action-col">
                <button className="icon-button" type="button" onClick={() => handleCopy(row)} aria-label={`Copiar ${row[primaryKeyField] ?? row[idField]}`}>
                  {copiedId === row[idField] ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
