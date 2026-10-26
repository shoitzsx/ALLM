/**
 * Indicadores do Painel do dia da Portaria (D-1), calculados só a partir da
 * lista de chegadas que a página tem em memória — hoje, a lista simulada
 * (mockPortariaData.js) mais o que for confirmado na sessão.
 *
 * Deliberadamente NÃO calcula previstas, aguardando atendimento, saídas, tempo
 * de espera nem de permanência: o modelo atual não tem esses eventos (`criadoEm`
 * é só "HH:MM" do início do registro, sem data, e não é o horário de chegada).
 */
import { STATUS_META } from './mockPortariaData.js'

const hasNf = (arrival) => Boolean(String(arrival?.numeroNf ?? '').trim())

/** Precisa de atenção na Portaria: chegada pendente ou sem NF identificada. */
export function needsAttention(arrival) {
  return arrival?.status === 'PENDENTE' || !hasNf(arrival)
}

export function summarizeArrivals(arrivals) {
  const list = arrivals || []
  const total = list.length
  const porStatus = Object.entries(STATUS_META).map(([key, meta]) => {
    const count = list.filter((arrival) => arrival?.status === key).length
    return { key, label: meta.label, tone: meta.tone, total: count, share: total ? count / total : 0 }
  })
  const conhecidos = porStatus.reduce((sum, item) => sum + item.total, 0)
  return {
    total,
    registradas: porStatus.find((item) => item.key === 'REGISTRADA')?.total || 0,
    pendentes: porStatus.find((item) => item.key === 'PENDENTE')?.total || 0,
    semNf: list.filter((arrival) => !hasNf(arrival)).length,
    porStatus,
    statusDesconhecido: total - conhecidos,
    atencao: list.filter(needsAttention),
  }
}
