import React, { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { PageHeader } from '../../components/shared/PageHeader.jsx'
import { ROUTES, navigate } from '../../layout/navigation.js'
import { PortariaDashboard } from './components/PortariaDashboard.jsx'
import { PortariaScanner } from './components/PortariaScanner.jsx'
import { ArrivalReview } from './components/ArrivalReview.jsx'
import { ArrivalResult } from './components/ArrivalResult.jsx'
import { api } from '../../api.js'
import { retryInitialLoad } from '../../store.js'
import { RECEIPT_TYPE_OPTIONS } from '../../data.js'
import { useAuth } from '../auth/AuthProvider.jsx'
import './portaria.css'

const METHOD = { TEXTO_PDF: 'PDF_TEXTO', CODIGO_BARRAS: 'ZBAR', OCR: 'OCR',
  MANUAL: 'MANUAL', NAO_IDENTIFICADO: 'MANUAL' }
const CONFIDENCE = { ALTA: 'ALTA', CONFERIR: 'MEDIA', BAIXA: 'BAIXA', NAO_ENCONTRADO: 'MANUAL' }

export function arrivalRequest(draft) {
  return { nfeChaveAcesso: draft.nfeChaveAcesso || null, numeroNf: draft.numeroNf || null,
    serieNf: draft.serieNf || null, cnpjEmitente: draft.cnpjEmitente || null,
    fornecedor: draft.fornecedor || null, metodoLeitura: METHOD[draft.metodoLeitura] || 'MANUAL',
    confianca: CONFIDENCE[draft.confianca] || 'MANUAL' }
}

const STAGE_DESCRIPTION = {
  dashboard: 'Acompanhe as chegadas recentes ou registre uma nova.',
  scanner: 'Identifique a nota fiscal para registrar a chegada.',
  review: 'Revise os dados antes de confirmar a chegada.',
  result: null,
}

export function PortariaPage({ registering = false }) {
  const auth = useAuth()
  const [stage, setStage] = useState(registering ? 'scanner' : 'dashboard')
  const [draft, setDraft] = useState(null)
  const [confirmed, setConfirmed] = useState(null)
  const [arrivals, setArrivals] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedArrival, setSelectedArrival] = useState(null)
  const [receiptForm, setReceiptForm] = useState({ pedido: '', tipo: 'Estoque', fornecedor: '' })
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    let active = true
    api.listChegadas().then((result) => {
      if (active) { setArrivals(result.data || []); setError('') }
    }).catch((cause) => {
      if (active) setError(cause.message || 'Não foi possível carregar as chegadas.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

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
    setDraft(scannerDraft)
    setError('')
    setStage('review')
  }

  function updateDraftField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function confirmArrival() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const created = await api.createChegada(arrivalRequest(draft))
      setConfirmed(created)
      setArrivals((current) => [created, ...current])
      setStage('result')
    } catch (cause) {
      setError(cause.message || 'Não foi possível registrar a chegada.')
    } finally {
      setSaving(false)
    }
  }

  function registerAnother() {
    setDraft(null)
    setConfirmed(null)
    setStage('scanner')
  }

  async function startReceipt() {
    if (!selectedArrival || linking) return
    setLinking(true)
    setError('')
    try {
      const result = await api.iniciarRecebimentoDaChegada(selectedArrival.id, receiptForm)
      await retryInitialLoad()
      navigate(`/recebimentos/${result.recebimentoId}`)
      setSelectedArrival(null)
    } catch (cause) {
      setError(cause.message || 'Não foi possível iniciar o recebimento.')
    } finally { setLinking(false) }
  }

  return (
    <div className="page">
      <PageHeader title={registering ? 'Registrar chegada' : 'Painel da Portaria'} description={STAGE_DESCRIPTION[stage]}>
        {stage === 'dashboard' ? (
          <button type="button" className="btn btn-primary" onClick={() => navigate(ROUTES.portariaRegistrar)}>
            <Plus size={16} /> Nova chegada
          </button>
        ) : null}
      </PageHeader>

      {error ? <div role="alert" className="info-strip warning">{error}</div> : null}
      {loading && stage === 'dashboard' ? <p>Carregando chegadas...</p> : null}

      {stage === 'dashboard' && !loading ? <PortariaDashboard arrivals={arrivals}
        canStartReceipt={auth.can('recebimentos.create')}
        onStartReceipt={(arrival) => {
          setSelectedArrival(arrival)
          setReceiptForm({ pedido: '', tipo: 'Estoque', fornecedor: arrival.fornecedor || '' })
        }} /> : null}

      {stage === 'dashboard' && selectedArrival ? (
        <section className="form-card" aria-label="Iniciar recebimento da chegada">
          <header className="form-card-header"><div><h2>Iniciar recebimento de {selectedArrival.codigo}</h2>
            <p>O vínculo com a chegada será criado em uma única transação no banco.</p></div></header>
          <div className="form-card-body form-grid">
            <div className="field"><label htmlFor="portaria-pedido">Pedido</label>
              <input id="portaria-pedido" value={receiptForm.pedido} disabled={linking}
                onChange={(event) => setReceiptForm((value) => ({ ...value, pedido: event.target.value }))} /></div>
            <div className="field"><label htmlFor="portaria-tipo">Tipo</label>
              <select id="portaria-tipo" value={receiptForm.tipo} disabled={linking}
                onChange={(event) => setReceiptForm((value) => ({ ...value, tipo: event.target.value }))}>
                {RECEIPT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></div>
            <div className="field field-full"><label htmlFor="portaria-fornecedor-rec">Fornecedor</label>
              <input id="portaria-fornecedor-rec" value={receiptForm.fornecedor}
                disabled={linking || Boolean(selectedArrival.fornecedor)}
                onChange={(event) => setReceiptForm((value) => ({ ...value, fornecedor: event.target.value }))} /></div>
          </div>
          <footer className="portaria-form-footer">
            <button type="button" className="btn btn-secondary" disabled={linking} onClick={() => setSelectedArrival(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={linking || !receiptForm.pedido.trim() || !receiptForm.fornecedor.trim()}
              onClick={startReceipt}>{linking ? 'Iniciando...' : 'Criar recebimento'}</button>
          </footer>
        </section>
      ) : null}

      {stage === 'scanner' ? <PortariaScanner onFileAnalyzed={startFromScanner} /> : null}

      {stage === 'review' && draft ? (
        <ArrivalReview
          arrival={draft}
          onChange={updateDraftField}
          onBack={() => setStage('scanner')}
          onConfirm={confirmArrival}
          saving={saving}
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
