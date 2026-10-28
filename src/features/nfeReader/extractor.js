/**
 * Orquestra o pipeline de leitura automática de uma NF-e.
 *
 * Ordem (da fonte mais barata/confiável para a mais cara, cada uma só entra
 * em cena se a anterior não resolveu):
 *   1. PDF → extrair o texto embutido.
 *   2. Procurar chave(s) de 44 dígitos válidas nesse texto.
 *   3a. Achou uma chave válida no texto → usa ela. NÃO renderiza a página nem
 *       aciona o ZXing/OCR — evita trabalho (e risco) desnecessário no caso
 *       comum de PDF digital com a chave já impressa como texto selecionável.
 *   3b. Não achou → renderiza a 1ª página (ou usa a foto direto) e tenta ler
 *       um CODE_128: primeiro um fast path cru (ZBar, depois ZXing — ver
 *       `FAST_PATH_DECODERS` abaixo), depois o pipeline robusto de estágios
 *       (ver barcodeReader.js: sem TRY_HARDER, com rotação/recorte manuais
 *       para não bater no bug de rotação interna do ZXing).
 *   3c. Barcode também não achou → tenta OCR (ver ocrReader.js) sobre a mesma
 *       imagem, como último recurso para digitalizações ruins.
 *   4. Heurísticas fracas (regex) para campos que a chave não cobre.
 *   5. Cruza o CNPJ da chave com o catálogo local de fornecedores.
 *
 * Cada etapa é isolada em try/catch com log detalhado do erro real (nunca
 * `catch {}` silencioso): qualquer falha degrada para "não encontrado" em vez
 * de travar o fluxo — o usuário sempre pode preencher manualmente na revisão.
 * Uma falha em uma fonte nunca apaga uma chave já válida encontrada por outra.
 * "Não encontrado" só é reportado depois que texto, barcode e OCR já foram
 * tentados (ou não se aplicavam).
 */
import { encontrouSequenciaDe44Digitos, findValidNfeKeys, normalizarChave, validarChaveNFe } from './chaveNFe.js'
import { extractPdfText, renderPdfFirstPageToCanvas } from './pdfExtractor.js'
import { decodeCode128RawZxing, loadImageFileToCanvas, readCode128FromCanvas } from './barcodeReader.js'
import { decodeCode128RawZbar } from './zbarReader.js'
import { findNfeKeysWithOcr } from './ocrReader.js'
import { buildAnalysisFromKey, buildReliableReceiptPrefill, CONFIDENCE, analyzeNfeKey } from './analysisBuilder.js'
import { classifyDecodedText, createDiagnosticsCounter, DECODE_OUTCOME } from './decodeDiagnostics.js'

// Reexportados para continuar sendo o único ponto de entrada do módulo do
// ponto de vista de quem consome (NfeReaderPage.jsx, README.md) — a lógica em
// si vive em analysisBuilder.js (ver o porquê no topo daquele arquivo).
export { CONFIDENCE, analyzeNfeKey, buildReliableReceiptPrefill }

const ORIGEM_TEXTO = 'texto do PDF'
const ORIGEM_BARCODE = 'código de barras'
const ORIGEM_CAPTURA = 'captura do scanner ao vivo'
const ORIGEM_OCR = 'OCR'

function isPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
}

function log(...args) {
  console.log('[NFe]', ...args)
}

function logError(context, err) {
  console.error(`[NFe][${context}]`, {
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
  })
}

/**
 * Mensagem de aviso do estágio de código de barras, informada pelo que a
 * instrumentação de diagnóstico (`decodeDiagnostics.js`) realmente observou
 * — em vez de sempre "não localizado ou ilegível" (genérico demais: não diz
 * se não achou barras nenhuma ou se achou algo que não bate com uma chave de
 * NF-e). Nunca inventa diagnóstico além do que os contadores confirmam.
 */
function buildBarcodeWarning(diagnostics) {
  if (diagnostics.invalid_length > 0 || diagnostics.invalid_dv > 0) {
    return 'O código de barras foi detectado, mas não contém uma chave de NF-e válida.'
  }
  return 'Nenhum código de barras foi detectado. Enquadre o código inteiro, deixando espaço em branco nas laterais.'
}

/** OCR lê os 44 números IMPRESSOS abaixo do código, não as barras — se a foto tiver só o código de barras, é esperado que o OCR também não encontre nada. */
function buildOcrWarning() {
  return 'Para usar o reconhecimento de texto como alternativa, inclua também os 44 números impressos abaixo do código de barras.'
}

