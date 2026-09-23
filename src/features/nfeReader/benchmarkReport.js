/**
 * Monta o texto de "Copiar diagnóstico" — puro (recebe só dados já
 * resumidos, nunca a chave completa ou qualquer dado fiscal), para poder ser
 * testado em Node e para deixar explícito, por assinatura de função, o que
 * NUNCA entra no texto: sem CNPJ, chave completa, pedido, valor ou
 * fornecedor — só métricas técnicas (engine/disponibilidade/tempo/
 * detecção), exatamente o que foi pedido.
 */
import { ENGINE_LABEL } from './decoders/decoderTypes.js'

/**
 * `results` — array de resultados no formato de `decoderTypes.js`
 * (`buildDecodeResult`/`unavailableResult`), um por engine testado (Modo A,
 * frame capturado). `liveResults` (opcional) — mapa `engine -> resumo` de
 * `runLiveEngineTest` (benchmarkLiveRunner.js), do Modo B (teste ao vivo);
 * omitido se nenhum teste ao vivo foi rodado ainda.
 */
export function buildDiagnosticsReportText({ browser, platform, viewport, cameraResolution, orientation, autoEngine, results, liveResults }) {
  const lines = []
  lines.push('ALM NF-e Scanner Benchmark')
  lines.push('')
  lines.push(`Browser: ${browser || 'N/D'}`)
  lines.push(`Plataforma: ${platform || 'N/D'}`)
  lines.push(`Viewport: ${viewport || 'N/D'}`)
  lines.push(`Resolução câmera: ${cameraResolution || 'N/D'}`)
  lines.push(`Orientação: ${orientation || 'N/D'}`)
  lines.push(`Engine automático atual (produção): ${autoEngine || 'N/D'}`)
  lines.push('')

  for (const result of results || []) {
    lines.push(`${ENGINE_LABEL[result.engine] || result.engine}:`)
    lines.push(`  disponível: ${result.available ? 'sim' : 'não'}`)
    lines.push(`  detectou CODE128: ${result.detected ? 'sim' : 'não'}`)
    lines.push(`  chave NF-e válida: ${result.validNfeKey ? 'sim' : 'não'}`)
    lines.push(`  tempo de decode: ${result.decodeTimeMs != null ? `${result.decodeTimeMs}ms` : 'N/D'}`)
    if (result.error) lines.push(`  erro técnico: ${result.error}`)
    lines.push('')
  }

  const liveEntries = Object.entries(liveResults || {}).filter(([, summary]) => summary)
  if (liveEntries.length) {
    lines.push(`Teste ao vivo (até 10s por engine):`)
    for (const [engine, summary] of liveEntries) {
      lines.push(`  ${ENGINE_LABEL[engine] || engine}: ${summary.outcome} — ${summary.attempts} tentativa(s) em ${summary.elapsedMs}ms`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
