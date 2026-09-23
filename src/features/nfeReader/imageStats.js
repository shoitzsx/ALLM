/**
 * Estatísticas simples e honestas de uma imagem capturada, para o painel de
 * diagnóstico do benchmark de decoders — luminosidade média e um contraste
 * aproximado (desvio padrão da luminosidade). Deliberadamente NÃO tenta
 * produzir um "score de qualidade" (ex. "83% de qualidade"): isso não tem
 * base científica e foi explicitamente pedido para não fazer. São só dois
 * números simples para o usuário comparar fotos entre si, olhando a imagem
 * congelada ao lado.
 *
 * `computeLuminanceStats` é pura (recebe os dados de pixel já extraídos, sem
 * depender de Canvas/DOM) — testável em Node puro.
 * `computeFrameStats` é o wrapper que depende de Canvas DOM.
 */

/** Luminosidade (ITU-R BT.601) média e desvio padrão sobre um array RGBA (Uint8ClampedArray ou equivalente indexável). */
export function computeLuminanceStats(rgbaData) {
  const pixelCount = rgbaData.length / 4
  if (pixelCount <= 0) return { meanLuminance: 0, stdDevContrast: 0 }

  let sum = 0
  for (let i = 0; i < rgbaData.length; i += 4) {
    sum += rgbaData[i] * 0.299 + rgbaData[i + 1] * 0.587 + rgbaData[i + 2] * 0.114
  }
  const mean = sum / pixelCount

  let variance = 0
  for (let i = 0; i < rgbaData.length; i += 4) {
    const gray = rgbaData[i] * 0.299 + rgbaData[i + 1] * 0.587 + rgbaData[i + 2] * 0.114
    variance += (gray - mean) ** 2
  }
  variance /= pixelCount

  return { meanLuminance: Math.round(mean), stdDevContrast: Math.round(Math.sqrt(variance)) }
}

/** Wrapper com Canvas DOM — usado pelo benchmark sobre o frame congelado (Modo A). */
export function computeFrameStats(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D indisponível ao calcular estatísticas do frame.')
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { meanLuminance, stdDevContrast } = computeLuminanceStats(data)
  return { width: canvas.width, height: canvas.height, meanLuminance, stdDevContrast }
}
