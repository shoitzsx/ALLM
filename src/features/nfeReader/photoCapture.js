/**
 * Captura de foto de alta qualidade para leitura de código de barras — usado
 * por `NfePhotoCapture.jsx` quando o `BarcodeDetector` nativo não existe (ou
 * quando o live fast path não achou a chave rápido o bastante, ver
 * `NfeLiveScanner.jsx`/`NfeReaderPage.jsx`).
 *
 * Dois métodos, com fallback automático (feature detection, nunca
 * user-agent):
 *
 *   A. `ImageCapture` API (`takePhotoViaImageCapture`) — pega um frame de
 *      qualidade mais alta que a maioria das câmeras entrega via
 *      `getUserMedia` puro, sobre uma MediaStreamTrack já aberta. Suportado
 *      em Chromium e em Safari moderno, mas o comportamento real varia por
 *      aparelho — por isso NUNCA presumimos resolução (nada de "12MP"/"alta
 *      resolução garantida" na UI ou no código): a imagem recebida é sempre
 *      medida (`width`/`height` reais), nunca assumida.
 *   B. `<input type="file" accept="image/*" capture="environment">` — o
 *      mesmo mecanismo que já existe em `NfeReaderPage.jsx` ("Tirar foto"),
 *      que entrega o app de câmera nativo do sistema operacional. Usado como
 *      fallback quando `ImageCapture` não existe OU `takePhoto()` lança em
 *      tempo de execução (comportamento varia por aparelho mesmo dentro do
 *      mesmo navegador) — nunca deixamos isso virar um crash, `NfePhotoCapture.jsx`
 *      encaminha para o input existente nesse caso.
 */

/** Pura feature detection — nunca user-agent. */
export function isImageCaptureSupported() {
  return typeof globalThis.ImageCapture === 'function'
}

/**
 * Tira uma foto da MediaStreamTrack de vídeo fornecida via `ImageCapture`.
 * Devolve o `Blob` bruto — quem chamar decide como processar (ver
 * `blobToCanvas` abaixo). Pode lançar (aparelho/navegador com suporte
 * inconsistente à API) — quem chamar deve tratar e cair para o input de
 * câmera nativo, nunca mostrar um crash.
 */
export async function takePhotoViaImageCapture(videoTrack) {
  const capture = new globalThis.ImageCapture(videoTrack)
  return capture.takePhoto()
}

// Teto de segurança para não estourar memória de canvas em celular com uma
// foto gigantesca (mesma ordem de grandeza do teto já usado para renderizar
// PDF, `MAX_RENDER_DIMENSION = 4200` em pdfExtractor.js) — NÃO é uma
// resolução "padrão" para a qual tudo é reduzido: só entra em ação acima
// deste teto, e é medido/logado quando acontece (ver `blobToCanvas`). Nunca
// reduz para 720p ou qualquer valor fixo baixo.
export const MAX_PHOTO_DIMENSION = 4096

/**
 * Calcula as dimensões finais — reduz proporcionalmente só se o maior lado
 * ultrapassar `maxDimension`, senão devolve as dimensões originais
 * inalteradas. Pura — testável em Node, sem depender de Canvas/Image.
 */
export function computeDownscaledDimensions(width, height, maxDimension = MAX_PHOTO_DIMENSION) {
  const largestSide = Math.max(width, height)
  if (largestSide <= maxDimension) {
    return { width, height, downscaled: false }
  }
  const scale = maxDimension / largestSide
  return { width: Math.round(width * scale), height: Math.round(height * scale), downscaled: true }
}

/**
 * Carrega um Blob de foto (de `takePhotoViaImageCapture` ou de um `File` do
 * input de câmera) num canvas, na resolução real da imagem — só reduz se o
 * maior lado ultrapassar `MAX_PHOTO_DIMENSION` (proteção de memória, não uma
 * redução cega). Devolve as dimensões originais e se houve redução, para
 * instrumentação (dev).
 */
export async function blobToCanvas(blob) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Não foi possível carregar a foto capturada.'))
      img.src = objectUrl
    })

    const originalWidth = image.naturalWidth
    const originalHeight = image.naturalHeight
    const { width: targetWidth, height: targetHeight, downscaled } = computeDownscaledDimensions(originalWidth, originalHeight)

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 2D indisponível ao processar a foto capturada.')
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

    if (downscaled && import.meta.env.DEV) {
      console.debug(
        `[NFe][foto] imagem grande reduzida por segurança de memória: ${originalWidth}x${originalHeight} → ${targetWidth}x${targetHeight} (teto ${MAX_PHOTO_DIMENSION}px)`,
      )
    }

    return { canvas, originalWidth, originalHeight, width: targetWidth, height: targetHeight, downscaled }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
