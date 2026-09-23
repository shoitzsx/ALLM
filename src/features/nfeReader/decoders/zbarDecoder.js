/**
 * Adapter ZBar (WebAssembly) para o benchmark de diagnóstico — o terceiro
 * engine comparado, além do BarcodeDetector nativo e do ZXing já usados em
 * produção.
 *
 * Biblioteca: `@undecaf/zbar-wasm` v0.11.0 — fork mantido de
 * samsam2310/zbar.wasm, build WebAssembly do ZBar Bar Code Reader (C/C++),
 * https://github.com/undecaf/zbar-wasm. Licença LGPL-2.1+ (ver LICENSE do
 * pacote) — carregada dinamicamente como módulo WASM separado (nunca linkada
 * estaticamente no bundle da aplicação), sem alteração no código-fonte da
 * lib. Ver README.md do módulo, seção "Benchmark de decoders", para a nota
 * sobre revisão jurídica — esta tarefa apenas documenta a licença, não decide
 * por ela.
 *
 * IMPORTANTE — carregamento sob demanda: o `import()` dinâmico abaixo só
 * baixa/instancia o `.wasm` (~330kB) quando este adapter é realmente chamado
 * (painel de benchmark aberto E engine ZBar selecionado/testado) — nunca no
 * carregamento normal do app. O Vite gera um chunk separado para isto
 * automaticamente por causa do `import()` dinâmico (verificado com `npm run
 * build`, ver README). `@undecaf/zbar-wasm` nunca é importado estaticamente
 * em nenhum arquivo deste módulo.
 */
import { buildDecodeResult, ENGINE, unavailableResult } from './decoderTypes.js'

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
 * `source` — um HTMLCanvasElement ou um ImageData já pronto (evita reconverter
 * se quem chamar já tiver extraído o ImageData para outro propósito). Filtra
 * explicitamente por CODE128 — o ZBar detecta vários formatos (QR, EAN,
 * DataMatrix, etc.), mas só o resultado CODE128 é aceito aqui, igual aos
 * outros dois engines. Não aceita um resultado só porque o ZBar disse
 * "CODE128": a validação dos 44 dígitos/DV continua acontecendo em
 * `buildDecodeResult` (decoderTypes.js), igual para todo mundo.
 */
export async function decodeWithZbar(source) {
  const available = await isZbarAvailable()
  if (!available) return unavailableResult(ENGINE.ZBAR)

  const startedAt = performance.now()
  try {
    const zbar = await loadZbar()
    const imageData = toImageData(source)
    const symbols = await zbar.scanImageData(imageData)
    const code128 = symbols.find((symbol) => symbol.typeName === 'ZBAR_CODE128')
    const rawValue = code128 ? code128.decode() : null
    return buildDecodeResult(ENGINE.ZBAR, { available: true, rawValue, decodeTimeMs: performance.now() - startedAt })
  } catch (err) {
    return buildDecodeResult(ENGINE.ZBAR, { available: true, error: err?.message || String(err), decodeTimeMs: performance.now() - startedAt })
  }
}
