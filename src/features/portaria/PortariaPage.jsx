import React, { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { PageHeader } from '../../components/shared/PageHeader.jsx'
import { ROUTES, navigate } from '../../layout/navigation.js'
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
 *
 * Rotas: /portaria é o painel; /portaria/registrar é o registro (scanner ->
 * revisão -> resultado, ainda em estado interno). `registering` vem da rota:
 * entrar em /portaria/registrar abre o scanner, e voltar para /portaria
 * (menu, botão Voltar do navegador) volta ao painel descartando o rascunho.
 */
export function PortariaPage({ registering = false }) {
  const [stage, setStage] = useState(registering ? 'scanner' : 'dashboard')
  const [draft, setDraft] = useState(null)
  const [confirmed, setConfirmed] = useState(null)
  const [arrivals, setArrivals] = useState(mockTodayArrivals)

  useEffect(() => {
    if (registering) {
      setStage((current) => (current === 'dashboard' ? 'scanner' : current))
    } else {
      setStage('dashboard')
      setDraft(null)
      setConfirmed(null)
    }
  }, [registering])

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
      <PageHeader title={registering ? 'Registrar chegada' : 'Painel do dia'} description={STAGE_DESCRIPTION[stage]}>
        {stage === 'dashboard' ? (
          <button type="button" className="btn btn-primary" onClick={() => navigate(ROUTES.portariaRegistrar)}>
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
          onBackToStart={() => navigate(ROUTES.portaria)}
        />
      ) : null}
    </div>
  )
}
