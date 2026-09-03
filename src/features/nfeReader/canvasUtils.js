/**
 * Primitivas de canvas DOM reaproveitadas pela leitura de código de barras
 * (barcodeReader.js) e pelo OCR de último recurso (ocrReader.js). Sempre
 * cria/retorna um HTMLCanvasElement DOM comum, nunca alguma implementação de
 * canvas de outra camada (ex. do pdf.js) — é isso que evita entregar ao
 * ZXing/tesseract.js algo que não se comporte como um canvas normal.
 */

export function cloneToDomCanvas(source) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D indisponível ao clonar canvas de origem.')
  }
  ctx.drawImage(source, 0, 0)
  return canvas
}

/** Recorta uma região retangular de um canvas para um novo HTMLCanvasElement DOM. */
export function cropCanvas(source, x, y, width, height) {
  const clampedX = Math.max(0, Math.min(x, source.width))
  const clampedY = Math.max(0, Math.min(y, source.height))
  const clampedWidth = Math.max(1, Math.min(width, source.width - clampedX))
  const clampedHeight = Math.max(1, Math.min(height, source.height - clampedY))

  const canvas = document.createElement('canvas')
  canvas.width = clampedWidth
  canvas.height = clampedHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D indisponível ao recortar canvas.')
  }
  ctx.drawImage(source, clampedX, clampedY, clampedWidth, clampedHeight, 0, 0, clampedWidth, clampedHeight)
  return canvas
}

/** Rotaciona um canvas para um novo HTMLCanvasElement DOM (0/90/180/270). */
export function rotateCanvas(source, degrees) {
  const angle = ((degrees % 360) + 360) % 360
  if (angle === 0) return cloneToDomCanvas(source)

  const canvas = document.createElement('canvas')
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('Browser não forneceu HTMLCanvasElement válido.')
  }

  const swap = angle === 90 || angle === 270
  canvas.width = swap ? source.height : source.width
  canvas.height = swap ? source.width : source.height

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Não foi possível obter CanvasRenderingContext2D ao rotacionar canvas.')
  }

  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((angle * Math.PI) / 180)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

/** Amplia um canvas com suavização desligada — suavizar borra barras finas de código de barras e traços de dígitos. */
export function upscaleCanvas(source, scale) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * scale)
  canvas.height = Math.round(source.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D indisponível ao ampliar canvas.')
  }
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Converte para escala de cinza e aplica limiar (preto/branco), para digitalizações de baixo contraste. */
export function thresholdCanvas(source, threshold) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Canvas 2D indisponível ao aplicar limiar de contraste.')
  }
  ctx.drawImage(source, 0, 0)

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    const value = gray > threshold ? 255 : 0
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
