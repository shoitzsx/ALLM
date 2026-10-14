/**
 * Geometria pura (proporções → retângulo em pixels) e a ordem de prioridade
 * de recortes — sem Canvas/DOM, testável em Node puro. Usa 768x1024 de
 * propósito: é a resolução real relatada num DANFE fotografado onde o
 * código de barras e o OCR não encontraram a chave (ver chaveNFe.test.mjs
 * para o caso de texto/OCR correspondente).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_REGIONS, BARCODE_CROP_ORDER, OCR_CROP_ORDER } from './pageRegions.js'

const WIDTH = 768
const HEIGHT = 1024

test('topo 25%/35%/metade superior cobrem a largura inteira, a partir do topo', () => {
  assert.deepEqual(PAGE_REGIONS.topo25.region(WIDTH, HEIGHT), { x: 0, y: 0, width: 768, height: 256 })
  assert.deepEqual(PAGE_REGIONS.topo35.region(WIDTH, HEIGHT), { x: 0, y: 0, width: 768, height: 358 })
  assert.deepEqual(PAGE_REGIONS.metadeSuperior.region(WIDTH, HEIGHT), { x: 0, y: 0, width: 768, height: 512 })
})

test('topo direito e topo esquerdo são complementares (mesma altura, juntos cobrem a largura com alguma sobreposição)', () => {
  const direito = PAGE_REGIONS.topoDireito.region(WIDTH, HEIGHT)
  const esquerdo = PAGE_REGIONS.topoEsquerdo.region(WIDTH, HEIGHT)
  assert.deepEqual(direito, { x: 269, y: 0, width: 499, height: 358 })
  assert.deepEqual(esquerdo, { x: 0, y: 0, width: 499, height: 358 })
  assert.equal(direito.x + direito.width, WIDTH, 'topo direito alcança a borda direita da imagem')
  assert.equal(esquerdo.x, 0, 'topo esquerdo começa na borda esquerda')
})

test('página inteira não tem região (sinal para "usar a imagem sem recortar")', () => {
  assert.equal(PAGE_REGIONS.paginaInteira.region, null)
})

test('BARCODE_CROP_ORDER tenta "topo direito" primeiro e inclui as 6 regiões de sempre, sem duplicar nem perder nenhuma', () => {
  assert.equal(BARCODE_CROP_ORDER.length, 6)
  assert.equal(BARCODE_CROP_ORDER[0], PAGE_REGIONS.topoDireito)
  assert.equal(BARCODE_CROP_ORDER.at(-1), PAGE_REGIONS.paginaInteira, 'página inteira continua sendo a última tentativa')
  assert.deepEqual(new Set(BARCODE_CROP_ORDER), new Set(Object.values(PAGE_REGIONS)))
})

test('OCR_CROP_ORDER é um subconjunto menor (3 regiões), também com "topo direito" primeiro', () => {
  assert.equal(OCR_CROP_ORDER.length, 3)
  assert.equal(OCR_CROP_ORDER[0], PAGE_REGIONS.topoDireito)
  assert.equal(OCR_CROP_ORDER[1], PAGE_REGIONS.topo35)
  assert.equal(OCR_CROP_ORDER[2], PAGE_REGIONS.paginaInteira)
})
