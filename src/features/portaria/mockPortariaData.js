// Dados e helpers 100% simulados para a primeira versão visual da Portaria.
// Nada aqui chama backend, Supabase, Sheets ou Drive — é só para a UI ter
// algo plausível para mostrar antes da integração real existir.

// Valores internos da UI da Portaria (ver src/features/portaria/scannerBridge.js)
// — não é contrato de API/backend. ZBAR/ZXING continuam aqui por
// compatibilidade com os rascunhos simulados antigos deste arquivo;
// TEXTO_PDF/CODIGO_BARRAS/OCR/NAO_IDENTIFICADO são os códigos que
// scannerBridge.js produz a partir do scanner real.
export const METODO_LEITURA_LABELS = {
  ZBAR: 'Leitor de código de barras',
  ZXING: 'Leitor alternativo de imagem',
  MANUAL: 'Digitação manual',
  TEXTO_PDF: 'Texto do PDF',
  CODIGO_BARRAS: 'Código de barras',
  OCR: 'OCR',
  NAO_IDENTIFICADO: 'Não identificado',
}

// Mesma ideia de METODO_LEITURA_LABELS acima: valores internos da UI da
// Portaria, não contrato de API/backend. MEDIA continua aqui por
// compatibilidade com os rascunhos simulados antigos (createMockManualDraft
// não produz MEDIA hoje, mas o rótulo fica preservado); CONFERIR e
// NAO_ENCONTRADO são os códigos que scannerBridge.js produz a partir do
// scanner real. O rótulo de texto sempre acompanha a cor (tone) — nenhum
// estado depende só de cor para ser identificado.
export const CONFIANCA_META = {
  ALTA: { label: 'Alta', tone: 'success' },
  CONFERIR: { label: 'Conferir', tone: 'warning' },
  MEDIA: { label: 'Média', tone: 'warning' },
  BAIXA: { label: 'Baixa', tone: 'danger' },
  NAO_ENCONTRADO: { label: 'Não encontrado', tone: 'danger' },
}

export const STATUS_META = {
  REGISTRADA: { label: 'Registrada', tone: 'success' },
  PENDENTE: { label: 'Pendente', tone: 'warning' },
}

export const DIVERGENCIA_TIPOS = [
  'Quantidade incorreta',
  'Material avariado',
  'Material diferente do solicitado',
  'Falta de documentação',
  'Problema de embalagem',
  'Outros',
]

function pad(value, length) {
  return String(value).padStart(length, '0')
}

export function nowLabel() {
  const now = new Date()
  return `${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}`
}

export function generateCodigo() {
  const random = Math.floor(Math.random() * 1_000_000)
  return `CHG-${pad(random, 8)}`
}

export const mockTodayArrivals = [
  {
    id: 'mock-arrival-1',
    codigo: 'CHG-00000123',
    numeroNf: '438271',
    serieNf: '1',
    cnpjEmitente: '12345678000190',
    fornecedor: 'Fornecedor de teste',
    nfeChaveAcesso: '00000000000000000000000000000000000000000000',
    metodoLeitura: 'ZBAR',
    confianca: 'ALTA',
    status: 'REGISTRADA',
    criadoEm: '08:42',
  },
  {
    id: 'mock-arrival-2',
    codigo: 'CHG-00000124',
    numeroNf: '91840',
    serieNf: '2',
    cnpjEmitente: '98765432000110',
    fornecedor: 'Metalúrgica Exemplo Ltda',
    nfeChaveAcesso: '00000000000000000000000000000000000000000001',
    metodoLeitura: 'ZXING',
    confianca: 'MEDIA',
    status: 'REGISTRADA',
    criadoEm: '09:17',
  },
  {
    id: 'mock-arrival-3',
    codigo: 'CHG-00000125',
    numeroNf: '',
    serieNf: '',
    cnpjEmitente: '',
    fornecedor: 'Distribuidora Simulada S.A.',
    nfeChaveAcesso: '',
    metodoLeitura: 'MANUAL',
    confianca: 'BAIXA',
    status: 'PENDENTE',
    criadoEm: '10:05',
  },
]

/**
 * Monta um rascunho a partir de uma chave digitada manualmente. Os demais
 * campos ficam em branco de propósito — na Revisão o usuário completa.
 */
export function createMockManualDraft(chave) {
  return {
    id: `mock-draft-${Date.now()}`,
    codigo: generateCodigo(),
    numeroNf: '',
    serieNf: '',
    cnpjEmitente: '',
    fornecedor: '',
    nfeChaveAcesso: chave || '',
    metodoLeitura: 'MANUAL',
    confianca: 'BAIXA',
    status: 'PENDENTE',
    criadoEm: nowLabel(),
  }
}
