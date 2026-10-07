import React from 'react'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { METODO_LEITURA_LABELS, CONFIANCA_META } from '../mockPortariaData.js'

function formatChave(chave) {
  if (!chave) return '— não informada —'
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ')
}

export function ArrivalReview({ arrival, onChange, onBack, onConfirm }) {
  const confiancaMeta = CONFIANCA_META[arrival.confianca] || CONFIANCA_META.BAIXA
  const canConfirm = Boolean(arrival.numeroNf?.trim() && arrival.fornecedor?.trim())

  return (
    <article className="form-card">
      <header className="form-card-header">
        <div>
          <h2>Revisão da chegada</h2>
          <p>Confirme os dados antes de registrar. Nada é salvo em backend nesta etapa.</p>
        </div>
        <span className="step-pill">Etapa 2 de 3</span>
      </header>

      <div className="form-card-body">
        <div className="definition-grid portaria-definition-grid">
          <div className="definition-item field-full">
            <span>Chave NF-e</span>
            <strong className="portaria-chave-mono">{formatChave(arrival.nfeChaveAcesso)}</strong>
          </div>
          <div className="definition-item">
            <span>Método de leitura</span>
            <strong>{METODO_LEITURA_LABELS[arrival.metodoLeitura] || arrival.metodoLeitura}</strong>
          </div>
          <div className="definition-item">
            <span>Confiança</span>
            <strong>
              <span className={`portaria-chip portaria-chip-${confiancaMeta.tone}`}>{confiancaMeta.label}</span>
            </strong>
          </div>
        </div>

        <div className="form-grid portaria-edit-grid">
          <div className="field">
            <label htmlFor="portaria-numero-nf">Número da NF <span className="required-hint">Obrigatório</span></label>
            <input
              id="portaria-numero-nf"
              value={arrival.numeroNf}
              onChange={(event) => onChange('numeroNf', event.target.value)}
              placeholder="Ex.: 438271"
            />
          </div>
          <div className="field">
            <label htmlFor="portaria-serie">Série</label>
            <input
              id="portaria-serie"
              value={arrival.serieNf}
              onChange={(event) => onChange('serieNf', event.target.value)}
              placeholder="Ex.: 1"
            />
          </div>
          <div className="field">
            <label htmlFor="portaria-cnpj">CNPJ do emitente</label>
            <input
              id="portaria-cnpj"
              value={arrival.cnpjEmitente}
              onChange={(event) => onChange('cnpjEmitente', event.target.value)}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <div className="field">
            <label htmlFor="portaria-fornecedor">Fornecedor <span className="required-hint">Obrigatório</span></label>
            <input
              id="portaria-fornecedor"
              value={arrival.fornecedor}
              onChange={(event) => onChange('fornecedor', event.target.value)}
              placeholder="Nome do fornecedor"
            />
          </div>
        </div>
      </div>

      <footer className="portaria-form-footer">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={!canConfirm}>
          <CheckCircle2 size={16} /> Confirmar chegada
        </button>
      </footer>
    </article>
  )
}
