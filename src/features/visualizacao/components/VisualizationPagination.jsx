import React from 'react'

const PAGE_SIZE_OPTIONS = [10, 25, 50]

export function VisualizationPagination({ page, totalPages, totalRows, pageSize, onPageChange, onPageSizeChange }) {
  if (!totalRows) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalRows)

  return (
    <footer className="pagination viz-pagination">
      <span>
        Mostrando {start}–{end} de {totalRows}
      </span>

      <label className="viz-page-size">
        Linhas por página
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <div className="pagination-controls">
        <button className="page-number" type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Página anterior">
          ‹
        </button>
        <button className="page-number active" type="button" aria-current="page">
          {page}
        </button>
        <span className="viz-page-of">de {totalPages}</span>
        <button className="page-number" type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Próxima página">
          ›
        </button>
      </div>
    </footer>
  )
}
