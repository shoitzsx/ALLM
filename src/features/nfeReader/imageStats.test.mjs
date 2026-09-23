import test from 'node:test'
import assert from 'node:assert/strict'
import { computeLuminanceStats } from './imageStats.js'

function solidRgba(r, g, b, count) {
  const data = []
  for (let i = 0; i < count; i++) data.push(r, g, b, 255)
  return data
}

test('imagem branca sólida: luminosidade máxima, contraste zero', () => {
  const { meanLuminance, stdDevContrast } = computeLuminanceStats(solidRgba(255, 255, 255, 100))
  assert.equal(meanLuminance, 255)
  assert.equal(stdDevContrast, 0)
})

test('imagem preta sólida: luminosidade zero, contraste zero', () => {
  const { meanLuminance, stdDevContrast } = computeLuminanceStats(solidRgba(0, 0, 0, 100))
  assert.equal(meanLuminance, 0)
  assert.equal(stdDevContrast, 0)
})

test('metade preta, metade branca: luminosidade média ~127, contraste alto', () => {
  const data = [...solidRgba(0, 0, 0, 50), ...solidRgba(255, 255, 255, 50)]
  const { meanLuminance, stdDevContrast } = computeLuminanceStats(data)
  assert.ok(meanLuminance > 120 && meanLuminance < 135, `esperava ~127, obteve ${meanLuminance}`)
  assert.ok(stdDevContrast > 100, `esperava alto contraste, obteve ${stdDevContrast}`)
})

test('array vazio não lança e devolve zeros', () => {
  assert.deepEqual(computeLuminanceStats([]), { meanLuminance: 0, stdDevContrast: 0 })
})
