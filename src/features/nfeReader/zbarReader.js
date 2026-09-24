/**
 * Wrapper fino sobre o decoder ZBar (WebAssembly, `@undecaf/zbar-wasm`) — o
 * primitivo de baixo nível usado tanto pelo fast path de produção
 * (`extractor.js`, leitura de foto) quanto pelo adapter do benchmark de
 * diagnóstico (`decoders/zbarDecoder.js`), no mesmo padrão de
 * `nativeBarcodeDetector.js` (primitivo raiz) vs. `decoders/nativeDecoder.js`
 * (wrapper fino do benchmark) — nunca duas implementações de carregamento do
 * ZBar.
 *
 * Versão/licença/carregamento sob demanda documentados no README do módulo,
 * seção "Benchmark de decoders" — seguem valendo aqui: `import()` dinâmico,
 * memoizado, nunca importado estaticamente. A partir desta tarefa, este
 * módulo também é chamado pelo pipeline de produção (leitura de foto), não
 * só pelo benchmark — o `.wasm` (~239kB) passa a ser baixado na primeira
 * análise real de uma foto/imagem, não só quando o benchmark é aberto (ver
 * README para o impacto no bundle).
 */
let zbarModulePromise = null
function loadZbar() {
  if (!zbarModulePromise) zbarModulePromise = import('@undecaf/zbar-wasm')
  return zbarModulePromise
}

/** ZBar roda em qualquer navegador com suporte a WebAssembly — praticamente universal, mas checado de verdade, nunca assumido. */
export async function isZbarAvailable() {
  return typeof WebAssembly !== 'undefined'
}

function toImageData(source) {
  if (source instanceof ImageData) return source
  const canvas = source
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D indisponível ao preparar imagem para o ZBar.')
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * Decodifica um CODE128 cru via ZBar — texto bruto ou `null`. Nunca lança
 * (mesmo contrato de `detectCode128Native`/`decodeCode128RawZxing`): qualquer
 * falha (WASM não carregou, frame inválido) degrada para "não encontrado".
 * Filtra explicitamente por `ZBAR_CODE128` — o ZBar detecta vários formatos
 * (QR, EAN, DataMatrix...), só CODE128 é aceito. Quem chama ainda deve
 * validar com `normalizarChave`/`validarChaveNFe` — este módulo não valida
 * chave de NF-e, só decodifica o barcode.
 */
export async function decodeCode128RawZbar(source) {
  if (!(await isZbarAvailable())) return null
  try {
    const zbar = await loadZbar()
    const imageData = toImageData(source)
    const symbols = await zbar.scanImageData(imageData)
    const code128 = symbols.find((symbol) => symbol.typeName === 'ZBAR_CODE128')
    return code128 ? code128.decode() : null
  } catch (err) {
    console.debug('[NFe][barcode] ZBar falhou nesta tentativa.', { name: err?.name, message: err?.message })
    return null
  }
}
