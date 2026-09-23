import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeCameraState } from './cameraCapabilities.js'

test('resume settings + capabilities completos', () => {
  const result = summarizeCameraState(
    { width: 1280, height: 720, facingMode: 'environment', focusMode: 'continuous', zoom: 1.5 },
    { focusMode: ['continuous', 'manual'], zoom: { min: 1, max: 4 } },
  )
  assert.deepEqual(result, {
    resolution: '1280×720',
    facingMode: 'environment',
    focusModeCapability: 'continuous, manual',
    focusModeCurrent: 'continuous',
    zoomCapability: '1–4',
    zoomCurrent: '1.5',
  })
})

test('sem settings/capabilities nenhum, tudo N/D — nunca inventa valor', () => {
  const result = summarizeCameraState()
  assert.deepEqual(result, {
    resolution: 'N/D',
    facingMode: 'N/D',
    focusModeCapability: 'N/D',
    focusModeCurrent: 'N/D',
    zoomCapability: 'N/D',
    zoomCurrent: 'N/D',
  })
})

test('zoom atual 0 continua mostrado (não confundido com ausência)', () => {
  const result = summarizeCameraState({ zoom: 0 }, {})
  assert.equal(result.zoomCurrent, '0')
})
