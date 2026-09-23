/**
 * Ativação do painel de diagnóstico/benchmark do scanner — por query string
 * (`?nfeScannerDebug=1`), nunca por `import.meta.env.DEV`. O teste decisivo
 * (NF real, celular físico) precisa acontecer no deploy HTTPS (Vercel), não
 * só em desenvolvimento local — diferente do painel de diagnóstico do
 * scanner ao vivo (DevDiagnosticsPanel, NfeLiveScanner.jsx), que continua
 * DEV-only por ser só instrumentação interna, não uma ferramenta de teste
 * comparativo.
 *
 * Quando a flag não está presente: nenhuma UI de benchmark aparece, nenhum
 * código do benchmark é sequer carregado (ver import dinâmico em
 * NfeReaderPage.jsx) — sem custo para quem não está testando.
 */
const DEBUG_QUERY_PARAM = 'nfeScannerDebug'

export function isScannerDebugEnabled() {
  if (typeof window === 'undefined' || !window.location) return false
  try {
    return new URLSearchParams(window.location.search).get(DEBUG_QUERY_PARAM) === '1'
  } catch {
    return false
  }
}
