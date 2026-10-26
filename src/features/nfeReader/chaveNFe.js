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

/**
 * Só o dígito verificador (módulo 11) — a checagem original deste arquivo,
 * antes da validação semântica abaixo. Isolada porque é só ARITMÉTICA sobre
 * 44 dígitos: não sabe (nem precisa saber) se os campos embutidos fazem
 * sentido. Exportada separada para teste e para instrumentação de
 * diagnóstico (decodeDiagnostics.js) que especificamente quer saber "o DV
 * bateu?", não "é uma NF-e de verdade?".
 */
export function validarDvChaveNFe(chaveRaw) {
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

// Único modelo de documento que este scanner interpreta/declara suportado —
// NF-e. Não há, em nenhum outro ponto do módulo (README, testes, UI), menção
// ou suporte a NFC-e (65), CT-e ou qualquer outro modelo: restringir a 55 não
// remove nenhuma capacidade existente, só nomeia explicitamente o que já era
// implicitamente assumido.
export const MODELO_NFE = '55'

/**
 * Dígitos verificadores do CNPJ (dois módulo 11, pesos padrão). Puro texto —
 * não confirma que o CNPJ existe na Receita, só que a sequência de 14
 * dígitos é matematicamente consistente com a regra de formação de um CNPJ
 * (o mesmo nível de garantia que o DV da própria chave já dá para a chave
 * inteira). Rejeita também os 14 dígitos iguais (ex. "00000000000000"), que
 * passariam no cálculo mas nunca são um CNPJ real emitido.
 */
export function validarCnpjDigitos(cnpjRaw) {
  const cnpj = normalizarChave(cnpjRaw)
  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false
  const digs = cnpj.split('').map(Number)
  const calcDv = (base, pesos) => {
    const soma = base.reduce((acc, d, i) => acc + d * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const dv1 = calcDv(digs.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  if (dv1 !== digs[12]) return false
  const dv2 = calcDv(digs.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return dv2 === digs[13]
}

/**
 * Validação COMPLETA de uma chave de acesso: 44 dígitos + DV + coerência
 * semântica dos campos embutidos (cUF, AAMM, CNPJ, modelo). Até aqui, só o
 * DV era checado — um falso positivo real foi encontrado em produção: uma
 * sequência de 44 dígitos passou no módulo 11 (10% de chance para dígitos
 * aleatórios — o DV é 1 dígito contra 10 possíveis, não é uma prova de
 * autenticidade) mas tinha cUF=40 (código de UF que não existe), AAMM com
 * mês 49 (impossível), modelo 02 (não é NF-e) e CNPJ com dígitos
 * verificadores inválidos — mesmo assim avançava para a revisão como se
 * fosse uma NF-e confiável. Esta função é o novo critério de "válida" usado
 * por TODO o módulo (interpretarChave, findValidNfeKeys, analyzeNfeKey,
 * classifyDecodedText) — não é um filtro paralelo que algum chamador possa
 * esquecer de aplicar.
 *
 * Não impõe política de ano mínimo/máximo (não há necessidade comprovada
 * ainda) — só que o mês exista (01–12).
 */
export function validarChaveNFe(chaveRaw) {
  const chave = normalizarChave(chaveRaw)
  if (!validarDvChaveNFe(chave)) return false

  const cUF = chave.slice(0, 2)
  if (!UF_POR_CODIGO[cUF]) return false

  const mes = Number(chave.slice(4, 6))
  if (mes < 1 || mes > 12) return false

  const modelo = chave.slice(20, 22)
  if (modelo !== MODELO_NFE) return false

  const cnpj = chave.slice(6, 20)
  if (!validarCnpjDigitos(cnpj)) return false

  return true
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
 * ("42260112...") ou separada por espaços, pontos, hífens e quebras de linha
 * ("4226 0112 3456 ..."). Nunca aceita uma sequência de 44 números só pelo
 * tamanho: cada candidata é validada pelo DV antes de entrar no resultado.
 * Retorna as chaves válidas únicas, na ordem em que aparecem no texto.
 */
// Uma "corrida" de dígitos com até um separador (espaço/tab/quebra de linha,
// ponto ou hífen) entre cada um — folga suficiente para chaves formatadas em
// blocos de 4, mas ainda restrita a dígito-separador-dígito-... (não pega
// frases inteiras cheias de números soltos).
const PADRAO_CORRIDA_DE_DIGITOS = /(?:\d[\s.-]?){44,88}/g

/** Toda janela de 44 dígitos, dentro de cada "corrida" de dígitos do texto, que passa em validarChaveNFe (DV + semântica). Núcleo de findValidNfeKeys, sem a priorização de rótulo abaixo — usado também para buscar só dentro de um recorte de texto já restrito. */
function buscarChavesValidasNoTexto(texto) {
  const candidatos = texto.match(PADRAO_CORRIDA_DE_DIGITOS) || []
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

// Rótulo impresso no DANFE imediatamente antes da chave — só para PRIORIZAR
// onde procurar primeiro, nunca para exigir (nem todo texto/OCR vai conter
// isto limpo). Chave de acesso formatada em blocos de 4 com espaços tem ~54
// caracteres; 160 dá folga para ruído de OCR entre o rótulo e os dígitos
// sem chegar a abranger outras seções da página (datas, totais, telefone).
const ROTULO_CHAVE_ACESSO = /chave\s+de\s+acesso/i
const JANELA_APOS_ROTULO = 160

/**
 * Busca chaves de 44 dígitos válidas num texto livre (PDF ou OCR).
 *
 * Quando o texto contém o rótulo "CHAVE DE ACESSO", busca PRIMEIRO numa
 * janela imediatamente após o rótulo — reduz o risco de colar dígitos de uma
 * região totalmente diferente da página (data, totais, telefone) só porque
 * ficaram "vizinhos" na mesma corrida de dígitos do texto corrido do OCR (foi
 * assim que um falso positivo real se formou: o OCR perdeu parte da chave
 * impressa e completou os 44 dígitos com números próximos no documento).
 * Resultados perto do rótulo vêm primeiro; o restante do texto continua
 * sendo buscado também (nunca perde uma chave válida que só apareça fora da
 * janela) — a MESMA validação de sempre (validarChaveNFe), nunca mais
 * permissiva, só reordenada por prioridade.
 */
export function findValidNfeKeys(texto) {
  if (!texto) return []
  const todasNoTexto = buscarChavesValidasNoTexto(texto)

  const rotulo = ROTULO_CHAVE_ACESSO.exec(texto)
  if (!rotulo) return todasNoTexto

  const inicioJanela = rotulo.index + rotulo[0].length
  const janela = texto.slice(inicioJanela, inicioJanela + JANELA_APOS_ROTULO)
  const proximasDoRotulo = buscarChavesValidasNoTexto(janela)
  if (!proximasDoRotulo.length) return todasNoTexto

  return [...new Set([...proximasDoRotulo, ...todasNoTexto])]
}

/**
 * Procura uma sequência de 44 dígitos válida dentro de um texto e retorna a
 * primeira encontrada (ou null). Atalho sobre `findValidNfeKeys`.
 */
export function buscarChaveNoTexto(texto) {
  return findValidNfeKeys(texto)[0] || null
}

/**
 * Verdadeiro se o texto contém qualquer sequência de 44 dígitos — válida ou
 * não. Usado só para distinguir, em `extractor.js`, "nada parecido com uma
 * chave foi encontrado" de "algo de 44 dígitos foi encontrado, mas não é uma
 * chave válida" (o caso do falso positivo real de OCR que motivou a
 * validação semântica acima) — a Portaria trata os dois casos de forma
 * diferente (ver scannerBridge.js/PortariaScanner.jsx).
 */
export function encontrouSequenciaDe44Digitos(texto) {
  if (!texto) return false
  const candidatos = texto.match(/(?:\d[\s.-]?){44,88}/g) || []
  return candidatos.some((bruto) => normalizarChave(bruto).length >= 44)
}
