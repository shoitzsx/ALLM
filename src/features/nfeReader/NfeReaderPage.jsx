import React, { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Copy,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  PencilLine,
  RefreshCw,
  ScanBarcode,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { analyzeNfeFile, analyzeNfeKey, CONFIDENCE } from './extractor.js'
import { saveSupplier } from './supplierCatalog.js'
import { formatFileSize } from '../../ui.jsx'
import NfeLiveScanner from './NfeLiveScanner.jsx'

/**
 * Disponibilidade de "Tirar foto"/"Escanear código de barras" é decidida por
 * CAPACIDADE do dispositivo, não pela largura da viewport — um tablet em
 * landscape (1024px, 1180px...) tem câmera e toque como qualquer outro
 * tablet, só porque a janela é larga não deixa de ser um aparelho com câmera.
 * Nada de user-agent/lista de aparelhos (ver README do módulo).
 *
 * `getUserMedia` e capacidade de toque não mudam durante a sessão, então
 * calculamos uma vez no carregamento do módulo, não a cada render nem em
 * listener de resize.
 */
const CAMERA_SUPPORTED = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
const TOUCH_CAPABLE =
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0)

// "Tirar foto" dispara o app de câmera nativo via capture="environment" — só faz sentido nessa forma em
// aparelho de toque com câmera (num desktop com webcam, capture não abre "câmera", cai no seletor comum).
const CAN_TAKE_PHOTO = CAMERA_SUPPORTED && TOUCH_CAPABLE
// O scanner ao vivo é nossa própria UI de câmera (não depende de capture) — funciona em qualquer
// dispositivo com câmera, com ou sem touch (ex.: notebook com webcam).
const CAN_SCAN_BARCODE = CAMERA_SUPPORTED

const CONFIDENCE_META = {
  [CONFIDENCE.ALTA]: { label: 'Alta confiança', icon: CheckCircle2, className: 'nfe-badge-alta' },
  [CONFIDENCE.CONFERIR]: { label: 'Conferir', icon: AlertTriangle, className: 'nfe-badge-conferir' },
  [CONFIDENCE.BAIXA]: { label: 'Baixa confiança', icon: AlertTriangle, className: 'nfe-badge-baixa' },
  [CONFIDENCE.NAO_ENCONTRADO]: { label: 'Não encontrado', icon: HelpCircle, className: 'nfe-badge-vazio' },
}

function ConfidenceBadge({ confidence }) {
  const meta = CONFIDENCE_META[confidence] || CONFIDENCE_META[CONFIDENCE.NAO_ENCONTRADO]
  const Icon = meta.icon
  return (
    <span className={`nfe-badge ${meta.className}`}>
      <Icon size={11} strokeWidth={2.4} /> {meta.label}
    </span>
  )
}

const RECEIPT_FIELD_DEFS = [
  { key: 'numeroNf', label: 'Número da NF' },
  { key: 'serieNf', label: 'Série' },
  { key: 'cnpjFornecedor', label: 'CNPJ do fornecedor' },
  { key: 'fornecedor', label: 'Fornecedor' },
  { key: 'pedido', label: 'Pedido de compra' },
  { key: 'dataRecebimento', label: 'Data de recebimento', type: 'date' },
]

const REFERENCE_FIELD_DEFS = [
  { key: 'chaveAcesso', label: 'Chave de acesso (44 dígitos)' },
  { key: 'ufEmitente', label: 'UF emitente' },
  { key: 'anoMesEmissao', label: 'Ano/mês de emissão' },
  { key: 'dataEmissao', label: 'Data de emissão' },
  { key: 'valorTotal', label: 'Valor total' },
]

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

function FieldRow({ def, meta, value, onChange, corrected }) {
  return (
    <div className="field" key={def.key}>
      <label>
        {def.label}
        <ConfidenceBadge confidence={meta.confidence} />
      </label>
      <input type={def.type || 'text'} value={value ?? ''} onChange={(event) => onChange(def.key, event.target.value)} />
      {corrected ? (
        <span className="nfe-corrected"><PencilLine size={11} /> Corrigido manualmente</span>
      ) : meta.origin ? (
        <span className="field-help">Origem: {meta.origin}</span>
      ) : null}
    </div>
  )
}

