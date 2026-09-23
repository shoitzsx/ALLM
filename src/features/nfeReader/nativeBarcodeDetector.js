/**
 * Wrapper fino sobre a API nativa do navegador `BarcodeDetector` — usada como
 * fast path opcional, tanto na foto/upload estático (barcodeReader.js,
 * estágio 1) quanto no scanner ao vivo (liveScanner.js).
 *
 * Pura feature detection: `globalThis.BarcodeDetector` só existe em
 * Chromium/Chrome/Edge/Android Chrome (e derivados) — Safari/iOS não
 * implementa. Nunca é obrigatório: ausência cai para ZXing, que continua
 * sendo o caminho universal (funciona em qualquer navegador que rode este
 * app). Ver `startLiveScan` em liveScanner.js para a decisão de arquitetura
 * (nativo OU ZXing, nunca os dois rodando ao mesmo tempo).
 */

let supportPromise = null

/** Suporte real a CODE_128, não só a existência do construtor — memoizado (não muda durante a sessão). */
export function isNativeCode128Supported() {
  if (typeof globalThis.BarcodeDetector === 'undefined') return Promise.resolve(false)
  if (!supportPromise) {
    supportPromise = globalThis.BarcodeDetector.getSupportedFormats()
      .then((formats) => formats.includes('code_128'))
      .catch((err) => {
        console.debug('[NFe][barcode] BarcodeDetector.getSupportedFormats() falhou — tratando como indisponível.', {
          name: err?.name,
        })
        return false
      })
  }
  return supportPromise
}

/**
 * Detecta um CODE_128 num canvas/imagem/vídeo usando a API nativa. Retorna o
 * texto bruto (`rawValue`) ou `null` — nunca lança; qualquer erro do
 * navegador (frame ainda não pronto, etc.) degrada para "não encontrado",
 * igual ao resto do pipeline. Quem chama ainda deve validar o resultado com
 * `normalizarChave`/`validarChaveNFe` — este módulo não faz validação de
 * chave de NF-e, só decodifica o barcode.
 */
export async function detectCode128Native(source) {
  if (!(await isNativeCode128Supported())) return null
  try {
    const detector = new globalThis.BarcodeDetector({ formats: ['code_128'] })
    const results = await detector.detect(source)
    return results?.[0]?.rawValue || null
  } catch (err) {
    console.debug('[NFe][barcode] BarcodeDetector nativo falhou nesta tentativa.', { name: err?.name, message: err?.message })
    return null
  }
}
