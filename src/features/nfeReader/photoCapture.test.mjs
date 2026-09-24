import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDownscaledDimensions, isImageCaptureSupported, MAX_PHOTO_DIMENSION } from './photoCapture.js'

test('imagem dentro do teto não é reduzida', () => {
  const result = computeDownscaledDimensions(2000, 1500, 4096)
  assert.deepEqual(result, { width: 2000, height: 1500, downscaled: false })
})

test('imagem exatamente no teto não é reduzida', () => {
  const result = computeDownscaledDimensions(4096, 2000, 4096)
  assert.equal(result.downscaled, false)
})

test('imagem gigantesca é reduzida proporcionalmente ao teto', () => {
  const result = computeDownscaledDimensions(8000, 4000, 4096)
  assert.equal(result.downscaled, true)
  assert.equal(result.width, 4096)
  assert.equal(result.height, 2048)
})

test('lado vertical maior também respeita o teto', () => {
  const result = computeDownscaledDimensions(3000, 9000, 4096)
  assert.equal(result.downscaled, true)
  assert.equal(result.height, 4096)
  assert.equal(result.width, Math.round(3000 * (4096 / 9000)))
})

test('usa MAX_PHOTO_DIMENSION como teto padrão', () => {
  const result = computeDownscaledDimensions(MAX_PHOTO_DIMENSION * 2, MAX_PHOTO_DIMENSION)
  assert.equal(result.downscaled, true)
  assert.equal(result.width, MAX_PHOTO_DIMENSION)
})

test('isImageCaptureSupported reflete globalThis.ImageCapture (feature detection, nunca user-agent)', () => {
  const original = globalThis.ImageCapture
  try {
    delete globalThis.ImageCapture
    assert.equal(isImageCaptureSupported(), false)
    globalThis.ImageCapture = function ImageCapture() {}
    assert.equal(isImageCaptureSupported(), true)
  } finally {
    if (original === undefined) delete globalThis.ImageCapture
    else globalThis.ImageCapture = original
  }
})
