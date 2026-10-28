import React from 'react'
import { CheckCircle2, RotateCcw, Home } from 'lucide-react'
import { STATUS_META } from '../mockPortariaData.js'

export function ArrivalResult({ arrival, onRegisterAnother, onBackToStart }) {
  const statusMeta = STATUS_META[arrival.status] || STATUS_META.REGISTRADA

  return (
    <article className="form-card portaria-result-card">
      <div className="portaria-result-hero">
        <span className="portaria-result-icon">
          <CheckCircle2 size={32} />
        </span>
        <h2>Chegada registrada</h2>
        <p>Este registro é simulado — ainda não foi enviado a nenhum backend.</p>
      </div>

      <div className="definition-grid portaria-definition-grid">
        <div className="definition-item">
          <span>Código da chegada</span>
          <strong>{arrival.codigo}</strong>
        </div>
        <div className="definition-item">
          <span>Número da NF</span>
          <strong>{arrival.numeroNf || '— pendente'}</strong>
        </div>
        <div className="definition-item">
          <span>Fornecedor</span>
          <strong>{arrival.fornecedor || '— não informado'}</strong>
        </div>
        <div className="definition-item">
          <span>Horário</span>
          <strong>{arrival.criadoEm}</strong>
        </div>
        <div className="definition-item">
          <span>Status</span>
          <strong>
            <span className={`portaria-chip portaria-chip-${statusMeta.tone}`}>{statusMeta.label}</span>
          </strong>
        </div>
      </div>

      <footer className="portaria-form-footer">
        <button type="button" className="btn btn-secondary" onClick={onBackToStart}>
          <Home size={16} /> Voltar ao início
        </button>
        <button type="button" className="btn btn-primary" onClick={onRegisterAnother}>
          <RotateCcw size={16} /> Registrar outra chegada
        </button>
      </footer>
    </article>
  )
}
