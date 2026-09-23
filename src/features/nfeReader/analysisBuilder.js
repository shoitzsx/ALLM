/**
 * Monta o objeto de resultado da análise (mesmo formato usado pela tela de
 * revisão) a partir de uma chave de acesso já resolvida — independente de a
 * chave ter vindo do texto do PDF, do código de barras estático, do OCR ou do
 * scanner ao vivo pela câmera.
 *
 * Isolado deliberadamente em um arquivo próprio, sem importar nada de
 * `pdfExtractor.js`/`barcodeReader.js`/`ocrReader.js` (que dependem de Canvas
 * DOM e de import `?url` específico do Vite): isso é o que permite testar
 * esta lógica com `node --test`, igual a `chaveNFe.js`. `extractor.js`
 * reexporta `analyzeNfeKey`/`CONFIDENCE` daqui para continuar sendo o único
 * ponto de entrada do módulo do ponto de vista de quem consome (README).
 */
import { interpretarChave, normalizarChave, validarChaveNFe } from './chaveNFe.js'
import { getSupplierByCnpj } from './supplierCatalog.js'
import { findDataEmissao, findPedido, findValorTotal } from './textHeuristics.js'

export const CONFIDENCE = {
  ALTA: 'alta',
  CONFERIR: 'conferir',
  BAIXA: 'baixa',
  NAO_ENCONTRADO: 'nao_encontrado',
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

/**
 * Monta `fields`/`referenciaNfe`/`chaveInterpretada` a partir de uma chave já
 * validada (ou `null`, para o caso "nada encontrado"). `text`, quando
 * fornecido, alimenta as heurísticas fracas de data de emissão/valor
 * total/pedido (`textHeuristics.js`) — sem texto (ex.: chave vinda do
 * scanner ao vivo), esses campos ficam corretamente como "não encontrado" em
 * vez de inventados.
 */
export function buildAnalysisFromKey(chave, origens = [], { text = '', fontesCruzadas = false, warnings = [] } = {}) {
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

/**
 * Constrói o resultado da análise a partir de uma chave lida fora do pipeline
 * de arquivo (hoje: o scanner de código de barras ao vivo pela câmera).
 *
 * Nunca confia no chamador quanto à validade — revalida a chave (dígito
 * verificador) aqui dentro, com a mesma `validarChaveNFe` usada em todo o
 * resto do módulo. Uma chave inválida produz o mesmo formato de resultado
 * "nada encontrado" que `analyzeNfeFile` retorna quando nenhuma fonte
 * resolve, para a tela de revisão não precisar de um caminho especial.
 *
 * Como não há texto de PDF envolvido, pedido/valor total/data de emissão
 * ficam como "não encontrado" — o scanner não inventa dado que não leu.
 */
export function analyzeNfeKey(chaveRaw, origem = 'scanner ao vivo, código de barras') {
  const chave = normalizarChave(chaveRaw)
  if (!validarChaveNFe(chave)) {
    return buildAnalysisFromKey(null, [], {
      warnings: ['O código lido não corresponde a uma chave de NF-e válida (dígito verificador incorreto).'],
    })
  }
  return buildAnalysisFromKey(chave, [origem])
}
