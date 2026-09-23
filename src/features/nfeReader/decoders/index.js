/**
 * Ponto de entrada único da camada comum de decoders do benchmark de
 * diagnóstico — ver decoderTypes.js para o formato de resultado
 * compartilhado e o porquê da validação ficar centralizada ali.
 */
export { buildDecodeResult, ENGINE, ENGINE_LABEL, maskValue, unavailableResult } from './decoderTypes.js'
export { decodeWithNativeBarcodeDetector, isNativeAvailable } from './nativeDecoder.js'
export { decodeWithProductionPipeline, decodeWithZxing, isZxingAvailable } from './zxingDecoder.js'
export { decodeWithZbar, isZbarAvailable } from './zbarDecoder.js'
