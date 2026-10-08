/**
 * Ponte pura entre o formato de resultado do scanner NF-e
 * (src/features/nfeReader/extractor.js — `analyzeNfeFile`/`analyzeNfeKey`) e
 * o formato de rascunho usado pela Portaria.
 *
 * Não importa nada de nfeReader/App.jsx/store.js — só traduz um objeto já
 * pronto, recebido por parâmetro, em outro. O scanner não precisa (e não
 * deve) conhecer a Portaria; esta tradução vive inteiramente deste lado.
 *
 * Campos devolvidos são só os que vêm (ou podem vir) do scanner. id, código
 * da chegada, status e horário continuam responsabilidade de quem chama —
 * mesma convenção já usada por createMockScanResult/createMockManualDraft
 * em mockPortariaData.js.
 */

/**
 * Valores internos da Portaria, só para esta fase (UI local, sem backend).
 * NÃO é o contrato persistido/API — isso ainda será fechado com Goran
 * (backend/Sheets/Drive) e Kobner (Supabase/schema). Quando esse contrato
 * existir, a tradução para os nomes/valores definitivos entra numa camada de
 * integração própria (ainda não criada) — não aqui, e não substituindo estes
 * códigos internos silenciosamente. Nada nesta fase lê ou grava em
 * banco/API: `metodoLeitura` hoje só é usado para exibição em
 * ArrivalReview.jsx (via METODO_LEITURA_LABELS, em mockPortariaData.js).
 */
export const METODO_LEITURA = {
  TEXTO_PDF: 'TEXTO_PDF',
  CODIGO_BARRAS: 'CODIGO_BARRAS',
  OCR: 'OCR',
  MANUAL: 'MANUAL',
  NAO_IDENTIFICADO: 'NAO_IDENTIFICADO',
}

// Mesmo vocabulário de 4 níveis que o scanner já usa em CONFIDENCE
// (src/features/nfeReader/analysisBuilder.js: ALTA/CONFERIR/BAIXA/
// NAO_ENCONTRADO) — só não importamos o enum de lá para não criar uma
// dependência de módulo por um punhado de strings; os NOMES são
// deliberadamente os mesmos para não inventar um vocabulário de confiança
// novo e paralelo ao que o scanner já estabeleceu.
export const CONFIANCA = {
  ALTA: 'ALTA',
  CONFERIR: 'CONFERIR',
  BAIXA: 'BAIXA',
  NAO_ENCONTRADO: 'NAO_ENCONTRADO',
}

// `origensChave` (analysisBuilder.js) traz os rótulos em português que o
// scanner já usa internamente, na ordem de prioridade que ele mesmo escolhe
// (texto do PDF > código de barras > OCR — ver extractor.js). Olhamos só a
// primeira posição (a origem "principal") e a traduzimos para um código
// estável que pertence à Portaria, não ao scanner.
const ORIGEM_PARA_METODO = {
  'texto do PDF': METODO_LEITURA.TEXTO_PDF,
  'código de barras': METODO_LEITURA.CODIGO_BARRAS,
  OCR: METODO_LEITURA.OCR,
}

function origemPrincipal(origensChave) {
  const [primeira] = origensChave || []
  return ORIGEM_PARA_METODO[primeira] || METODO_LEITURA.NAO_IDENTIFICADO
}

/**
 * Regra de confiança da Portaria — um único valor para o rascunho inteiro
 * (diferente do scanner, que dá uma confiança por campo). Critérios, só com
 * o que já existe no objeto de análise, nada inventado:
 *
 * - NAO_ENCONTRADO: `chaveValida` é falso — nenhuma chave passou no dígito
 *   verificador. Nada abaixo se aplica.
 * - Dali em diante a chave JÁ passou na validação do dígito verificador
 *   (mod-11), seja a origem texto do PDF, código de barras ou OCR — nunca é
 *   "talvez". Número da NF/série/CNPJ, derivados da própria chave, são
 *   sempre corretos quando a chave é válida. A diferença entre ALTA e
 *   CONFERIR aqui não é "a chave pode estar errada": é "algo no processo
 *   merece uma segunda olhada humana antes de confiar de olhos fechados".
 * - CONFERIR: a origem principal foi OCR (único estágio tratado pelo próprio
 *   scanner como último recurso, só tentado depois que texto do PDF e
 *   código de barras já falharam) OU o processo gerou algum aviso
 *   (`warnings.length > 0` — ex.: uma etapa anterior falhou mesmo que outra
 *   tenha encontrado a chave no fim).
 * - ALTA: chave válida, origem em texto do PDF ou código de barras, sem
 *   avisos no caminho.
 * - BAIXA: esta função nunca produz BAIXA — fica reservada ao rascunho de
 *   digitação manual (createMockManualDraft, em mockPortariaData.js), que
 *   não passa por aqui.
 */
function calcularConfianca(analysis) {
  if (!analysis?.chaveValida) return CONFIANCA.NAO_ENCONTRADO
  const viaOcr = (analysis.origensChave || [])[0] === 'OCR'
  const temAvisos = Boolean(analysis.warnings?.length)
  return viaOcr || temAvisos ? CONFIANCA.CONFERIR : CONFIANCA.ALTA
}

/**
 * Traduz o resultado de `analyzeNfeFile`/`analyzeNfeKey` para o formato de
 * rascunho da Portaria. Função pura: não modifica `analysis`, não lê nem
 * escreve nada fora do parâmetro recebido.
 */
export function mapAnalysisToArrivalDraft(analysis) {
  const chaveInterpretada = analysis?.chaveInterpretada || null
  const fields = analysis?.fields || {}

  const nfeChaveAcesso = chaveInterpretada?.chave || analysis?.referenciaNfe?.chaveAcesso?.value || ''

  // CNPJ formatado (com pontuação) — mesmo valor de `fields.cnpjFornecedor.value`
  // (os dois vêm de `interpretada.cnpjFormatado` em analysisBuilder.js); lido
  // direto da chave interpretada para não depender do formato interno de `fields`.
  const cnpjEmitente = chaveInterpretada?.cnpjFormatado || fields.cnpjFornecedor?.value || ''

  return {
    nfeChaveAcesso,
    numeroNf: fields.numeroNf?.value || '',
    serieNf: fields.serieNf?.value || '',
    cnpjEmitente,
    // Fornecedor nunca vem da chave — só do catálogo local do scanner
    // (supplierCatalog.js), quando o CNPJ já foi confirmado antes. Ausente é
    // esperado e legítimo, não um erro: fica string vazia para o operador
    // preencher na Revisão.
    fornecedor: fields.fornecedor?.value || '',
    metodoLeitura: origemPrincipal(analysis?.origensChave),
    confianca: calcularConfianca(analysis),
  }
}