export default function NfeReaderPage({ pushToast }) {
  const inputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const processingRef = useRef(false)
  const [file, setFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [fieldValues, setFieldValues] = useState({})
  const [confirmed, setConfirmed] = useState(null)
  const [copied, setCopied] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)

  const metaByKey = useMemo(() => {
    if (!analysis) return {}
    return { ...analysis.fields, ...analysis.referenciaNfe }
  }, [analysis])

  const resetAll = () => {
    setFile(null)
    setAnalysis(null)
    setFieldValues({})
    setConfirmed(null)
    setErrorMessage('')
    if (inputRef.current) inputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  const onSelectFile = (event) => {
    const selected = event.target.files?.[0] || null
    setFile(selected)
    setAnalysis(null)
    setFieldValues({})
    setConfirmed(null)
    setErrorMessage('')
  }

  /** Aplica um resultado de análise (vindo de arquivo ou da chave lida pelo scanner) ao estado da tela. */
  const applyAnalysisResult = (result) => {
    setAnalysis(result)
    const initialValues = {}
    Object.entries({ ...result.fields, ...result.referenciaNfe }).forEach(([key, meta]) => {
      initialValues[key] = meta.value
    })
    setFieldValues(initialValues)
    pushToast?.(
      result.chaveValida ? 'Chave de acesso localizada' : 'Análise concluída',
      result.chaveValida
        ? `Dígito verificador conferido, via ${result.origensChave.join(' e ')}.`
        : 'Não foi possível localizar uma chave válida. Revise e preencha manualmente.',
    )
  }

  const runAnalysis = async () => {
    if (!file) return
    if (processingRef.current) {
      console.log('[NFe] Análise já em andamento — clique ignorado.')
      return
    }
    processingRef.current = true
    setAnalyzing(true)
    setErrorMessage('')
    try {
      const result = await analyzeNfeFile(file)
      applyAnalysisResult(result)
    } catch (error) {
      setErrorMessage(error?.message || 'Não foi possível analisar o arquivo selecionado.')
    } finally {
      processingRef.current = false
      setAnalyzing(false)
    }
  }

  /** Chave já validada pelo scanner ao vivo (NfeLiveScanner) — mesmo formato de resultado, sem arquivo envolvido. */
  const handleScannedKey = (chave) => {
    setFile(null)
    setErrorMessage('')
    const result = analyzeNfeKey(chave)
    applyAnalysisResult(result)
  }

  const setFieldValue = (key, value) => setFieldValues((current) => ({ ...current, [key]: value }))

  const isCorrected = (key) => Boolean(metaByKey[key]) && fieldValues[key] !== metaByKey[key].value

  const handleConfirm = () => {
    const value = (key) => fieldValues[key] ?? ''
    const resultado = {
      numeroNf: value('numeroNf'),
      serieNf: value('serieNf'),
      cnpjFornecedor: value('cnpjFornecedor'),
      fornecedor: value('fornecedor'),
      pedido: value('pedido'),
      dataRecebimento: value('dataRecebimento'),
      referenciaNfe: {
        chaveAcesso: value('chaveAcesso'),
        ufEmitente: value('ufEmitente'),
        anoMesEmissao: value('anoMesEmissao'),
        dataEmissao: value('dataEmissao'),
        valorTotal: value('valorTotal'),
      },
    }
    const cnpjDigits = onlyDigits(resultado.cnpjFornecedor)
    if (cnpjDigits.length === 14 && resultado.fornecedor.trim()) {
      saveSupplier(cnpjDigits, resultado.fornecedor.trim())
    }
    setConfirmed(resultado)
    setCopied(false)
    pushToast?.('Dados confirmados', 'Copie o JSON abaixo para usar na próxima etapa.')
  }

  const handleCopy = async () => {
    const text = JSON.stringify(confirmed, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      pushToast?.('Não foi possível copiar', 'Selecione o texto abaixo e copie manualmente.', 'error')
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-copy">
          <h1>Leitura automática de NF-e <span className="beta-tag">Beta</span></h1>
          <p>
            Extrai dados da Nota Fiscal por texto do PDF e código de barras, sem OCR. Não altera o fluxo de
            "Novo recebimento" e não grava nada automaticamente.
          </p>
        </div>
      </header>

      <div className="info-strip">
        <ShieldCheck size={15} />
        <span>
          Módulo isolado e opcional — quem quiser continuar cadastrando manualmente não é afetado. A extração roda
          inteiramente no navegador; quando o código de barras não puder ser lido (comum em digitalizações de baixa
          qualidade), os campos ficam disponíveis para preenchimento manual.
        </span>
      </div>

      <section className="panel">
        <header className="panel-header">
          <div>
            <h2>1. Selecionar arquivo</h2>
            <p>PDF do DANFE, foto da Nota Fiscal ou leitura do código de barras pela câmera</p>
          </div>
        </header>
        <div className="detail-section-body">
          <div className="nfe-source-actions">
            <label className="upload-zone">
              <Upload size={19} />
              <strong>Selecionar arquivo</strong>
              <span>PDF ou imagem, até 10 MB</span>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={onSelectFile}
              />
            </label>

            {/* capture="environment" é apenas uma preferência: se o navegador não suportar, o usuário ainda
                escolhe uma imagem normalmente. Existência do botão é decidida por capacidade (ver CAN_TAKE_PHOTO
                no topo do arquivo), não pela largura da tela. */}
            {CAN_TAKE_PHOTO ? (
              <label className="nfe-source-action">
                <Camera size={16} />
                <span>Tirar foto</span>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onSelectFile}
                />
              </label>
            ) : null}

            {CAN_SCAN_BARCODE ? (
              <button className="nfe-source-action" type="button" onClick={() => setScannerOpen(true)}>
                <ScanBarcode size={16} />
                <span>Escanear código de barras</span>
              </button>
            ) : null}
          </div>

          {file ? (
            <div className="file-list">
              <div className="file-row">
                <span className="file-row-icon">
                  {file.type.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />}
                </span>
                <div><strong>{file.name}</strong><span>{formatFileSize(file.size)}</span></div>
                <button className="icon-button" type="button" onClick={resetAll} aria-label="Remover arquivo">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : null}

          <div className="nfe-actions">
            <button className="btn btn-primary" type="button" disabled={!file || analyzing} onClick={runAnalysis}>
              {analyzing ? <RefreshCw className="spin" size={16} /> : <ScanBarcode size={16} />}
              {analyzing ? 'Analisando…' : 'Analisar nota'}
            </button>
            {analysis ? (
              <button className="btn btn-secondary" type="button" onClick={resetAll}>
                Analisar outro arquivo
              </button>
            ) : null}
          </div>

          {errorMessage ? (
            <div className="info-strip warning"><AlertTriangle size={15} /><span>{errorMessage}</span></div>
          ) : null}
        </div>
      </section>

      {analysis ? (
        <>
          <section className="panel">
            <header className="panel-header">
              <div>
                <h2>2. Revisão</h2>
                <p>
                  {analysis.chaveValida
                    ? `Chave de acesso validada (dígito verificador conferido), via ${analysis.origensChave.join(' e ')}${analysis.fontesCruzadas ? ' — as duas fontes concordam' : ''}.`
                    : 'Nenhuma chave de acesso válida foi localizada. Preencha os campos manualmente.'}
                </p>
              </div>
            </header>
            <div className="detail-section-body">
              {analysis.warnings.length ? (
                <div className="nfe-warning-list">
                  {analysis.warnings.map((warning) => (
                    <div className="info-strip warning" key={warning}><AlertTriangle size={14} /><span>{warning}</span></div>
                  ))}
                </div>
              ) : null}

              <h3 className="nfe-section-title">Dados do recebimento</h3>
              <div className="form-grid">
                {RECEIPT_FIELD_DEFS.map((def) => (
                  <FieldRow
                    key={def.key}
                    def={def}
                    meta={analysis.fields[def.key]}
                    value={fieldValues[def.key]}
                    onChange={setFieldValue}
                    corrected={isCorrected(def.key)}
                  />
                ))}
              </div>

              <h3 className="nfe-section-title">Referência da NF-e (candidatos a novos campos)</h3>
              <div className="form-grid">
                {REFERENCE_FIELD_DEFS.map((def) => (
                  <FieldRow
                    key={def.key}
                    def={def}
                    meta={analysis.referenciaNfe[def.key]}
                    value={fieldValues[def.key]}
                    onChange={setFieldValue}
                    corrected={isCorrected(def.key)}
                  />
                ))}
              </div>

              <div className="info-strip">
                <ShieldCheck size={15} />
                <span>
                  Estes campos de referência ainda não existem no modelo de recebimento do backend — são apenas
                  candidatos, exibidos separadamente no JSON final (<code>referenciaNfe</code>).
                </span>
              </div>
            </div>
          </section>

          <section className="panel">
            <header className="panel-header">
              <div>
                <h2>3. Confirmar e exportar</h2>
                <p>Nada é salvo automaticamente em nenhum recebimento.</p>
              </div>
            </header>
            <div className="detail-section-body">
              <div className="nfe-actions">
                <button className="btn btn-primary" type="button" onClick={handleConfirm}>
                  <CheckCircle2 size={16} /> Confirmar dados
                </button>
              </div>

              {confirmed ? (
                <div className="nfe-json-block">
                  <div className="nfe-json-toolbar">
                    <span>JSON resultante</span>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={handleCopy}>
                      <Copy size={13} /> {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                  <pre className="nfe-json-pre">{JSON.stringify(confirmed, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      <NfeLiveScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onKeyFound={handleScannedKey} />
    </div>
  )
}
