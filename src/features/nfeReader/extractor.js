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
 *       um CODE_128 (ver barcodeReader.js: sem TRY_HARDER, com rotação/recorte
 *       manuais para não bater no bug de rotação interna do ZXing).
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
import { findValidNfeKeys, interpretarChave, normalizarChave, validarChaveNFe } from './chaveNFe.js'
import { extractPdfText, renderPdfFirstPageToCanvas } from './pdfExtractor.js'
import { loadImageFileToCanvas, readCode128FromCanvas } from './barcodeReader.js'
import { findNfeKeysWithOcr } from './ocrReader.js'
import { findDataEmissao, findPedido, findValorTotal } from './textHeuristics.js'
import { getSupplierByCnpj } from './supplierCatalog.js'

export const CONFIDENCE = {
  ALTA: 'alta',
  CONFERIR: 'conferir',
  BAIXA: 'baixa',
  NAO_ENCONTRADO: 'nao_encontrado',
}

const ORIGEM_TEXTO = 'texto do PDF'
const ORIGEM_BARCODE = 'código de barras'
const ORIGEM_OCR = 'OCR'

function isPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
}

function field(value, confidence, origin = '') {
  return { value: value ?? '', confidence, origin }
}

function notFound() {
  return field('', CONFIDENCE.NAO_ENCONTRADO)
}

function todayLocalDate() {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
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
      const raw = await readCode128FromCanvas(canvas)
      if (raw) {
        const normalized = normalizarChave(raw)
        chaveDoBarcode = validarChaveNFe(normalized) ? normalized : findValidNfeKeys(raw)[0] || null
        if (chaveDoBarcode) log('Barcode encontrado:', chaveDoBarcode)
        else warnings.push('Código de barras lido, mas o conteúdo não corresponde a uma chave de NF-e válida.')
      } else {
        warnings.push('Código de barras não localizado ou ilegível — comum em digitalizações de baixa qualidade.')
      }

      if (!chaveDoBarcode) {
        log('Código de barras não resolveu — tentando OCR como último recurso.')
        const chavesOcr = await findNfeKeysWithOcr(canvas)
        chaveDoOcr = chavesOcr[0] || null
        if (chaveDoOcr) log('Chave encontrada por OCR:', chaveDoOcr)
        else warnings.push('OCR não conseguiu identificar uma chave de NF-e válida nesta digitalização.')
      }
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

  const interpretada = chave ? interpretarChave(chave) : null
  const origin = origens.join(' + ')
  const fromChave = (value) => (interpretada ? field(value, CONFIDENCE.ALTA, origin) : notFound())

  const supplierMatch = interpretada ? getSupplierByCnpj(interpretada.cnpj) : null
  const dataEmissaoHeur = findDataEmissao(text)
  const valorTotalHeur = findValorTotal(text)
  const pedidoHeur = findPedido(text)

  const fields = {
    numeroNf: fromChave(interpretada?.numeroNf),
    serieNf: fromChave(interpretada?.serie),
    cnpjFornecedor: fromChave(interpretada?.cnpjFormatado),
    fornecedor: supplierMatch
      ? field(supplierMatch, CONFIDENCE.ALTA, 'catálogo de fornecedores')
      : notFound(),
    pedido: pedidoHeur
      ? field(pedidoHeur.value, CONFIDENCE.BAIXA, 'heurística de texto (regex)')
      : notFound(),
    dataRecebimento: field(todayLocalDate(), CONFIDENCE.NAO_ENCONTRADO, 'sugestão: data de hoje'),
  }

  const referenciaNfe = {
    chaveAcesso: fromChave(chave),
    ufEmitente: fromChave(interpretada?.ufSigla),
    anoMesEmissao: fromChave(interpretada?.anoMesLabel),
    dataEmissao: dataEmissaoHeur
      ? field(dataEmissaoHeur.value, CONFIDENCE.CONFERIR, 'heurística de texto (regex)')
      : notFound(),
    valorTotal: valorTotalHeur
      ? field(valorTotalHeur.value, CONFIDENCE.CONFERIR, 'heurística de texto (regex)')
      : notFound(),
  }

  return {
    chaveValida: Boolean(interpretada),
    chaveInterpretada: interpretada,
    fontesCruzadas,
    origensChave: origens,
    fields,
    referenciaNfe,
    warnings,
  }
}
