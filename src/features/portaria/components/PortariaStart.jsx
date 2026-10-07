import React, { useState } from 'react'
import { Camera, Upload, Keyboard, ArrowRight } from 'lucide-react'
import { STATUS_META } from '../mockPortariaData.js'

function ArrivalStatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.PENDENTE
  return <span className={`portaria-chip portaria-chip-${meta.tone}`}>{meta.label}</span>
}

export function PortariaStart({ arrivals, onStartCamera, onStartUpload, onStartManual }) {
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')

  const digitsOnly = manualValue.replace(/\D/g, '')
  const canContinue = digitsOnly.length === 44

  function handleManualSubmit(event) {
    event.preventDefault()
    if (!canContinue) return
    onStartManual(digitsOnly)
    setManualValue('')
    setManualOpen(false)
  }

  return (
    <>
      <div className="portaria-action-grid">
        <button type="button" className="portaria-action-card" onClick={onStartCamera}>
          <Camera size={26} />
          <strong>Fotografar código</strong>
          <span>Use a câmera para capturar a NF-e</span>
        </button>
        <button type="button" className="portaria-action-card" onClick={onStartUpload}>
          <Upload size={26} />
          <strong>Selecionar arquivo</strong>
          <span>Envie uma foto ou PDF já salvo</span>
        </button>
        <button
          type="button"
          className={`portaria-action-card ${manualOpen ? 'active' : ''}`}
          onClick={() => setManualOpen((open) => !open)}
          aria-expanded={manualOpen}
        >
          <Keyboard size={26} />
          <strong>Digitar chave manualmente</strong>
          <span>Informe os 44 dígitos da chave de acesso</span>
        </button>
      </div>

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
            <button type="submit" className="btn btn-primary" disabled={!canContinue}>
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
