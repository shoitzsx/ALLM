import React, { useState } from 'react'
import { AlertTriangle, Camera, Upload, Keyboard, ArrowRight, Loader2 } from 'lucide-react'
import { STATUS_META } from '../mockPortariaData.js'
import { analyzeNfeFile } from '../../nfeReader/extractor.js'
import { mapAnalysisToArrivalDraft } from '../scannerBridge.js'

// Mesmos tipos aceitos hoje por "Selecionar arquivo" em
// src/features/nfeReader/NfeReaderPage.jsx — não inventa uma allowlist
// nova, só espelha a existente.
const SCANNER_FILE_ACCEPT = 'application/pdf,image/jpeg,image/png'

function ArrivalStatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.PENDENTE
  return <span className={`portaria-chip portaria-chip-${meta.tone}`}>{meta.label}</span>
}

export function PortariaStart({ arrivals, onStartCamera, onFileAnalyzed, onStartManual }) {
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [analyzingFile, setAnalyzingFile] = useState(false)
  const [fileError, setFileError] = useState('')

  const digitsOnly = manualValue.replace(/\D/g, '')
  const canContinue = digitsOnly.length === 44

  function handleManualSubmit(event) {
    event.preventDefault()
    if (!canContinue) return
    onStartManual(digitsOnly)
    setManualValue('')
    setManualOpen(false)
  }

  async function handleFileSelected(event) {
    const selected = event.target.files?.[0] || null
    event.target.value = ''
    if (!selected || analyzingFile) return
    setFileError('')
    setAnalyzingFile(true)
    try {
      const analysis = await analyzeNfeFile(selected)
      const draft = mapAnalysisToArrivalDraft(analysis)
      onFileAnalyzed(draft)
    } catch (error) {
      console.error('[Portaria] Falha ao analisar arquivo selecionado.', error)
      setFileError(error?.message || 'Não foi possível analisar o arquivo selecionado. Tente novamente.')
    } finally {
      setAnalyzingFile(false)
    }
  }

  return (
    <>
      <div className="portaria-action-grid">
        <button type="button" className="portaria-action-card" onClick={onStartCamera} disabled={analyzingFile}>
          <Camera size={26} />
          <strong>Fotografar código</strong>
          <span>Use a câmera para capturar a NF-e</span>
        </button>

        <label className={`portaria-action-card ${analyzingFile ? 'is-busy' : ''}`}>
          {analyzingFile ? <Loader2 size={26} className="spin" /> : <Upload size={26} />}
          <strong>{analyzingFile ? 'Analisando nota fiscal…' : 'Selecionar arquivo'}</strong>
          <span>{analyzingFile ? 'Isso pode levar alguns segundos' : 'PDF ou imagem da NF-e (DANFE)'}</span>
          <input
            type="file"
            accept={SCANNER_FILE_ACCEPT}
            disabled={analyzingFile}
            onChange={handleFileSelected}
          />
        </label>

        <button
          type="button"
          className={`portaria-action-card ${manualOpen ? 'active' : ''}`}
          onClick={() => setManualOpen((open) => !open)}
          aria-expanded={manualOpen}
          disabled={analyzingFile}
        >
          <Keyboard size={26} />
          <strong>Digitar chave manualmente</strong>
          <span>Informe os 44 dígitos da chave de acesso</span>
        </button>
      </div>

      {fileError ? (
        <div className="info-strip warning portaria-file-error">
          <AlertTriangle size={15} />
          <span>{fileError}</span>
        </div>
      ) : null}

      {manualOpen ? (
        <form className="portaria-manual-form" onSubmit={handleManualSubmit}>
          <div className="field field-full">
            <label htmlFor="portaria-manual-chave">
              Chave de acesso da NF-e
              <span className="field-help-inline">{digitsOnly.length}/44 dígitos</span>
            </label>
            <input
              id="portaria-manual-chave"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Digite ou cole os 44 números da chave"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
            />
          </div>
          <div className="portaria-manual-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setManualOpen(false); setManualValue('') }}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canContinue || analyzingFile}>
              Continuar <ArrowRight size={16} />
            </button>
          </div>
        </form>
      ) : null}

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
    </>
  )
}
