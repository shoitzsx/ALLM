// Os estados vêm de alm.chegadas_portaria. REGISTRADA indica uma chegada ainda
// sem REC; não representa veículo aguardando no pátio.
export const STATUS_META = Object.freeze({
  REGISTRADA: { label: 'Aguardando recebimento', tone: 'warning' },
  VINCULADA: { label: 'Vinculada', tone: 'success' },
  CANCELADA: { label: 'Cancelada', tone: 'danger' },
})

const hasNf = (arrival) => Boolean(String(arrival?.numeroNf ?? '').trim())

export function needsAttention(arrival) {
  return arrival?.status === 'REGISTRADA' || !hasNf(arrival)
}

export function summarizeArrivals(arrivals) {
  const list = Array.isArray(arrivals) ? arrivals : []
  const total = list.length
  const porStatus = Object.entries(STATUS_META).map(([key, meta]) => {
    const count = list.filter((arrival) => arrival?.status === key).length
    return { key, label: meta.label, tone: meta.tone, total: count, share: total ? count / total : 0 }
  })
  const conhecidos = porStatus.reduce((sum, item) => sum + item.total, 0)
  return {
    total,
    registradas: porStatus.find((item) => item.key === 'REGISTRADA')?.total || 0,
    vinculadas: porStatus.find((item) => item.key === 'VINCULADA')?.total || 0,
    canceladas: porStatus.find((item) => item.key === 'CANCELADA')?.total || 0,
    semNf: list.filter((arrival) => !hasNf(arrival)).length,
    porStatus,
    statusDesconhecido: total - conhecidos,
    atencao: list.filter(needsAttention),
  }
}
