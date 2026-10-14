import React from 'react'
import { STATUS_META } from '../mockPortariaData.js'

function ArrivalStatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.PENDENTE
  return <span className={`portaria-chip portaria-chip-${meta.tone}`}>{meta.label}</span>
}

/**
 * Tela inicial da Portaria — não é mais um dos três scanners, é um painel
 * com as chegadas do dia. Iniciar uma nova chegada é uma ação explícita
 * (botão "Nova chegada" no PageHeader, ver PortariaPage.jsx), que leva ao
 * scanner consolidado (PortariaScanner.jsx).
 */
export function PortariaDashboard({ arrivals }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>Chegadas de hoje</h2>
          <p>Registros simulados — nenhuma integração real ainda.</p>
        </div>
      </header>
      <ul className="portaria-arrival-list">
        {arrivals.map((arrival) => (
          <li className="portaria-arrival-item" key={arrival.id}>
            <span className="portaria-arrival-codigo">{arrival.codigo}</span>
            <span className="portaria-arrival-nf">NF {arrival.numeroNf || '— pendente'}</span>
            <span className="portaria-arrival-fornecedor">{arrival.fornecedor}</span>
            <span className="portaria-arrival-hora">{arrival.criadoEm}</span>
            <ArrivalStatusChip status={arrival.status} />
          </li>
        ))}
      </ul>
    </section>
  )
}
