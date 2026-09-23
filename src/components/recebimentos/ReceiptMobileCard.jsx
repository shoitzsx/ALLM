import React from 'react'
import { StatusBadge, formatDate } from '../../ui.jsx'
import { navigate } from '../../layout/navigation.js'

export function ReceiptMobileCard({ receipt }) {
  return (
    <article
      className="mobile-record-card"
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/recebimentos/${receipt.id}`)}
      onKeyDown={(event) => event.key === 'Enter' && navigate(`/recebimentos/${receipt.id}`)}
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
        <div><span>Recebimento</span><strong>{formatDate(receipt.dataRecebimento)}</strong></div>
        <div><span>Itens</span><strong>{receipt.itens?.length || 0}</strong></div>
      </div>
    </article>
  )
}