/** OCR achou 44 dígitos em algum lugar da imagem, mas nenhum passou na validação (DV ou semântica) — diferente de "não achou nada": aqui algo foi lido, só não é uma chave de NF-e real. */
function buildOcrInvalidSequenceWarning() {
  return 'Uma sequência de 44 dígitos foi encontrada por OCR, mas não corresponde a uma chave de NF-e válida.'
}

// Fast path de barcode estático, tentado antes do pipeline robusto de
// estágios: ZBar cru, depois ZXing cru (uma tentativa cada, sem recorte/
// rotação/contraste/deskew) — evidência do benchmark de decoders
// (testFixtures/README.md, testFixtures/validate-decoder-benchmark.mjs):
// nas fixtures sintéticas, ZBar cru decodificou 10/10 e ZXing cru 7/10,
// incluindo casos (rotação, pequena inclinação) que o ZXing cru sozinho não
// pegava. Sequencial, nunca em paralelo (custo de CPU/bateria numa foto só).
// Cai para o pipeline robusto de sempre (`readCode128FromCanvas`, que já
// tenta nativo+ZXing na imagem inteira, recortes, margem artificial e
// deskew) se os dois falharem — nenhuma lógica de decodificação nova aqui,
// só reordenação de quem tenta primeiro.
const FAST_PATH_DECODERS = [
  { label: 'ZBar (fast path)', decode: (canvas) => decodeCode128RawZbar(canvas) },
  { label: 'ZXing (fast path)', decode: (canvas) => decodeCode128RawZxing(canvas) },
]

/**
 * Tenta o código de barras e, se não resolver, o OCR — nessa ordem, sobre o
 * mesmo canvas. Compartilhado por `analyzeNfeFile` (arquivo/foto) e
 * `analyzeNfeCanvas` (captura do scanner ao vivo), para não duplicar essa
 * lógica em dois lugares. Acrescenta avisos a `warnings` (mutado in-place,
 * mesmo padrão já usado no resto do arquivo) e retorna `{ chave, origem }`
 * (`chave` é `null` se nada resolveu).
 */
async function runBarcodeThenOcr(canvas, warnings) {
  const diagnostics = createDiagnosticsCounter()

  for (const { label, decode } of FAST_PATH_DECODERS) {
    const rawFast = await decode(canvas)
    const outcome = classifyDecodedText(rawFast)
    diagnostics.record(outcome)
    if (outcome === DECODE_OUTCOME.VALID) {
      const chave = normalizarChave(rawFast)
      log(`Barcode encontrado (${label}):`, chave)
      return { chave, origem: ORIGEM_BARCODE, candidataInvalidaEncontrada: false }
    }
  }

  const raw = await readCode128FromCanvas(canvas, { onAttempt: (outcome) => diagnostics.record(outcome) })
  const summary = diagnostics.summary()
  log(`Código de barras: ${summary.attempts} tentativa(s) — não_encontrado=${summary.not_found} tamanho_inválido=${summary.invalid_length} dv_inválido=${summary.invalid_dv} válido=${summary.valid}`)

  let chave = null
  if (raw) {
    const normalized = normalizarChave(raw)
    chave = validarChaveNFe(normalized) ? normalized : findValidNfeKeys(raw)[0] || null
  }

  if (chave) {
    log('Barcode encontrado:', chave)
    return { chave, origem: ORIGEM_BARCODE, candidataInvalidaEncontrada: false }
  }
  // "invalid_length"/"invalid_dv" aqui cobre tanto DV incorreto quanto (desde
  // a validação semântica em chaveNFe.js) 44 dígitos com DV correto mas
  // cUF/AAMM/CNPJ/modelo incoerentes — em ambos os casos, algo de 44 dígitos
  // foi decodificado, só não é uma chave de NF-e real.
  const barcodeCandidataInvalida = summary.invalid_length > 0 || summary.invalid_dv > 0

  log('Código de barras não resolveu — tentando OCR como último recurso.')
  const { chaves: chavesOcr, candidataInvalidaEncontrada: ocrCandidataInvalida } = await findNfeKeysWithOcr(canvas)
  const chaveOcr = chavesOcr[0] || null
  if (chaveOcr) {
    log('Chave encontrada por OCR:', chaveOcr)
    // Código de barras falhou, mas o texto/OCR achou uma chave válida — é um
    // aviso informativo ("conferir"), não o alarme de "nada foi encontrado"
    // (que só pushamos abaixo, quando NADA resolveu).
    warnings.push('Código de barras não detectado. A chave foi identificada por OCR/texto e deve ser conferida.')
    return { chave: chaveOcr, origem: ORIGEM_OCR, candidataInvalidaEncontrada: false }
  }

  warnings.push(buildBarcodeWarning(summary))
  warnings.push(ocrCandidataInvalida ? buildOcrInvalidSequenceWarning() : buildOcrWarning())
  return { chave: null, origem: null, candidataInvalidaEncontrada: barcodeCandidataInvalida || ocrCandidataInvalida }
}

