/**
 * Formata `track.getSettings()`/`track.getCapabilities()` para exibição no
 * painel de diagnóstico — separando explicitamente o que a câmera SUPORTA
 * (capabilities) do que está REALMENTE ATIVO (settings), como pedido: nunca
 * assumir que uma constraint pedida "pegou" só porque não houve erro.
 *
 * `summarizeCameraState` é pura (recebe os objetos planos já obtidos de
 * `getSettings()`/`getCapabilities()`, nunca o MediaStreamTrack em si) —
 * testável em Node puro. Quem chama trata a ausência de uma capability como
 * "N/D" (não disponível/não reportado pelo navegador), nunca inventa um
 * valor.
 */

const NA = 'N/D'

function formatRange(range) {
  if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') return NA
  return `${range.min}–${range.max}`
}

export function summarizeCameraState(settings = {}, capabilities = {}) {
  return {
    resolution: settings.width && settings.height ? `${settings.width}×${settings.height}` : NA,
    facingMode: settings.facingMode || NA,
    focusModeCapability: Array.isArray(capabilities.focusMode) && capabilities.focusMode.length
      ? capabilities.focusMode.join(', ')
      : NA,
    focusModeCurrent: settings.focusMode || NA,
    zoomCapability: formatRange(capabilities.zoom),
    zoomCurrent: typeof settings.zoom === 'number' ? String(settings.zoom) : NA,
  }
}
