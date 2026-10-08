import React, { useState } from 'react'
import { PageHeader } from '../../components/shared/PageHeader.jsx'
import { PortariaStart } from './components/PortariaStart.jsx'
import { ArrivalReview } from './components/ArrivalReview.jsx'
import { ArrivalResult } from './components/ArrivalResult.jsx'
import {
  mockTodayArrivals,
  createMockManualDraft,
  generateCodigo,
  nowLabel,
} from './mockPortariaData.js'
import './portaria.css'

const STAGE_DESCRIPTION = {
  start: 'Identifique a nota fiscal para registrar a chegada.',
  review: 'Revise os dados antes de confirmar a chegada.',
  result: null,
}

/**
 * Primeira versão visual da Portaria. Tudo aqui é local/simulado — nenhuma
 * chamada a backend, Supabase, Sheets ou Drive, e nenhum dado sai deste
 * componente. Integração real (scanner ao vivo, API, persistência) é
 * trabalho de outra tarefa.
 */
export function PortariaPage() {
  const [stage, setStage] = useState('start')
  const [draft, setDraft] = useState(null)
  const [confirmed, setConfirmed] = useState(null)
  const [arrivals, setArrivals] = useState(mockTodayArrivals)

  /**
   * "Selecionar arquivo" e "Fotografar código" já usam o scanner NF-e real
   * (analyzeNfeFile/analyzeNfeKey + scannerBridge.js, chamados em
   * PortariaStart) — `scannerDraft` chega aqui só com os campos que o
   * scanner pode produzir. id/código/status/horário continuam sendo
   * bookkeeping da própria Portaria, igual ao antigo caminho mock.
   */
  function startFromUploadedFile(scannerDraft) {
    setDraft({
      id: `arrival-${Date.now()}`,
      codigo: generateCodigo(),
      status: 'PENDENTE',
      criadoEm: nowLabel(),
      ...scannerDraft,
    })
    setStage('review')
  }

  function startFromManual(chave) {
    setDraft(createMockManualDraft(chave))
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
    setStage('start')
  }

  return (
    <div className="page">
      <PageHeader title="Portaria" description={STAGE_DESCRIPTION[stage]} />

      {stage === 'start' ? (
        <PortariaStart
          arrivals={arrivals}
          onFileAnalyzed={startFromUploadedFile}
          onStartManual={startFromManual}
        />
      ) : null}

      {stage === 'review' && draft ? (
        <ArrivalReview
          arrival={draft}
          onChange={updateDraftField}
          onBack={() => setStage('start')}
          onConfirm={confirmArrival}
        />
      ) : null}

      {stage === 'result' && confirmed ? (
        <ArrivalResult
          arrival={confirmed}
          onRegisterAnother={registerAnother}
          onBackToStart={() => setStage('start')}
        />
      ) : null}
    </div>
  )
}