/**
 * Analisa uma chave a partir de um canvas já capturado — sem arquivo
 * envolvido. Usado pela ação "Capturar e analisar" do scanner ao vivo
 * (NfeLiveScanner.jsx): quando a leitura contínua não resolve rápido, captura
 * o frame atual da câmera e roda o MESMO pipeline robusto de código de
 * barras/OCR do upload/foto (`runBarcodeThenOcr`) — sem reescrever nada, sem
 * serializar o frame para arquivo só para ler de volta.
 */
export async function analyzeNfeCanvas(canvas) {
  const warnings = []
  log(`Canvas capturado do scanner ao vivo: ${canvas.width} x ${canvas.height}`)
  const { chave, origem, candidataInvalidaEncontrada } = await runBarcodeThenOcr(canvas, warnings)
  const origens = chave ? [`${origem} (${ORIGEM_CAPTURA})`] : []
  return buildAnalysisFromKey(chave, origens, { warnings, candidataInvalidaEncontrada })
}

export async function analyzeNfeFile(file) {
  const warnings = []
  log('Arquivo recebido:', file.name, `(${file.size} bytes)`)

  const isPdf = isPdfFile(file)
  let text = ''

  // --- Etapa 1+2: PDF → texto → chave no texto ---------------------------
  if (isPdf) {
    try {
      text = await extractPdfText(file)
      log('PDF aberto com sucesso')
      log(`Texto extraído: ${text.length} caractere(s)`)
    } catch (err) {
      logError('pdf-texto', err)
      warnings.push('Não foi possível extrair o texto do PDF (pode ser uma digitalização sem texto embutido).')
    }
  }

  const candidatasTexto = text ? findValidNfeKeys(text) : []
  if (text) log(`Chaves válidas no texto: ${candidatasTexto.length}`)
  const chaveDoTexto = candidatasTexto[0] || null
  if (chaveDoTexto) log('Chave encontrada pelo texto:', chaveDoTexto)

  // --- Etapa 3: barcode e, por último, OCR — só entram em cena se o texto
  // não resolveu. Cada um só roda se o anterior não achou nada. --------------
  let chaveDoBarcode = null
  let chaveDoOcr = null
  // Mesma distinção de runBarcodeThenOcr (ver lá): "nada parecido com uma
  // chave" vs "achou 44 dígitos em algum lugar, mas nenhum é válido".
  let candidataInvalidaEncontrada = text && !chaveDoTexto ? encontrouSequenciaDe44Digitos(text) : false

  if (chaveDoTexto) {
    log('Chave já válida via texto — código de barras e OCR não serão tentados.')
  } else {
    let canvas = null

    if (isPdf) {
      try {
        log('Renderizando página 1...')
        canvas = await renderPdfFirstPageToCanvas(file)
        log(`Canvas: ${canvas.width} x ${canvas.height}`)
      } catch (err) {
        logError('pdf-render', err)
        warnings.push('Não foi possível renderizar a primeira página do PDF.')
      }
    } else {
      try {
        canvas = await loadImageFileToCanvas(file)
        log(`Canvas: ${canvas.width} x ${canvas.height}`)
      } catch (err) {
        logError('imagem', err)
        warnings.push('Não foi possível carregar a imagem selecionada.')
      }
    }

    if (canvas) {
      const resultado = await runBarcodeThenOcr(canvas, warnings)
      if (resultado.origem === ORIGEM_BARCODE) chaveDoBarcode = resultado.chave
      else if (resultado.origem === ORIGEM_OCR) chaveDoOcr = resultado.chave
      if (resultado.candidataInvalidaEncontrada) candidataInvalidaEncontrada = true
    }
  }

  // --- Escolha da chave e possível confirmação cruzada --------------------
  const fontesCruzadas = Boolean(chaveDoTexto && chaveDoBarcode && chaveDoTexto === chaveDoBarcode)
  const origens = []
  let chave = null
  if (chaveDoTexto) {
    chave = chaveDoTexto
    origens.push(ORIGEM_TEXTO)
    if (fontesCruzadas) {
      origens.push(ORIGEM_BARCODE)
      log('Barcode confirmado pelo texto.')
    }
  } else if (chaveDoBarcode) {
    chave = chaveDoBarcode
    origens.push(ORIGEM_BARCODE)
  } else if (chaveDoOcr) {
    chave = chaveDoOcr
    origens.push(ORIGEM_OCR)
  }

  return buildAnalysisFromKey(chave, origens, { text, fontesCruzadas, warnings, candidataInvalidaEncontrada })
}
