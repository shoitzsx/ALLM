import React from 'react'
import { ChevronRight, FileClock, Search } from 'lucide-react'
import { EmptyState, StatusBadge, formatDate } from '../../ui.jsx'
import { navigate } from '../../layout/navigation.js'
import { displayResponsible } from './receiptHelpers.js'
import { ReceiptMobileCard } from './ReceiptMobileCard.jsx'

export function ReceiptsTable({ receipts, onClearFilters }) {
  if (!receipts.length) {
    return (
      <EmptyState
        icon={Search}
        title="Nenhum recebimento encontrado"
        description="Tente remover alguns filtros ou pesquise por outro termo."
        action={<button className="btn btn-secondary" type="button" onClick={onClearFilters}>Limpar filtros</button>}
      />
    )
  }

  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Protocolo</th><th>Pedido / NF</th><th>Fornecedor</th><th>Data</th><th>Itens</th><th>Tipo</th><th>Responsável</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id} onClick={() => navigate(`/recebimentos/${encodeURIComponent(receipt.id)}`)}>
                <td><span className="protocol-link">{receipt.protocolo}</span></td>
                <td><div className="table-main"><strong>PC {receipt.pedido || '—'}</strong>{receipt.numeroNf ? <span>NF {receipt.numeroNf}</span> : <span className="nf-pending"><FileClock size={11} /> NF pendente</span>}</div></td>
                <td><div className="table-main"><strong>{receipt.fornecedor}</strong><span>{receipt.cnpjFornecedor || 'Cadastro local'}</span></div></td>
                <td>{formatDate(receipt.dataRecebimento)}</td>
                <td><span className="table-items-count">{receipt.itens?.length || 0}</span></td>
                <td>{receipt.tipo}</td>
                <td><div className="table-main"><strong>{displayResponsible(receipt)}</strong><span>Almoxarifado</span></div></td>
                <td><StatusBadge status={receipt.status} compact /></td>
                <td><ChevronRight size={15} className="icon-muted" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-records">
        {receipts.map((receipt) => <ReceiptMobileCard key={receipt.id} receipt={receipt} />)}
      </div>
      <footer className="pagination">
        <span>Mostrando {receipts.length} registro(s)</span>
        <div className="pagination-controls"><button className="page-number active" type="button">1</button></div>
      </footer>
    </>
  )
}
