import React from 'react'
import { ChevronRight } from 'lucide-react'
import { StatusBadge, formatDate } from '../../ui.jsx'
import { navigate } from '../../layout/navigation.js'
import { displayResponsible } from './receiptHelpers.js'

export function ReceiptMobileCard({ receipt }) {
  function open() {
    navigate(`/recebimentos/${receipt.id}`)
  }

  return (
    <article
      className="mobile-record-card"
      role="button"
      tabIndex={0}
      aria-label={`Abrir recebimento ${receipt.protocolo}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
    >
      <div className="mobile-record-top">
        <strong>{receipt.protocolo}</strong>
        <StatusBadge status={receipt.status} compact />
      </div>
      <h3>{receipt.fornecedor}</h3>
      <p>{(receipt.itens || [])[0]?.descricao || 'Sem item informado'}</p>
      <div className="mobile-record-meta">
        <div><span>Pedido</span><strong>{receipt.pedido || '—'}</strong></div>
        <div><span>NF</span><strong>{receipt.numeroNf || 'Pendente'}</strong></div>
        <div><span>Data</span><strong>{formatDate(receipt.dataRecebimento)}</strong></div>
        <div><span>Tipo</span><strong>{receipt.tipo || '—'}</strong></div>
        <div><span>Responsável</span><strong>{displayResponsible(receipt)}</strong></div>
        <div><span>Itens</span><strong>{receipt.itens?.length || 0}</strong></div>
      </div>
      <div className="mobile-record-open" aria-hidden="true">
        Abrir <ChevronRight size={14} />
      </div>
    </article>
  )
}
