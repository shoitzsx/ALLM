import React from 'react'

const percent = (share) => `${Math.round(share * 100)}%`

/**
 * Barras horizontais com rótulo, quantidade e percentual — o mesmo visual das
 * barras de status que a Visão geral já tinha (classes status-bar-row, bar-track, bar-fill).
 * Usada por status, tipo e fornecedores (Almoxarifado) e status das chegadas
 * (Portaria). A barra é proporcional ao maior valor da lista; zero = sem barra.
 * O texto de cada linha já diz tudo para leitor de tela; a barra é decorativa.
 *
 * items: [{ key, label, total, share }]  ·  toneOf(item): sufixo de cor (docs, review, …)
 */
export function BarList({ items, label, toneOf = () => '', unit = 'registro(s)' }) {
  const max = Math.max(0, ...items.map((item) => item.total))
  return (
    <ul className="status-bars bar-list" aria-label={label}>
      {items.map((item) => {
        const tone = toneOf(item)
        const width = max ? (item.total / max) * 100 : 0
        return (
          <li className="status-bar-row" key={item.key}>
            <div className="status-bar-label">
              <span className={`status-dot ${tone ? `dot-${tone}` : ''}`} aria-hidden="true" />
              <span className="bar-list-name" title={item.label}>{item.label}</span>
            </div>
            <div className="bar-track" aria-hidden="true">
              <div className={`bar-fill ${tone ? `fill-${tone}` : ''}`} style={{ width: `${width}%` }} />
            </div>
            <span className="status-count">
              {item.total}
              <span className="bar-list-share"> {percent(item.share)}</span>
              <span className="chart-sr-only"> {unit}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
