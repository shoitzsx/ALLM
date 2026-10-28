import React, { useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Camera, FileText, Image as ImageIcon, Keyboard, Loader2, Upload } from 'lucide-react'
import { FieldError, formatFileSize } from '../../../ui.jsx'
import { analyzeNfeFile, analyzeNfeKey } from '../../nfeReader/extractor.js'
import NfePhotoCapture from '../../nfeReader/NfePhotoCapture.jsx'
import { mapAnalysisToArrivalDraft, ORIGEM_MANUAL } from '../scannerBridge.js'

// Mesmos tipos aceitos hoje por "Selecionar arquivo" em
// src/features/nfeReader/NfeReaderPage.jsx — não inventa uma allowlist
// nova, só espelha a existente.
const SCANNER_FILE_ACCEPT = 'application/pdf,image/jpeg,image/png'

// Mostrada ao operador quando o scanner achou 44 dígitos (DV e/ou semântica
// incoerentes — ver chaveNFe.js, validarChaveNFe) em vez da mensagem
// genérica de "nada encontrado": algo FOI lido, só não é uma NF-e real.
// Detalhe técnico (qual checagem falhou) fica só em analysis.warnings
// (DEV/console), nunca aqui.
const CHAVE_INVALIDA_MESSAGE =
  'Foi encontrada uma sequência de 44 dígitos, mas ela não forma uma chave NF-e válida. Tente novamente ou digite a chave manualmente.'

/**
 * Experiência de scanner da Portaria — visualmente a mesma de "Leitura
 * automática de NF-e" (NfeReaderPage.jsx): reaproveita as classes GLOBAIS
 * .upload-zone/.nfe-source-actions/.nfe-source-action/.file-list/.file-row
 * (definidas em src/styles.css, usadas por NfeReaderPage, nenhuma delas
 * específica de nfeReader) em vez dos três cards iguais da versão anterior.
 * Lógica de leitura idêntica à versão anterior deste componente (antes
 * PortariaStart.jsx) — zero duplicação do motor: analyzeNfeFile/analyzeNfeKey
 * e NfePhotoCapture continuam vindo só de src/features/nfeReader/**.
 */
