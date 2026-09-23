import React from 'react'
import { AlertTriangle, Boxes, FileClock, PackageOpen } from 'lucide-react'

function KpiItem({ icon: Icon, value, label, tone = '', meta }) {
  return (
    <div className={`kpi-item ${tone ? `kpi-${tone}` : ''}`}>
      <span className="kpi-icon"><Icon size={16} /></span>
      <div className="kpi-copy">
        <p className="kpi-label">{label}</p>
        <div className="kpi-value">{value}</div>
        {meta ? <p className="kpi-meta">{meta}</p> : null}
      </div>
    </div>
  )
}

export function KpiStrip({ metrics }) {
  return (
    <section className="kpi-strip" aria-label="Indicadores gerais">
      <KpiItem icon={PackageOpen} value={metrics.totalRecebimentos} label="Total de recebimentos" />
      <KpiItem icon={Boxes} value={metrics.materiaisHoje} label="Materiais recebidos hoje" tone="blue" meta={`${metrics.recebimentosHoje} recebimento(s) hoje`} />
      <KpiItem icon={FileClock} value={metrics.documentacaoPendente} label="Documentações pendentes" tone="amber" />
      <KpiItem icon={AlertTriangle} value={metrics.divergenciasAbertas} label="Divergências abertas" tone="red" />
    </section>
  )
}
