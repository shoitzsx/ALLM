import React, { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, ClipboardList, FileQuestion, Hourglass } from 'lucide-react'
import { KpiItem } from '../../../components/dashboard/KpiStrip.jsx'
import { BarList } from '../../../components/dashboard/BarList.jsx'
import { STATUS_META } from '../mockPortariaData.js'
import { summarizeArrivals } from '../portariaMetrics.js'

function ArrivalStatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.PENDENTE
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

/**
 * Painel do dia — indicadores, situação e atenção calculados da lista de
 * chegadas em memória (simulada nesta fase, inclusive as confirmadas na
 * sessão). Iniciar uma nova chegada continua sendo o botão "Nova chegada" /
 * item "Registrar chegada" (rota /portaria/registrar, ver PortariaPage.jsx).
 */
export function PortariaDashboard({ arrivals }) {
  const summary = useMemo(() => summarizeArrivals(arrivals), [arrivals])

  return (
    <>
      <p className="portaria-sim-note">
        <CircleDashed size={13} aria-hidden="true" />
        <strong>Simulação</strong> Indicadores calculados da lista desta sessão — não são registros oficiais.
      </p>

      <section className="kpi-strip" aria-label="Indicadores simulados da Portaria">
        <KpiItem icon={ClipboardList} value={summary.total} label="Chegadas na lista" />
        <KpiItem icon={CheckCircle2} value={summary.registradas} label="Registradas" tone="blue" />
        <KpiItem icon={Hourglass} value={summary.pendentes} label="Pendentes" tone="amber" />
        <KpiItem icon={FileQuestion} value={summary.semNf} label="Sem NF identificada" tone="red" />
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-column">
          <section className="panel">
            <header className="panel-header">
              <div>
                <h2>Chegadas de hoje</h2>
                <p>Registros simulados — nenhuma integração real ainda.</p>
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
                    <span className="portaria-arrival-hora">Registro {arrival.criadoEm}</span>
                    <ArrivalStatusChip status={arrival.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="portaria-empty">Nenhuma chegada na lista desta sessão.</p>
            )}
          </section>
        </div>

        <div className="dashboard-column">
          <section className="panel">
            <header className="panel-header">
              <div>
                <h2>Situação das chegadas</h2>
                <p>Distribuição da lista simulada por situação</p>
              </div>
            </header>
            <BarList items={summary.porStatus} label="Chegadas simuladas por situação" toneOf={(item) => BAR_TONE[item.tone]} unit="chegada(s)" />
            {summary.statusDesconhecido ? <p className="chart-note">{summary.statusDesconhecido} chegada(s) com situação desconhecida.</p> : null}
          </section>

          <section className="panel">
            <header className="panel-header">
              <div>
                <h2>Requer atenção</h2>
                <p>Pendentes ou sem NF identificada</p>
              </div>
            </header>
            {summary.atencao.length ? (
              <ul className="portaria-attention-list">
                {summary.atencao.map((arrival) => (
                  <li key={arrival.id}>
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span>
                      <strong>{arrival.codigo}</strong> · {arrival.fornecedor || 'Fornecedor não informado'}
                      <small>{[arrival.status === 'PENDENTE' ? 'Pendente' : null, String(arrival.numeroNf ?? '').trim() ? null : 'Sem NF'].filter(Boolean).join(' · ')}</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="portaria-empty">Nenhuma chegada pendente ou sem NF.</p>
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
