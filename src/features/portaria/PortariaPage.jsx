import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { PageHeader } from '../../components/shared/PageHeader.jsx'
import { PortariaDashboard } from './components/PortariaDashboard.jsx'
import { PortariaScanner } from './components/PortariaScanner.jsx'
import { ArrivalReview } from './components/ArrivalReview.jsx'
import { ArrivalResult } from './components/ArrivalResult.jsx'
import {
  mockTodayArrivals,
  generateCodigo,
  nowLabel,
} from './mockPortariaData.js'
import './portaria.css'

const STAGE_DESCRIPTION = {
  dashboard: 'Acompanhe as chegadas de hoje ou registre uma nova.',
  scanner: 'Identifique a nota fiscal para registrar a chegada.',
  review: 'Revise os dados antes de confirmar a chegada.',
  result: null,
}

/**
 * Primeira versão visual da Portaria. Tudo aqui é local/simulado — nenhuma
 * chamada a backend, Supabase, Sheets ou Drive, e nenhum dado sai deste
 * componente. Integração real (scanner ao vivo, API, persistência) é
 * trabalho de outra tarefa.
 *
 * Fluxo: dashboard (chegadas de hoje) -> "Nova chegada" -> scanner (único,
 * visualmente igual à Leitura automática de NF-e) -> revisão -> confirmação
 * -> resultado (CHG mock). Cria chegada, nunca RECEBIMENTO — não usa
 * receiptHandoff.js nem navega para "Novo recebimento".
 */
export function PortariaPage() {
  const [stage, setStage] = useState('dashboard')
  const [draft, setDraft] = useState(null)
  const [confirmed, setConfirmed] = useState(null)
  const [arrivals, setArrivals] = useState(mockTodayArrivals)

  /**
   * "Selecionar arquivo", "Fotografar código" e "Digitar chave manualmente"
   * já usam o scanner NF-e real (analyzeNfeFile/analyzeNfeKey +
   * scannerBridge.js, chamados em PortariaScanner) — `scannerDraft` chega
   * aqui só com os campos que o scanner pode produzir. id/código/status/
   * horário continuam sendo bookkeeping da própria Portaria.
   */
  function startFromScanner(scannerDraft) {
    setDraft({
      id: `arrival-${Date.now()}`,
      codigo: generateCodigo(),
      status: 'PENDENTE',
      criadoEm: nowLabel(),
      ...scannerDraft,
    })
    setStage('review')
  }

  function updateDraftField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function confirmArrival() {
    const finalized = { ...draft, status: 'REGISTRADA', criadoEm: draft.criadoEm || nowLabel() }
    setConfirmed(finalized)
    setArrivals((current) => [finalized, ...current])
    setStage('result')
  }

  function registerAnother() {
    setDraft(null)
    setConfirmed(null)
    setStage('scanner')
  }

  return (
    <div className="page">
      <PageHeader title="Portaria" description={STAGE_DESCRIPTION[stage]}>
        {stage === 'dashboard' ? (
          <button type="button" className="btn btn-primary" onClick={() => setStage('scanner')}>
            <Plus size={16} /> Nova chegada
          </button>
        ) : null}
      </PageHeader>

      {stage === 'dashboard' ? <PortariaDashboard arrivals={arrivals} /> : null}

      {stage === 'scanner' ? <PortariaScanner onFileAnalyzed={startFromScanner} /> : null}

      {stage === 'review' && draft ? (
        <ArrivalReview
          arrival={draft}
          onChange={updateDraftField}
          onBack={() => setStage('scanner')}
          onConfirm={confirmArrival}
        />
      ) : null}

      {stage === 'result' && confirmed ? (
        <ArrivalResult
          arrival={confirmed}
          onRegisterAnother={registerAnother}
          onBackToStart={() => setStage('dashboard')}
        />
      ) : null}
    </div>
  )
}
