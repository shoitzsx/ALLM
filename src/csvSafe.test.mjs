import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CSV_FORMULA_GUARD, csvField, needsFormulaGuard, neutralizeFormula } from './csvSafe.js'
import { parseCsv } from './testSupport/csvReference.mjs'

// H-2 — a função central de serialização de célula, isolada. O comportamento dos exportadores reais
// (CSV completo, colunas, linhas, vários registros) está em csvExport.test.mjs.

test('o prefixo de proteção é um TAB', () => {
  assert.equal(CSV_FORMULA_GUARD, '\t')
})

test('começos de fórmula são detectados: = + - @ e variantes de largura total e menos Unicode', () => {
  for (const texto of ['=1+1', '+1+1', '-1+1', '@SUM(1,1)', '-A1', '+A1', '=', '@', '＝1', '＋1', '－1', '＠x', '﹦1', '﹢1', '﹣1', '﹫x', '−1']) {
    assert.equal(needsFormulaGuard(texto), true, JSON.stringify(texto))
  }
})

test('depois de espaços e controles invisíveis o primeiro caractere ainda conta', () => {
  for (const lead of [' ', '   ', '\u00a0', '\u2003', '\u3000', '\u0001', '\u001f', '\u007f', '\u0085', '\u00ad', '\u200b', '\u200e', '\u2060', '\ufeff', ' \u200b\u00a0']) {
    assert.equal(needsFormulaGuard(`${lead}=1+1`), true, JSON.stringify(lead))
    assert.equal(needsFormulaGuard(`${lead}@x`), true, JSON.stringify(lead))
  }
})

test('TAB, CR e LF no início também recebem proteção (lista da OWASP)', () => {
  for (const texto of ['\tabc', '\rabc', '\nabc', '\t', '\r\n=1']) assert.equal(needsFormulaGuard(texto), true, JSON.stringify(texto))
})

test('texto comum, números puros, "-" sozinho e vazio não são alterados', () => {
  for (const texto of ['', 'texto', 'Parafuso M8', '12', '-5', '+5', '1,5', '-1,5', '+0.25', '15/10/2026', '2026-10-15', 'ABC-123', 'a=b', 'x+y', 'a@b.com', ' texto', '-', '"=1+1', "'=1+1"]) {
    assert.equal(needsFormulaGuard(texto), false, JSON.stringify(texto))
    assert.equal(neutralizeFormula(texto), texto)
  }
})

test('-A1, -1+1 e +1+1 (começam com sinal mas não são número puro) continuam protegidos', () => {
  for (const texto of ['-A1', '-1+1', '+1+1', '-5 ', '- 5', '--1', '-1e5', '-1.', '-.5']) assert.equal(needsFormulaGuard(texto), true, JSON.stringify(texto))
})

test('neutralizeFormula põe um único TAB na frente e não toca no resto', () => {
  assert.equal(neutralizeFormula('=1+1'), '\t=1+1')
  assert.equal(neutralizeFormula('\t=1+1'), '\t\t=1+1')
  assert.equal(neutralizeFormula(' =A1'), '\t =A1')
})

test('neutralizar é seguro para repetir só uma vez: o resultado já não é lido como fórmula pela planilha (TAB na frente)', () => {
  const uma = neutralizeFormula('=1+1')
  assert.equal(uma[0], '\t')
  assert.equal(uma.slice(1), '=1+1')
})

test('csvField: texto comum sai sem aspas; com delimitador, aspas ou quebra de linha, entre aspas com aspas dobradas', () => {
  assert.equal(csvField('Simples'), 'Simples')
  assert.equal(csvField('Com, vírgula'), 'Com, vírgula')
  assert.equal(csvField('Com; ponto e vírgula'), '"Com; ponto e vírgula"')
  assert.equal(csvField('Com "aspas"'), '"Com ""aspas"""')
  assert.equal(csvField('a\nb'), '"a\nb"')
  assert.equal(csvField('a\rb'), '"a\rb"')
  assert.equal(csvField('Com, vírgula', ','), '"Com, vírgula"')
})