export function PortariaScanner({ onFileAnalyzed }) {
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [manualError, setManualError] = useState('')
  const [analyzingFile, setAnalyzingFile] = useState(false)
  const [fileError, setFileError] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false)
  const fileInputRef = useRef(null)

  const digitsOnly = manualValue.replace(/\D/g, '')
  const canContinue = digitsOnly.length === 44

  /**
   * Mesma regra de confiança de qualquer outra origem: a validação e a
   * interpretação continuam pertencendo ao scanner (analyzeNfeKey), nunca
   * reimplementadas aqui. DV inválido (ou qualquer outro motivo de
   * chaveValida=false) mantém o operador no formulário, sem avançar e sem
   * inventar número da NF/série/CNPJ.
   */
  function handleManualSubmit(event) {
    event.preventDefault()
    if (!canContinue) return
    setManualError('')
    try {
      const analysis = analyzeNfeKey(digitsOnly, ORIGEM_MANUAL)
      if (!analysis.chaveValida) {
        setManualError('Chave NF-e inválida. Confira os 44 dígitos.')
        return
      }
      const draft = mapAnalysisToArrivalDraft(analysis)
      onFileAnalyzed(draft)
      setManualValue('')
      setManualOpen(false)
    } catch (error) {
      console.error('[Portaria] Falha ao validar a chave digitada manualmente.', error)
      setManualError('Não foi possível validar a chave. Tente novamente.')
    }
  }

  async function handleFileSelected(event) {
    const selected = event.target.files?.[0] || null
    event.target.value = ''
    if (!selected || analyzingFile) return
    setFileError('')
    setSelectedFile(selected)
    setAnalyzingFile(true)
    try {
      const analysis = await analyzeNfeFile(selected)
      if (!analysis.chaveValida && analysis.candidataInvalidaEncontrada) {
        setFileError(CHAVE_INVALIDA_MESSAGE)
        return
      }
      const draft = mapAnalysisToArrivalDraft(analysis)
      onFileAnalyzed(draft)
    } catch (error) {
      console.error('[Portaria] Falha ao analisar arquivo selecionado.', error)
      setFileError(error?.message || 'Não foi possível analisar o arquivo selecionado. Tente novamente.')
    } finally {
      setAnalyzingFile(false)
    }
  }

  /**
   * NfePhotoCapture já valida a chave internamente (via analyzeNfeCanvas)
   * antes de chamar onKeyFound — mesmo assim, revalidamos aqui com
   * analyzeNfeKey, igual a NfeReaderPage.handleScannedKey, para nunca confiar
   * cegamente no chamador (mesmo padrão documentado em analysisBuilder.js).
   * Envolvido em try/catch: uma falha inesperada aqui não deve quebrar a
   * Portaria, só impedir o avanço e deixar o operador tentar de novo.
   */
  function handleCameraKeyFound(chave, origem) {
    setPhotoCaptureOpen(false)
    try {
      const analysis = analyzeNfeKey(chave, origem)
      if (!analysis.chaveValida && analysis.candidataInvalidaEncontrada) {
        setFileError(CHAVE_INVALIDA_MESSAGE)
        return
      }
      const draft = mapAnalysisToArrivalDraft(analysis)
      onFileAnalyzed(draft)
    } catch (error) {
      console.error('[Portaria] Falha ao processar a chave capturada pela câmera.', error)
      setFileError('Não foi possível processar a chave capturada. Tente novamente.')
    }
  }

  /**
   * ImageCapture indisponível ou falhou em tempo de execução — em vez de
   * duplicar um segundo caminho de arquivo, fecha a câmera e aciona o MESMO
   * input real de "Selecionar arquivo" (mesmo pipeline analyzeNfeFile já
   * usado acima), igual ao padrão de NfeReaderPage.handlePhotoCaptureFallback.
   */
  function handleCameraFallback() {
    setPhotoCaptureOpen(false)
    fileInputRef.current?.click()
  }

  /**
   * Foto tirada mas nenhuma chave válida encontrada. Dois casos possíveis:
   * nada parecido com 44 dígitos foi achado (não é erro — traduzimos o
   * resultado vazio pelo mesmo scannerBridge e entregamos à MESMA Revisão
   * usada por qualquer outra origem, campos em branco para completar ali);
   * ou achou 44 dígitos que não são uma chave válida (DV/semântica) —
   * `candidataInvalidaEncontrada` distingue os dois (ver analysisBuilder.js).
   */
  function handleCameraManualFill(result) {
    setPhotoCaptureOpen(false)
    if (!result) return
    if (!result.chaveValida && result.candidataInvalidaEncontrada) {
      setFileError(CHAVE_INVALIDA_MESSAGE)
      return
    }
    onFileAnalyzed(mapAnalysisToArrivalDraft(result))
  }

  return (
    <>
      <section className="panel">
        <header className="panel-header">
          <div>
            <h2>Scanner NF-e</h2>
            <p>Selecione o arquivo, fotografe o código de barras ou digite a chave de acesso.</p>
          </div>
        </header>
        <div className="detail-section-body">
          <div className="nfe-source-actions">
            <label className="upload-zone">
              {analyzingFile ? <Loader2 size={19} className="spin" /> : <Upload size={19} />}
              <strong>{analyzingFile ? 'Analisando nota fiscal…' : 'Selecionar arquivo'}</strong>
              <span>{analyzingFile ? 'Isso pode levar alguns segundos' : 'PDF ou imagem da NF-e (DANFE)'}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept={SCANNER_FILE_ACCEPT}
                disabled={analyzingFile}
                onChange={handleFileSelected}
              />
            </label>

            <button type="button" className="nfe-source-action" onClick={() => setPhotoCaptureOpen(true)} disabled={analyzingFile}>
              <Camera size={16} />
              <span>Fotografar código</span>
            </button>

            <button
              type="button"
              className="nfe-source-action"
              onClick={() => setManualOpen((open) => !open)}
              aria-expanded={manualOpen}
              disabled={analyzingFile}
            >
              <Keyboard size={16} />
              <span>Digitar chave manualmente</span>
            </button>
          </div>

          {selectedFile ? (
            <div className="file-list">
              <div className="file-row">
                <span className="file-row-icon">
                  {selectedFile.type.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />}
                </span>
                <div><strong>{selectedFile.name}</strong><span>{formatFileSize(selectedFile.size)}</span></div>
              </div>
            </div>
          ) : null}

          {fileError ? (
            <div className="info-strip warning portaria-file-error">
              <AlertTriangle size={15} />
              <span>{fileError}</span>
            </div>
          ) : null}

          {manualOpen ? (
            <form className="portaria-manual-form" onSubmit={handleManualSubmit}>
              <div className="field field-full">
                <label htmlFor="portaria-manual-chave">
                  Chave de acesso da NF-e
                  <span className="field-help-inline">{digitsOnly.length}/44 dígitos</span>
                </label>
                <input
                  id="portaria-manual-chave"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Digite ou cole os 44 números da chave"
                  value={manualValue}
                  onChange={(event) => { setManualValue(event.target.value); setManualError('') }}
                  className={manualError ? 'error' : ''}
                />
                <FieldError>{manualError}</FieldError>
              </div>
              <div className="portaria-manual-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => { setManualOpen(false); setManualValue(''); setManualError('') }}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={!canContinue || analyzingFile}>
                  Continuar <ArrowRight size={16} />
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      <NfePhotoCapture
        open={photoCaptureOpen}
        onClose={() => setPhotoCaptureOpen(false)}
        onKeyFound={handleCameraKeyFound}
        onFallbackToFilePicker={handleCameraFallback}
        onManualFill={handleCameraManualFill}
      />
    </>
  )
}
