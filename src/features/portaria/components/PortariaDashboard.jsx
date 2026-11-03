import React, { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, FileQuestion, Hourglass } from 'lucide-react'
import { KpiItem } from '../../../components/dashboard/KpiStrip.jsx'
import { BarList } from '../../../components/dashboard/BarList.jsx'
import { STATUS_META, summarizeArrivals } from '../portariaMetrics.js'

function ArrivalStatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status || 'Desconhecido', tone: 'warning' }
  return <span className={`portaria-chip portaria-chip-${meta.tone}`}>{meta.label}</span>
}

// Tom da barra a partir do tom do chip (mesmas cores de status do sistema).
const BAR_TONE = { success: 'finalized', warning: 'docs', danger: 'divergence' }

// O que o painel definitivo vai precisar e que o modelo atual NÃO tem. Mostrado
// como texto (sem número) para não parecer indicador calculado.
const PENDING_INTEGRATION = [
  { label: 'Entregas previstas e horário estimado', needs: 'fonte de agendamento (pedido, transportadora ou cadastro)' },
  { label: 'Veículos aguardando atendimento', needs: 'eventos de chegada real, início de atendimento e saída' },
  { label: 'Tempo médio de espera', needs: 'início do atendimento − chegada real, com data e hora' },
  { label: 'Tempo médio de permanência', needs: 'saída real − chegada real, com data e hora' },
]

export function PortariaDashboard({ arrivals, canStartReceipt = false, onStartReceipt }) {
  const summary = useMemo(() => summarizeArrivals(arrivals), [arrivals])

  return (
    <>
      <section className="kpi-strip" aria-label="Indicadores da Portaria">
        <KpiItem icon={ClipboardList} value={summary.total} label="Chegadas na lista" />
        <KpiItem icon={Hourglass} value={summary.registradas} label="Aguardando REC" tone="amber" />
        <KpiItem icon={CheckCircle2} value={summary.vinculadas} label="Vinculadas" tone="blue" />
        <KpiItem icon={FileQuestion} value={summary.semNf} label="Sem NF identificada" tone="red" />
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-column">
          <section className="panel">
            <header className="panel-header">
              <div>
                <h2>Chegadas recentes</h2>
                <p>Registros persistidos no ALM.</p>
              </div>
            </header>
            {arrivals.length ? (
              <ul className="portaria-arrival-list">
                {arrivals.map((arrival) => (
                  <li className="portaria-arrival-item" key={arrival.id}>
                    <span className="portaria-arrival-codigo">{arrival.codigo}</span>
                    <span className="portaria-arrival-nf">NF {arrival.numeroNf || '— pendente'}</span>
                    <span className="portaria-arrival-fornecedor">{arrival.fornecedor}</span>
                    {/* criadoEm = hora em que o registro foi iniciado na tela, não a chegada do veículo. */}
                    <span className="portaria-arrival-hora">Registro {new Date(arrival.criadoEm).toLocaleString('pt-BR')}</span>
                    <ArrivalStatusChip status={arrival.status} />
                    {canStartReceipt && arrival.status === 'REGISTRADA' ? (
                      <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => onStartReceipt?.(arrival)}>Iniciar recebimento</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="portaria-empty">Nenhuma chegada registrada.</p>
            )}
          </section>
        </div>

        <div className="dashboard-column">
          <section className="panel">
            <header className="panel-header">
              <div>
                <h2>Situação das chegadas</h2>
                <p>Distribuição dos registros carregados por situação</p>
              </div>
            </header>
            <BarList items={summary.porStatus} label="Chegadas por situação" toneOf={(item) => BAR_TONE[item.tone]} unit="chegada(s)" />
            {summary.statusDesconhecido ? <p className="chart-note">{summary.statusDesconhecido} chegada(s) com situação desconhecida.</p> : null}
          </section>

          <section className="panel">
            <header className="panel-header">
              <div>
                <h2>Requer atenção</h2>
                <p>Sem recebimento ou sem NF identificada</p>
              </div>
            </header>
            {summary.atencao.length ? (
              <ul className="portaria-attention-list">
                {summary.atencao.map((arrival) => (
                  <li key={arrival.id}>
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span>
                      <strong>{arrival.codigo}</strong> · {arrival.fornecedor || 'Fornecedor não informado'}
                      <small>{[arrival.status === 'REGISTRADA' ? 'Aguardando REC' : null, String(arrival.numeroNf ?? '').trim() ? null : 'Sem NF'].filter(Boolean).join(' · ')}</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="portaria-empty">Nenhuma chegada sem recebimento ou NF.</p>
            )}
          </section>
        </div>
      </div>

      <section className="panel portaria-pending-integration" aria-labelledby="portaria-pending-title">
        <header className="panel-header">
          <div>
            <h2 id="portaria-pending-title">Dependem de integração</h2>
            <p>Ainda sem dados: aparecem quando o backend registrar os eventos abaixo.</p>
          </div>
        </header>
        <dl>
          {PENDING_INTEGRATION.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>Requer {entry.needs}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