test('csvField: célula perigosa vai entre aspas com TAB na frente, mesmo sem delimitador', () => {
  assert.equal(csvField('=1+1'), '"\t=1+1"')
  assert.equal(csvField('@SUM(1,1)', ','), '"\t@SUM(1,1)"')
  assert.equal(csvField('=1+1;=2+2'), '"\t=1+1;=2+2"')
  assert.equal(csvField('=a"b'), '"\t=a""b"')
})

test('csvField: null, undefined e vazio viram célula vazia; números JS não são alterados (inclusive negativos)', () => {
  assert.equal(csvField(null), '')
  assert.equal(csvField(undefined), '')
  assert.equal(csvField(''), '')
  assert.equal(csvField(0), '0')
  assert.equal(csvField(-5), '-5')
  assert.equal(csvField(7.5), '7.5')
  assert.equal(csvField(true), 'true')
})

test('csvField: número JS nunca é alterado, nem os que o JS escreve com expoente ou sem ser finitos', () => {
  assert.equal(csvField(-1e-7), '-1e-7')
  assert.equal(csvField(1e21), '1e+21')
  assert.equal(csvField(-Infinity), '-Infinity')
  assert.equal(csvField(NaN), 'NaN')
})

test('csvField: o que o parser lê de volta é o valor original (ou o original com um TAB na frente)', () => {
  const valores = ['=1+1', 'x";=1+1', 'a;b', 'linha\nlinha', ' =1', '\t=2', 'normal', '', 'Ação — café', '＝x', '"', '""', ';', ';;']
  for (const delimiter of [';', ',', '|']) {
    const linha = valores.map((v) => csvField(v, delimiter)).join(delimiter)
    const [lido] = parseCsv(linha, delimiter)
    assert.equal(lido.length, valores.length, `células com delimitador ${delimiter}`)
    lido.forEach((celula, i) => {
      const esperado = needsFormulaGuard(valores[i]) ? '\t' + valores[i] : valores[i]
      assert.equal(celula, esperado, JSON.stringify(valores[i]))
    })
  }
})

test('nenhuma entrada, por mais estranha que seja, faz o parser achar mais ou menos células que o esperado (fuzz determinístico)', () => {
  // PRNG simples e fixo (mulberry32): reproduzível.
  let estado = 0x2f6e2b1
  const aleatorio = () => {
    estado = (estado + 0x6d2b79f5) | 0
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const alfabeto = ['=', '+', '-', '@', '"', ';', ',', '\t', '\r', '\n', ' ', 'a', 'Z', '1', '＝', '\u00a0', '\u0001', 'ç', '|', '\u200b']
  for (let rodada = 0; rodada < 300; rodada += 1) {
    const celulas = [...Array.from({ length: 1 + Math.floor(aleatorio() * 6) }, () => Array.from({ length: Math.floor(aleatorio() * 8) }, () => alfabeto[Math.floor(aleatorio() * alfabeto.length)]).join('')), 'fim'] // "fim": uma linha de uma só célula vazia é ambígua no CSV; as exportações reais têm 5 ou mais colunas
    for (const delimiter of [';', ',']) {
      const texto = [celulas.map((c) => csvField(c, delimiter)).join(delimiter), celulas.map((c) => csvField(c, delimiter)).join(delimiter)].join('\r\n')
      const linhas = parseCsv(texto, delimiter)
      assert.equal(linhas.length, 2, JSON.stringify(celulas))
      for (const linha of linhas) {
        assert.equal(linha.length, celulas.length, JSON.stringify(celulas))
        linha.forEach((celula, i) => {
          const esperado = needsFormulaGuard(celulas[i]) ? '\t' + celulas[i] : celulas[i]
          assert.equal(celula, esperado)
          // regra de segurança independente do detector: se a célula lida começa com um caractere de fórmula,
          // só pode ser número puro
          if (/^[=+\-@＝＋－＠]/.test(celula)) assert.match(celula, /^[+-]?\d+(?:[.,]\d+)?$|^-$/)
        })
      }
    }
  }
})
