/**
 * Log agrupado de diagnóstico, só em desenvolvimento (`import.meta.env.DEV`
 * — mesmo padrão já usado em NfeLiveScanner.jsx/NfeReaderPage.jsx/
 * photoCapture.js) — nunca em produção.
 *
 * Existe para resolver um problema real: cada tentativa individual de
 * recorte/rotação/contraste do código de barras gerava sua própria linha de
 * console (até ~115 tentativas numa única foto) — a maior parte delas é
 * `NotFoundException`, o desfecho ESPERADO da maioria das tentativas, não um
 * erro. Isso poluía o console sem ajudar a diagnosticar nada. Este helper
 * junta tudo numa única linha por ESTÁGIO nomeado (não por tentativa de
 * rotação), dentro de um grupo colapsável — consulte quando precisar, sem
 * poluir quando não precisar. Erros genuinamente inesperados continuam
 * sendo logados via `console.error` em todo o pipeline, sem depender deste
 * helper nem de DEV (ver `logUnexpectedError` em barcodeReader.js/
 * ocrReader.js) — nunca escondidos.
 */
export function devLogGroup(title, lines) {
  if (!import.meta.env?.DEV) return
  if (!lines || !lines.length) return
  const abrirGrupo = typeof console.groupCollapsed === 'function' ? console.groupCollapsed : console.log
  abrirGrupo(`[NFe] ${title}:`)
  for (const line of lines) console.log(line)
  if (typeof console.groupEnd === 'function') console.groupEnd()
}

/** Relógio monotônico se disponível (navegador), com fallback — só para medir duração aproximada de um estágio em DEV; nunca usado para lógica de decisão. */
export function agora() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
