/**
 * Validação e interpretação da chave de acesso de 44 dígitos da NF-e.
 *
 * Algoritmo testado fora deste repositório contra uma NF real (dígito
 * verificador módulo 11 conferido, campos de UF/ano-mês/CNPJ/série/número
 * batendo). Reaproveitado aqui sem alterações na lógica.
 */

export function normalizarChave(v) {
  return (v || '').replace(/\D/g, '')
}

export function validarChaveNFe(chaveRaw) {
  const chave = normalizarChave(chaveRaw)
  if (chave.length !== 44) return false
  const digs = chave.split('').map(Number)
  const base = digs.slice(0, 43)
  const dvRecebido = digs[43]
  let peso = 2
  let soma = 0
  for (let i = base.length - 1; i >= 0; i--) {
    soma += base[i] * peso
    peso++
    if (peso > 9) peso = 2
  }
  let resto = soma % 11
  let dv = 11 - resto
  if (dv >= 10) dv = 0
  return dv === dvRecebido
}

export const UF_POR_CODIGO = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}

export function formatarCnpj(digits) {
  if (!digits || digits.length !== 14) return digits || ''
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`
}

export function interpretarChave(chaveRaw) {
  const chave = normalizarChave(chaveRaw)
  if (!validarChaveNFe(chave)) return null
  const anoMes = chave.slice(2, 6)
  return {
    chave,
    uf: chave.slice(0, 2),
    ufSigla: UF_POR_CODIGO[chave.slice(0, 2)] || null,
    anoMes,
    anoMesLabel: `20${anoMes.slice(0, 2)}/${anoMes.slice(2, 4)}`,
    cnpj: chave.slice(6, 20),
    cnpjFormatado: formatarCnpj(chave.slice(6, 20)),
    modelo: chave.slice(20, 22),
    serie: String(parseInt(chave.slice(22, 25), 10)),
    numeroNf: String(parseInt(chave.slice(25, 34), 10)),
    tipoEmissao: chave[34],
    codigoNumerico: chave.slice(35, 43),
    dv: chave[43],
  }
}

/**
 * Procura, dentro de um texto, todas as sequências de 44 dígitos que passem na
 * validação do dígito verificador — a chave pode aparecer corrida
 * ("42260748...") ou separada por espaços, pontos, hífens e quebras de linha
 * ("4226 0748 9095 ..."). Nunca aceita uma sequência de 44 números só pelo
 * tamanho: cada candidata é validada pelo DV antes de entrar no resultado.
 * Retorna as chaves válidas únicas, na ordem em que aparecem no texto.
 */
export function findValidNfeKeys(texto) {
  if (!texto) return []
  // Uma "corrida" de dígitos com até um separador (espaço/tab/quebra de linha,
  // ponto ou hífen) entre cada um — folga suficiente para chaves formatadas em
  // blocos de 4, mas ainda restrita a dígito-separador-dígito-... (não pega
  // frases inteiras cheias de números soltos).
  const candidatos = texto.match(/(?:\d[\s.-]?){44,88}/g) || []
  const encontradas = new Set()
  for (const bruto of candidatos) {
    const limpo = normalizarChave(bruto)
    for (let i = 0; i + 44 <= limpo.length; i++) {
      const trecho = limpo.slice(i, i + 44)
      if (validarChaveNFe(trecho)) encontradas.add(trecho)
    }
  }
  return [...encontradas]
}

/**
 * Procura uma sequência de 44 dígitos válida dentro de um texto e retorna a
 * primeira encontrada (ou null). Atalho sobre `findValidNfeKeys`.
 */
export function buscarChaveNoTexto(texto) {
  return findValidNfeKeys(texto)[0] || null
}
