# Leitura automática de NF-e (beta) — documentação técnica

Módulo isolado que extrai dados de uma Nota Fiscal eletrônica (chave de acesso,
número, série, CNPJ do emitente, fornecedor) a partir de um PDF (DANFE) ou foto,
inteiramente no navegador — sem OCR de terceiros pago, sem backend, sem serviço
externo. Vive todo em `src/features/nfeReader/` e não altera o fluxo existente
de `Novo recebimento`.

Este documento descreve **como o pipeline funciona por dentro**: a ordem das
etapas, por que cada uma existe, os arquivos envolvidos e as decisões técnicas
não óbvias. Para o resumo de produto e o passo a passo de teste manual, veja a
seção ["Leitura automática de NF-e (beta)"](../../../README.md#leitura-automática-de-nf-e-beta--módulo-experimental)
no README raiz.

## Visão geral do pipeline

```
                         ┌─────────────────────┐
                         │  Arquivo selecionado │
                         │   (PDF ou foto)       │
                         └──────────┬───────────┘
                                    │
                         PDF?  ┌────┴────┐  não
                         sim   │         │
                    ┌──────────┘         └──────────┐
                    ▼                                ▼
         extractPdfText()                  (pula direto para
         (pdfjs-dist, até 3 págs.)          a etapa de imagem)
                    │
                    ▼
      findValidNfeKeys(texto)  ──── achou? ──► usa a chave.
      (regex + dígito verificador)            PARA aqui — não renderiza
                    │ não achou                página, não aciona
                    ▼                          ZXing/OCR.
      renderPdfFirstPageToCanvas()
      (ou loadImageFileToCanvas() p/ foto)
                    │
                    ▼
      readCode128FromCanvas(canvas)   ──── achou? ──► usa a chave.
      (@zxing, 6 recortes × 2 contrastes             PARA aqui — não
       × 4 rotações = até 48 tentativas)              aciona OCR.
                    │ não achou
                    ▼
      findNfeKeysWithOcr(canvas)      ──── achou? ──► usa a chave.
      (tesseract.js, 2 regiões)
                    │ não achou
                    ▼
           "Nenhuma chave válida encontrada"
           (não trava — usuário preenche manual)
```

Princípio central: **cada etapa só roda se a anterior não resolveu**, da mais
barata/confiável para a mais cara. Um PDF digital comum (a maioria dos DANFEs
gerados por sistema) resolve na etapa 1 e nunca toca em canvas, ZXing ou
tesseract.js. Isso é implementado em
[`extractor.js`](extractor.js), que orquestra tudo e é a porta de entrada única
do módulo: `analyzeNfeFile(file)`.

## Arquivos e responsabilidades

| Arquivo | Responsabilidade |
|---|---|
| [`extractor.js`](extractor.js) | Orquestra o pipeline de arquivo (a tabela acima): decide qual fonte "ganha", delega a montagem do resultado a `analysisBuilder.js`. Reexporta `CONFIDENCE`/`analyzeNfeKey` — continua sendo o único ponto que a UI importa. |
| [`analysisBuilder.js`](analysisBuilder.js) | Monta `fields`/`referenciaNfe`/`chaveInterpretada` a partir de uma chave já resolvida — usado tanto por `analyzeNfeFile` (arquivo) quanto por `analyzeNfeKey` (scanner ao vivo). Sem dependência de Canvas/`?url` — testável em Node puro, igual a `chaveNFe.js`. |
| [`chaveNFe.js`](chaveNFe.js) | Matemática pura da chave de acesso: validação (dígito verificador módulo 11), interpretação dos campos (UF/ano-mês/CNPJ/série/número), busca de chaves válidas dentro de um texto livre. Sem dependência de DOM — testável em Node puro. |
| [`pdfExtractor.js`](pdfExtractor.js) | Tudo que usa `pdfjs-dist`: abrir o PDF, extrair texto selecionável, renderizar a 1ª página em alta resolução para um canvas. |
| [`barcodeReader.js`](barcodeReader.js) | Leitura de código de barras CODE_128 estático (arquivo/foto), em estágios — nativo, imagem inteira, recortes, margem artificial, deskew (ver [Etapa 2](#etapa-2--código-de-barras-code_128-barcodereaderjs)). Exporta `buildCode128Hints()`, reaproveitado também pelo scanner ao vivo. |
| [`liveScanner.js`](liveScanner.js) | Leitura contínua de CODE_128 pela câmera — `BarcodeDetector` nativo quando suportado, `@zxing/browser` como universal (nunca os dois ao mesmo tempo). Mesmos hints de `barcodeReader.js`, mesma validação de `chaveNFe.js`. Também expõe `captureCurrentFrame()` (para "Capturar e analisar"). |
| [`nativeBarcodeDetector.js`](nativeBarcodeDetector.js) | Wrapper fino sobre a API nativa `BarcodeDetector` do navegador — feature detection (`isNativeCode128Supported`) e decodificação (`detectCode128Native`), usados tanto pelo pipeline estático quanto pelo ao vivo. |
| [`decodeDiagnostics.js`](decodeDiagnostics.js) | Vocabulário e contador de diagnóstico (não_encontrado/tamanho_inválido/dv_inválido/válido) compartilhado por `barcodeReader.js` e `liveScanner.js` — de onde vêm as mensagens de erro mais específicas e o painel de debug em dev. Puro, sem DOM — testável em Node. |
| [`ocrReader.js`](ocrReader.js) | Fallback de OCR via `tesseract.js`, restrito a dígitos, usado só quando código de barras falha. Só se aplica ao pipeline de arquivo/foto/captura — o scanner ao vivo contínuo não usa OCR frame a frame (ver [Entradas em celular/tablet](#entradas-em-celulartablet-foto-e-scanner-ao-vivo)). |
| [`canvasUtils.js`](canvasUtils.js) | Primitivas de canvas DOM compartilhadas por `barcodeReader.js` e `ocrReader.js`: clonar, recortar, rotacionar, ampliar, binarizar (threshold), adicionar margem branca artificial (`padCanvasWithWhite`). |
| [`textHeuristics.js`](textHeuristics.js) | Regex fracas sobre o texto do PDF para campos que a chave não cobre (data de emissão, valor total, pedido de compra) — sempre confiança "conferir" ou "baixa". |
| [`supplierCatalog.js`](supplierCatalog.js) | Catálogo local `CNPJ → nome do fornecedor` em `localStorage` (único uso de `localStorage` no app; alimentado a cada nota confirmada manualmente). |
| [`NfeReaderPage.jsx`](NfeReaderPage.jsx) | Tela: upload/foto/scanner, botão "Analisar nota", revisão com selos de confiança, edição manual, "Confirmar dados" → JSON copiável. |
| [`NfeLiveScanner.jsx`](NfeLiveScanner.jsx) | Overlay em tela cheia do scanner ao vivo: preview da câmera, guia de posicionamento (com margem lateral para a quiet zone), dicas por tempo, "Capturar e analisar", lanterna/troca de câmera quando suportadas, painel de diagnóstico só em dev, estados de permissão negada/sem câmera. |
| [`chaveNFe.test.mjs`](chaveNFe.test.mjs) | Testes de `node:test` para a matemática da chave (sem navegador). |
| [`analysisBuilder.test.mjs`](analysisBuilder.test.mjs) | Testes de `node:test` para a montagem do resultado a partir de uma chave (`analyzeNfeKey`/`buildAnalysisFromKey`), incluindo o caso do scanner (sem texto de PDF). |
| [`decodeDiagnostics.test.mjs`](decodeDiagnostics.test.mjs) | Testes de `node:test` para a classificação de desfecho de decodificação e o contador de diagnóstico. |
| [`testFixtures/`](testFixtures/) | Imagens de um CODE_128 sintético válido (não dado fiscal real) + script Playwright para validar `readCode128FromCanvas` contra pixels reais de forma repetível — ver [testFixtures/README.md](testFixtures/README.md). `validate-decoder-benchmark.mjs` roda a mesma bateria de fixtures nos três decoders (Nível A). |
| [`decoders/decoderTypes.js`](decoders/decoderTypes.js) | Formato de resultado padronizado (`buildDecodeResult`) e validação de chave ÚNICA compartilhada pelos três adapters do benchmark — nenhum engine implementa validação própria. Puro — testável em Node. |
| [`decoders/nativeDecoder.js`](decoders/nativeDecoder.js) | Adapter do benchmark para o `BarcodeDetector` nativo — cronometra e encaminha para `nativeBarcodeDetector.js`, sem duplicar nada. |
| [`decoders/zxingDecoder.js`](decoders/zxingDecoder.js) | Adapter do benchmark para o ZXing — `decodeWithZxing` (decoder cru, uma tentativa, via nova `decodeCode128RawZxing` em `barcodeReader.js`) e `decodeWithProductionPipeline` (roda `readCode128FromCanvas` completo, o pipeline de produção como um todo). |
| [`decoders/zbarDecoder.js`](decoders/zbarDecoder.js) | Adapter do benchmark para o ZBar (`@undecaf/zbar-wasm`) — `import()` dinâmico, nunca importado estaticamente; carrega o `.wasm` só quando chamado de verdade. |
| [`NfeScannerBenchmark.jsx`](NfeScannerBenchmark.jsx) | Painel de diagnóstico/benchmark dos três decoders — só existe com `?nfeScannerDebug=1` na URL, carregado via `React.lazy`. Ver [Benchmark de decoders](#benchmark-de-decoders-diagnóstico) abaixo. |
| [`benchmarkLiveRunner.js`](benchmarkLiveRunner.js) | Motor do teste ao vivo por engine (Modo B do benchmark) — laço único e compartilhado pelos três engines, nunca dois rodando ao mesmo tempo. |
| [`imageStats.js`](imageStats.js) | Luminosidade média/contraste aproximado de um frame, para o painel de diagnóstico — nunca um "score de qualidade" inventado. `computeLuminanceStats` é pura — testável em Node. |
| [`cameraCapabilities.js`](cameraCapabilities.js) | Formata `getSettings()`/`getCapabilities()` da câmera para exibição, separando suporte de estado ativo. Puro — testável em Node. |
| [`benchmarkReport.js`](benchmarkReport.js) | Monta o texto de "Copiar diagnóstico" — puro, nunca inclui chave completa/CNPJ/pedido/valor/fornecedor. Testável em Node. |
| [`scannerDebug.js`](scannerDebug.js) | `isScannerDebugEnabled()` — ativa o benchmark por `?nfeScannerDebug=1` na URL (não por `import.meta.env.DEV`, porque o teste decisivo acontece no deploy HTTPS). |

## A chave de acesso e o dígito verificador

A chave de acesso da NF-e é uma sequência de 44 dígitos com esta estrutura
(implementada em `interpretarChave`, `chaveNFe.js:45`):

| Posição | Campo | Tamanho |
|---|---|---|
| 0–1 | Código da UF | 2 |
| 2–5 | Ano/mês de emissão (AAMM) | 4 |
| 6–19 | CNPJ do emitente | 14 |
| 20–21 | Modelo do documento | 2 |
| 22–24 | Série | 3 |
| 25–33 | Número da NF | 9 |
| 34 | Tipo de emissão | 1 |
| 35–42 | Código numérico | 8 |
| 43 | Dígito verificador (DV) | 1 |

O DV é calculado em `validarChaveNFe` (`chaveNFe.js:13`) pelo algoritmo módulo
11 padrão da NF-e: peso 2→9 da direita para a esquerda sobre os 43 primeiros
dígitos, soma ponderada, resto da divisão por 11, `dv = 11 - resto` (0 se der
≥10). **Nenhuma sequência de 44 dígitos é aceita só pelo tamanho** — em
qualquer uma das três fontes (texto, barcode, OCR), o resultado só vira "chave
válida" se o DV bater.

Exemplo verificado (usado no teste automatizado):

```
42260748909580000160550010000082801675042868
→ UF 42 (SC) · AAMM 2607 (2026/07) · CNPJ 48.909.580/0001-60 ·
  modelo 55 · série 1 · NF 8280 · DV confere
```

### `findValidNfeKeys(texto)` — busca tolerante a formatação

A chave nem sempre aparece "corrida" no texto (ex.: PDFs a formatam em blocos
de 4 dígitos separados por espaço). A regex em `chaveNFe.js:80`,
`/(?:\d[\s.-]?){44,88}/g`, captura corridas de dígitos com até um separador
(espaço, tab, quebra de linha, ponto ou hífen) entre cada um — folga
suficiente para blocos formatados, mas restrita o bastante para não confundir
com texto solto cheio de números. Cada candidata é normalizada (dígitos puros,
via `normalizarChave`) e toda janela de 44 dígitos dentro dela é validada pelo
DV; resultados únicos são retornados na ordem em que aparecem. Isso é
reutilizado **sem mudanças** pelas três fontes (texto do PDF, saída do
código de barras, saída do OCR) — a mesma função decide o que é uma chave
válida em qualquer lugar do pipeline.

## Etapa 1 — texto do PDF (`pdfExtractor.js`, `extractPdfText`)

Usa `pdfjs-dist` para abrir o PDF e chamar `getTextContent()` nas até 3
primeiras páginas, concatenando o texto selecionável. Só se aplica a PDFs — uma
foto (JPG/PNG) pula direto para a etapa de imagem.

Se o texto contiver uma chave válida (`findValidNfeKeys`), o pipeline **para
aqui**: não renderiza a página, não instancia o ZXing, não carrega o
tesseract.js. Isso é o caso comum — a maioria dos DANFEs gerados por sistema
tem a chave como texto selecionável — e evita todo o custo (CPU, memória,
possível download do pacote de idioma do OCR) das etapas seguintes sem
necessidade.

### Assets do pdf.js self-hosted

A partir da v5/v6, o pdf.js monta em tempo de execução os nomes de arquivo de
wasm/cmaps/fontes/perfis ICC (ex. `` `${wasmUrl}jbig2.wasm` ``) em vez de
importá-los estaticamente — o bundler não consegue enxergar essa dependência
para empacotá-la. Sem servir esses diretórios, imagens JBIG2/JPX (comuns em
NF digitalizada) falham ao decodificar com
`"Ensure that the wasmUrl API parameter is provided."`. Por isso
`loadPdf()` (`pdfExtractor.js:19`) passa `cMapUrl`, `standardFontDataUrl`,
`iccUrl` e `wasmUrl` apontando para `public/pdfjs/{cmaps,standard_fonts,iccs,wasm}/`,
copiados de `node_modules/pdfjs-dist` pelo script de `postinstall` (ver
[Assets self-hosted](#assets-self-hosted-pdfjs-e-tesseractjs) abaixo).

## Etapa 2 — código de barras CODE_128 (`barcodeReader.js`)

Só roda se a etapa 1 não achou nada. Primeiro obtém um canvas:

- PDF → `renderPdfFirstPageToCanvas()` renderiza a 1ª página a
  `scale = 300/72` (≈300 DPI; 1 ponto PDF = 1/72"), com teto de
  `MAX_RENDER_DIMENSION = 4200` px no maior lado (memória de canvas cresce
  quadraticamente — o teto evita explodir em páginas fora do padrão A4/Carta).
  Digitalizações de baixa resolução (o motivo original de subir a escala de 3
  para 300/72) agora chegam nítidas o bastante para o CODE_128 e para o OCR.
- Foto → `loadImageFileToCanvas()` carrega o arquivo direto num `<canvas>` via
  `Image` + `URL.createObjectURL`.

Depois, `readCode128FromCanvas(canvas, { onAttempt })` tenta decodificar em
**estágios** — cada um só roda se o anterior não achou nada, e uma foto bem
enquadrada resolve no Estágio 1 sem nunca chegar perto dos mais caros. Essa
reorganização (setembro/2026) veio de um bug real: uma foto tirada só da
região do código de barras (sem o resto da página) não decodificava — ver
["Investigando a robustez do scanner"](#investigando-a-robustez-do-scanner-e-de-onde-vieram-os-estágios)
logo abaixo para o raciocínio e as evidências.

1. **Fast path**: `BarcodeDetector` nativo (`nativeBarcodeDetector.js`), se o
   navegador suportar `code_128` — sem crops nem rotações manuais, o próprio
   navegador decodifica. Depois, ZXing na **imagem inteira**, original +
   contraste, 4 rotações cardeais (0°/90°/180°/270°).
2. **Recortes de página inteira** (`CROP_VARIANTS`, `barcodeReader.js`): topo
   25%, topo 35%, topo direito, topo esquerdo, metade superior — para fotos da
   NF inteira, onde o código de barras é só uma faixa pequena da imagem
   ("página inteira" já foi coberta no Estágio 1, não se repete aqui). Cada
   recorte, original + contraste, 4 rotações.
2b. **Margem artificial** (`padCanvasWithWhite`, `canvasUtils.js`): a imagem
   inteira com uma borda branca acrescentada (8% de cada lado) — recupera
   fotos em que o código foi enquadrado rente demais, sem quiet zone real
   (ver [seção de quiet zone](#margem-clara-quiet-zone) abaixo). Mesmas 4
   rotações, original + contraste.
3. **Deskew** (pequenas inclinações de correção), só se nada acima resolveu:
   a mesma imagem com margem, nos ângulos `DESKEW_ANGLES = [-11, -8, -5, -3,
   3, 5, 8, 11]` — ver evidência de por que esse estágio existe e o que ele
   recupera (e o que não recupera) na próxima seção.

Um recorte/imagem com menos de `MIN_DECODE_WIDTH = 1200` px de largura é
ampliado 2× (`upscaleCanvas`, com `imageSmoothingEnabled = false` para não
borrar as barras finas) antes de qualquer tentativa. Cada tentativa
individual é logada em `console.debug` e classificada via
`onAttempt(outcome)` (`decodeDiagnostics.js`) — usado para instrumentação
(nunca visível ao usuário; ver [Log de diagnóstico](#log-de-diagnóstico)).

### Investigando a robustez do scanner (e de onde vieram os estágios)

Reproduzido com fixtures sintéticas reais (não suposição — ver
[`testFixtures/`](testFixtures/README.md)), o pipeline **antes** desta
rodada decodificava de forma confiável até ~2° de inclinação da câmera e
**nunca** decodificava a partir de 3°, em qualquer combinação testada entre
3° e 10°. Isso é uma diferença enorme na prática: uma foto de celular
"a mão livre" perfeitamente alinhada em menos de 3° não é realista — é
provavelmente a causa mais comum de "código de barras não localizado" numa
foto que, a olho nu, parece perfeitamente legível.

Zero quiet zone (barras tocando a borda da imagem, testado com
`zero-margin.png`) já decodificava **antes** desta rodada, em condições
sintéticas limpas — o problema real provavelmente é mais sutil que só
margem: uma foto de celular real tem compressão JPEG, leve desfoque, luz
desigual, e possivelmente ruído bem na borda do enquadramento (dedo, sombra,
borda do papel) que uma imagem sintética perfeita não reproduz. Por isso a
margem artificial (Estágio 2b) e a orientação de UI para deixar espaço nas
laterais continuam valendo — são baratas e não têm contraindicação — mas a
**inclinação** foi o fator com evidência mais forte e reproduzível.

Com o estágio de deskew, o mesmo conjunto de fixtures passa a recuperar a
maioria dos casos entre 3° e 10° (não 100% — o efeito de reamostragem do
canvas em cada ângulo específico não é perfeitamente previsível; ver
`testFixtures/README.md` para os números exatos, incluindo o caso que
continua falhando).

### Por que o ZXing roda sem `TRY_HARDER`

O bug original em produção era `"Could not create a Canvas element."`
disparado de dentro do ZXing. A causa raiz foi encontrada lendo o próprio
código-fonte da lib
(`node_modules/@zxing/library/esm/core/oned/OneDReader.js`): quando o hint
`DecodeHintType.TRY_HARDER` está ativo, o `OneDReader.decode` — ao falhar na
primeira tentativa — chama sozinho `image.rotateCounterClockwise()`
internamente, que tenta criar seu próprio canvas temporário
(`getTempCanvasElement()`) e é exatamente esse caminho que lançava o erro.

A correção foi **remover `TRY_HARDER` dos hints** (`buildHints()`,
`barcodeReader.js:65` — só mantém `POSSIBLE_FORMATS: [BarcodeFormat.CODE_128]`)
e reimplementar a cobertura de rotação manualmente, fora do ZXing, com
canvases DOM criados por nós (`rotateCanvas`). Isso dá controle total sobre o
processo e elimina de vez essa classe de erro, sem perder a capacidade de ler
um código de barras rotacionado.

## Etapa 3 — OCR de último recurso (`ocrReader.js`)

Só roda se **nem texto nem código de barras** acharam uma chave válida — o
caso de digitalizações realmente ruins, onde até uma lib profissional de
leitura de código de barras falha. Usa `tesseract.js` (`createWorker`) sobre o
mesmo canvas já obtido na etapa 2, sem renderizar nada de novo.

- **Restrito a dígitos**: `tessedit_char_whitelist: '0123456789 .-'` e
  `tessedit_pageseg_mode: PSM.SINGLE_BLOCK` — o OCR nem tenta reconhecer o
  resto do texto da nota, só o que poderia ser a chave. Isso acelera bastante
  o reconhecimento comparado a OCR de página inteira.
- **2 regiões tentadas**, na ordem (`CROP_VARIANTS`, `ocrReader.js:38`): "topo
  35%" primeiro (a chave costuma estar perto do código de barras, no topo),
  depois "página inteira" como último recurso. Um recorte menor que
  `MIN_OCR_WIDTH = 1400` px é ampliado 2×.
- O texto reconhecido em cada tentativa passa pela **mesma**
  `findValidNfeKeys` usada para o texto do PDF — nenhuma chave é aceita só por
  ter "parecido" com 44 dígitos; o DV é sempre conferido.
- O worker do tesseract.js é criado uma vez (`getWorker()`, memoizado em
  `workerPromise`) e reaproveitado entre análises na mesma sessão da página;
  `terminateOcrWorker()` existe para liberar recursos se a tela for
  desmontada.

Filosofia explícita do design (não é um detalhe incidental): o pipeline
**não tenta "vencer" uma digitalização ruim insistindo infinitamente no
ZXing** — depois de um conjunto razoável de recortes/rotações/contraste, ele
degrada para OCR, que é a ferramenta certa para esse caso (consegue ler
dígitos impressos mesmo quando as barras do código de barras estão
fisicamente ilegíveis pelo scanner). E se nem o OCR achar nada, o sistema
aceita isso e devolve "não encontrado" — a tela sempre permite preencher
manualmente; nada trava.

## Escolha final da chave e cruzamento de fontes (`extractor.js`)

Depois das três etapas, `extractor.js` decide qual chave usar, nesta
prioridade: texto do PDF → código de barras → OCR. Como cada etapa só roda se
a anterior falhou, normalmente só uma fonte tem resultado — mas o código
também cobre o caso raro de o texto **e** o código de barras terem sido
tentados e baterem na mesma chave (`fontesCruzadas`), registrando as duas
origens (`origensChave`) e logando a confirmação cruzada.

A chave escolhida é interpretada (`interpretarChave`) e vira a base de
confiança "alta" para os campos que dependem dela (`numeroNf`, `serieNf`,
`cnpjFornecedor`, e os campos de `referenciaNfe`). O CNPJ interpretado é
cruzado com o catálogo local de fornecedores (`supplierCatalog.js`). Os
campos que a chave não cobre (data de emissão, valor total, pedido de compra)
vêm de regex fracas sobre o texto do PDF (`textHeuristics.js`), sempre com
confiança "conferir" ou "baixa" — nunca "alta", porque não há verificação
matemática por trás delas.

**Código de barras → OCR é uma função só, reaproveitada.** `runBarcodeThenOcr(canvas, warnings)`
tenta o código de barras e, se não resolver, o OCR — usada tanto por
`analyzeNfeFile` (arquivo/foto) quanto por `analyzeNfeCanvas` (captura
manual do scanner ao vivo, ver
[Capturar e analisar](#capturar-e-analisar--saída-de-emergência)), para não
duplicar essa lógica em dois lugares.

**Mensagens de aviso informadas pelo diagnóstico, não genéricas.** Em vez de
sempre "código de barras não localizado ou ilegível", `buildBarcodeWarning`
usa os contadores de `decodeDiagnostics.js` para diferenciar "nenhum código
foi detectado" de "o código foi detectado, mas não é uma chave de NF-e
válida" — só diz o que os contadores realmente confirmam, nunca inventa
diagnóstico. E como o OCR lê os **dígitos impressos**, não as barras,
`buildOcrWarning` deixa isso explícito: se a imagem tiver só o código de
barras (sem os 44 números escritos abaixo), é esperado que o OCR também não
encontre nada — a mensagem orienta a incluir os números na próxima foto, em
vez de deixar o usuário achando que a imagem estava ruim.

### Formato do resultado (`analyzeNfeFile`)

```ts
{
  chaveValida: boolean,
  chaveInterpretada: { uf, ufSigla, anoMes, anoMesLabel, cnpj, cnpjFormatado,
                        modelo, serie, numeroNf, tipoEmissao, codigoNumerico, dv } | null,
  fontesCruzadas: boolean,       // texto e barcode acharam a mesma chave
  origensChave: string[],        // ex.: ['texto do PDF'] ou ['código de barras']
  fields: {                      // campos do modelo de recebimento
    numeroNf, serieNf, cnpjFornecedor, fornecedor, pedido, dataRecebimento
  },                             // cada um: { value, confidence, origin }
  referenciaNfe: {                // candidatos a novos campos (não gravados no backend)
    chaveAcesso, ufEmitente, anoMesEmissao, dataEmissao, valorTotal
  },
  warnings: string[],             // uma entrada por falha degradada (nunca lança)
}
```

`confidence` é um dos quatro valores de `CONFIDENCE` (`extractor.js:33`):
`alta` (veio da chave, matematicamente validada, ou do catálogo de
fornecedores), `conferir` (heurística de regex razoavelmente específica),
`baixa` (heurística de regex mais genérica) ou `nao_encontrado`.

## Entradas em celular/tablet: foto e scanner ao vivo

A etapa "1. Selecionar arquivo" ganha duas entradas adicionais, lado a lado
com o upload, quando o **dispositivo** tem a capacidade correspondente —
detectado por feature detection (`navigator.mediaDevices?.getUserMedia`,
`matchMedia('(pointer: coarse)')`/`navigator.maxTouchPoints`), nunca por
largura de tela nem por user-agent (um tablet em landscape continua tendo
câmera e toque; a largura da janela não diz nada sobre isso):

- **Tirar foto** — um segundo `<input type="file" accept="image/*"
  capture="environment">`, oculto, ao lado do input de upload normal
  (`NfeReaderPage.jsx`, `cameraInputRef`). Só aparece com câmera **e** toque
  (`capture="environment"` só faz sentido como "abrir câmera" nessa
  combinação; num desktop com webcam mas sem toque, cai no seletor comum
  mesmo com o atributo). `capture="environment"` é só uma *preferência* para
  o navegador priorizar a câmera traseira — não uma garantia. A foto
  resultante é o mesmo tipo de `File` que o upload comum: cai no mesmíssimo
  `onSelectFile` → `analyzeNfeFile(file)`, sem pipeline paralelo.
- **Escanear código de barras** — abre `NfeLiveScanner.jsx` em tela cheia,
  com a câmera ao vivo (não é um seletor de arquivo). Só exige câmera — não
  toque (um notebook com webcam também recebe essa opção).

No desktop comum (mouse, sem câmera/toque) só "Selecionar arquivo" aparece.
A largura da tela continua controlando só o *layout* (quantas colunas o
grid usa), nunca se a funcionalidade existe.

### Scanner ao vivo (`liveScanner.js` + `NfeLiveScanner.jsx`)

Diferente do upload/foto, o scanner não produz um `File`: ele decodifica o
código de barras diretamente de frames de vídeo, com preferência por câmera
traseira (`facingMode: { ideal: 'environment' }`) e sem solicitar microfone
(nunca `audio: true`).

**Dois decoders possíveis, nunca os dois ao mesmo tempo.**
`startLiveScan` escolhe uma vez por sessão de leitura:

- `BarcodeDetector` nativo do navegador, quando `code_128` está na lista de
  `getSupportedFormats()` (`nativeBarcodeDetector.js`) — mais rápido, mas só
  existe em Chromium/Chrome/Edge/Android Chrome. `liveScanner.js` gerencia
  `getUserMedia`/torch/lifecycle ele mesmo nesse caminho (as mesmas APIs
  padrão de `MediaStreamTrack` que o `@zxing/browser` usa por baixo dos
  panos — não é reinvenção).
- `@zxing/browser` (`BrowserMultiFormatReader.decodeFromConstraints`),
  sempre que o nativo não está disponível — o caminho universal, incluindo
  Safari/iOS, onde `BarcodeDetector` não existe.

Rodar os dois ao mesmo tempo desperdiçaria CPU decodificando o mesmo frame
duas vezes; a escolha é feita uma única vez (`isNativeCode128Supported()`,
memoizado) antes de abrir a câmera, não a cada frame.

**Mesmos hints, mesmo motivo de nunca usar `TRY_HARDER`.** O caminho ZXing
usa `buildCode128Hints()`, exportado de `barcodeReader.js` — a mesma função,
não uma cópia — então o [bug de rotação interna do ZXing](#por-que-o-zxing-roda-sem-try_harder)
não pode ressurgir aqui: `decodeFromConstraints` decodifica cada frame
chamando o mesmo `decodeFromCanvas` de sempre por baixo dos panos. O caminho
nativo não usa ZXing — o navegador decodifica direto.

**Nenhum código de barras é aceito só por ter sido decodificado.** Cada
resultado de frame passa pela mesma `normalizarChave` + `validarChaveNFe` de
`chaveNFe.js` usada em todo o resto do pipeline — um CODE_128 que não seja uma
chave de 44 dígitos com dígito verificador correto (etiqueta, código de
produto, código da transportadora) é ignorado e a leitura continua. Isso evita
falso positivo com outros códigos de barras que a câmera possa enxergar junto
com o da NF-e.

**Parada é imediata e única.** Quando um frame decodifica para uma chave
válida, `liveScanner.js` chama `controls.stop()` (a referência de controle que
o próprio ZXing passa a cada callback, disponível mesmo antes da Promise de
`startLiveScan` resolver) *antes* de notificar quem chamou — nenhum frame
seguinte pode disparar um segundo callback. `NfeLiveScanner.jsx` então libera
todas as tracks do `MediaStream`, mostra "Chave da NF-e localizada" por ~550ms
(com `navigator.vibrate?.(100)` se o dispositivo suportar), fecha a tela e
entrega a chave para `analyzeNfeKey(chave)` — o **mesmo formato de resultado**
de `analyzeNfeFile`, montado por `buildAnalysisFromKey` (`analysisBuilder.js`).

**A câmera nunca fica ligada esquecida.** `NfeLiveScanner.jsx` para o
`MediaStream` (ZXing `controls.stop()`, que também desliga a lanterna se
estiver acesa) em todos estes casos: usuário toca "Cancelar", chave
encontrada, `document.visibilityState` deixa de ser `visible` (aba/app em
segundo plano — retoma sozinho ao voltar a ficar visível, se o scanner ainda
estiver aberto), tecla Escape, ou o componente deixar de estar `open`. Nenhum
frame de vídeo é enviado a lugar nenhum — tudo roda localmente no navegador,
sem gravação, sem backend.

**Lanterna e troca de câmera são opcionais e condicionais.** `startLiveScan`
retorna `switchTorch` só quando o `MediaStreamTrack` realmente expõe suporte a
torch (checado pelo próprio `@zxing/browser` via
`track.getCapabilities()`) — o botão de lanterna só aparece nesse caso.
"Trocar câmera" só aparece quando `listCameras()` (que só devolve `label`s
confiáveis *depois* da primeira permissão concedida — por isso só é chamada
depois do primeiro `startLiveScan` bem-sucedido) encontra mais de uma câmera.

**Erros de câmera viram mensagem, nunca stack trace.** `NotAllowedError` →
"Permissão da câmera negada..."; `NotFoundError` → "Nenhuma câmera
compatível..."; `NotReadableError` → câmera em uso por outro app; fora de
contexto seguro (ver abaixo) → mensagem específica sobre HTTPS. Em qualquer
caso, "Selecionar arquivo" continua disponível como alternativa.

#### Margem clara (quiet zone)

O CODE_128 precisa de uma faixa em branco (quiet zone) antes e depois das
barras para ser decodificado — não é um capricho do ZXing, é do próprio
padrão. A moldura de enquadramento (`.nfe-scanner-frame-box`) é
propositalmente mais estreita que o espaço disponível na tela (não preenche
quase tudo) para reforçar visualmente que o código não deve tocar as bordas.
A dica inicial ("Enquadre o código inteiro e deixe espaço nas laterais.") e a
de 7s+ ("Deixe o código inteiro visível e use a lanterna."/"Aproxime a
câmera com cuidado, sem cortar as laterais.") evitam de propósito qualquer
frase que incentive aproximar demais — "aproxime a câmera" sozinho, sem
qualificação, já foi motivo de bug real (ver
[Investigando a robustez do scanner](#investigando-a-robustez-do-scanner-e-de-onde-vieram-os-estágios)).

#### Dica de orientação (portrait → landscape)

O código de barras do DANFE é longo e horizontal — em celular na vertical
(portrait), ele ocupa uma fatia bem mais estreita do enquadramento do que em
paisagem. Se a leitura não resolveu depois de ~7s **e** o aparelho está em
portrait (`matchMedia('(orientation: portrait)')`, com listener de mudança —
não trava nem força a orientação), a dica de 7s vira "Para facilitar a
leitura, tente girar o celular." em vez da dica de lanterna/aproximação.

#### "Capturar e analisar" — saída de emergência

Se a leitura contínua não resolver em ~6s, um botão "Capturar e analisar"
aparece (não antes — seria o caminho padrão em vez de uma saída de
emergência). Ao tocar: `captureCurrentFrame(videoElement)` (`liveScanner.js`)
desenha o frame atual num canvas novo — **sem** passar por `File`/serializar
para PNG só para ler de volta depois — e `analyzeNfeCanvas(canvas)`
(`extractor.js`) roda o **mesmo** pipeline robusto de código de barras/OCR do
upload/foto sobre esse canvas (todos os estágios da
[Etapa 2](#etapa-2--código-de-barras-code_128-barcodereaderjs), incluindo
margem artificial e deskew — que o scanner ao vivo, por rodar em tempo real
a cada frame, não tenta). Se não encontrar nada, mostra a mensagem
específica (ver [Etapa 2](#etapa-2--código-de-barras-code_128-barcodereaderjs))
por alguns segundos e retoma a leitura contínua sozinho — nunca trava a
tela numa captura sem sucesso.

#### Painel de diagnóstico (só em desenvolvimento)

Com `import.meta.env.DEV` (nunca em build de produção), `NfeLiveScanner.jsx`
mostra uma faixa fixa no rodapé com o que `onDiagnostics`/`onStreamReady`
(`liveScanner.js`) reportam: resolução real negociada com a câmera, tempo até
ficar pronta, número de tentativas e a contagem por desfecho
(`decodeDiagnostics.js`) — nunca a chave em si. `onDiagnostics` é chamado no
máximo a cada 500ms (não a cada tentativa — evitaria dezenas de renders React
por segundo à toa); a animação/UI de "lendo" continua sendo CSS puro,
independente desse throttle.

#### Foco contínuo e diagnóstico de capabilities

Depois que a câmera fica ativa, `liveScanner.js` tenta aplicar
`focusMode: "continuous"` só se `track.getCapabilities()` listar isso — pura
feature detection, igual ao torch; sem suporte (comum em Safari, que
historicamente não expõe `getCapabilities()` em todo aparelho), não faz nada,
nunca gera erro visível nem esconde o scanner. Em `console.debug` (dev),
também registra `focusMode` real, largura/altura das capabilities e se
`focusDistance`/`zoom` estão disponíveis — só como diagnóstico; **zoom não é
alterado automaticamente** (fora de escopo: zoom agressivo pode cortar o
código ou piorar a experiência).

#### HTTPS é obrigatório para a câmera

`getUserMedia` só funciona em contexto seguro. Em produção (Vercel) isso é
automático. Em desenvolvimento, `localhost` funciona normalmente, mas acessar
o Vite dev server por um IP da rede local (`http://192.168.x.x:5173`, o modo
usado por `npm run dev -- --host` para testar em celular físico) **não** é
contexto seguro — o navegador do celular bloqueia a câmera nesse caso. Isso
não é bug do scanner: é o navegador aplicando a mesma regra de sempre para
`getUserMedia`. Para testar a câmera em um celular físico durante o
desenvolvimento, é necessário HTTPS local (túnel tipo `ngrok`/`localtunnel`,
ou certificado local) ou testar direto contra um deploy de preview.

#### O que o scanner preenche — e o que ele não inventa

Igual ao pipeline de arquivo, os campos que vêm matematicamente da chave
(`numeroNf`, `serieNf`, `cnpjFornecedor`, `referenciaNfe.*`) saem com
confiança `alta`; `fornecedor` só é preenchido se o CNPJ já estiver no
catálogo local. Como não há texto de PDF envolvido, `pedido`,
`referenciaNfe.valorTotal` e `referenciaNfe.dataEmissao` — que no pipeline de
arquivo vêm de regex sobre o texto extraído — ficam como "não encontrado": o
scanner não inventa um pedido de compra, valor ou data que ele não leu. O
usuário preenche esses campos manualmente na tela de revisão, exatamente como
já acontecia quando nenhuma heurística encontrava nada no pipeline original.

## Benchmark de decoders (diagnóstico)

Motivação: mesmo depois da investigação de robustez da rodada anterior
(estágios de recorte/margem/deskew — ver
[Investigando a robustez do scanner](#investigando-a-robustez-do-scanner-e-de-onde-vieram-os-estágios)),
uma DANFE real em celular físico continuou sem ser lida depois de vários
segundos. Em vez de continuar "chutando" ajustes (resolução, intervalo,
ângulos), esta ferramenta existe para **medir** qual mecanismo de leitura
funciona melhor com aquela NF específica: `BarcodeDetector` nativo, ZXing ou
ZBar (WebAssembly) — sem trocar o que roda em produção até haver evidência.

### Camada comum (`decoders/`)

Os três engines são acessados por uma interface única — `decodeWith*(source)`
— que devolve sempre o mesmo formato (`buildDecodeResult`,
`decoders/decoderTypes.js`):

```ts
{
  engine: 'native' | 'zxing' | 'zbar',
  available: boolean,       // o engine existe neste navegador?
  detected: boolean,        // achou ALGUM CODE128?
  format: 'CODE_128' | null,
  digitCount: number,
  validNfeKey: boolean,     // passou por normalizarChave + validarChaveNFe
  maskedValue: string | null,  // ex. "4226••••••••••••••••••••••••••••••••1234"
  decodeTimeMs: number | null,
  error: string | null,
}
```

**A validação é uma só**, centralizada em `decoderTypes.js` — nenhum dos três
adapters (`nativeDecoder.js`/`zxingDecoder.js`/`zbarDecoder.js`) implementa
sua própria checagem de "isso é uma chave de NF-e válida". A diferença entre
engines é estritamente decodificação de pixels → texto; o critério de "chave
válida" é idêntico para os três (`normalizarChave` + `validarChaveNFe`,
`chaveNFe.js` — as mesmas funções do resto do módulo).

- **`nativeDecoder.js`** encaminha para `nativeBarcodeDetector.js` (já usado
  em produção) — nenhuma lógica nova de decodificação.
- **`zxingDecoder.js`** tem dois níveis: `decodeWithZxing` chama a nova
  `decodeCode128RawZxing` (`barcodeReader.js`) — uma única tentativa, mesmos
  hints (`buildCode128Hints`, sem `TRY_HARDER`), sem recorte/rotação/deskew —
  e `decodeWithProductionPipeline`, que chama `readCode128FromCanvas` (o
  pipeline de produção completo, que já mistura nativo+ZXing+pré-
  processamento internamente — por isso é reportado como "pipeline atual",
  não como resultado isolado de um engine).
- **`zbarDecoder.js`** usa `@undecaf/zbar-wasm` (ver
  [licença e versão](#zbar-wasm-versão-licença-e-carregamento) abaixo),
  carregado só sob demanda.

### `?nfeScannerDebug=1` — como ativar

`scannerDebug.js` ativa o painel por **query string** (`?nfeScannerDebug=1`),
nunca por `import.meta.env.DEV` — o teste decisivo (NF real, celular físico)
precisa acontecer no deploy HTTPS (Vercel), não só em desenvolvimento local.
Sem a flag, nenhuma UI nova aparece e nenhum código do benchmark é sequer
baixado (`NfeScannerBenchmark.jsx` é `React.lazy` a partir de
`NfeReaderPage.jsx`, gated pela mesma flag) — custo zero para quem não está
testando. Com a flag, um link discreto "Diagnóstico do scanner" aparece no
cabeçalho da tela de Leitura automática.

Exemplo: `https://<seu-deploy>.vercel.app/?nfeScannerDebug=1#/leitura-automatica`

### Modo A — frame capturado

Abre uma única câmera (mesma configuração de produção: 1280×720 ideal,
`facingMode: environment`, sem áudio — `buildConstraints`, exportado de
`liveScanner.js`, reaproveitado sem cópia). "Capturar frame para teste"
congela UM frame e submete a **mesma imagem**, em sequência (nunca em
paralelo), a nativo → ZXing → ZBar, depois ao pipeline de produção completo.
Mostra o frame congelado (para inspecionar foco/blur/inclinação/enquadramento
a olho) com dimensões, luminosidade média e um contraste aproximado
(`imageStats.js` — deliberadamente NÃO um "score de qualidade" inventado, só
dois números simples de comparação).

### Modo B — teste ao vivo (10s por engine)

Três botões, um engine por vez — nunca dois decodificando simultaneamente
(CPU/bateria/temperatura, e comparação injusta). Para no primeiro sucesso ou
em 10s. `benchmarkLiveRunner.js` controla um único laço de captura+decode
reaproveitado pelos três engines (mesma câmera, mesmo intervalo entre
tentativas — 100ms, igual ao `SCAN_DELAY_MS` de produção) — por isso
"tentativas" é uma métrica genuinamente comparável aqui: diferente da API
interna de cada engine (que não expõe esse número de forma equivalente entre
si), é o próprio harness que conta, igualmente, para os três.

### "Copiar diagnóstico"

Monta um texto (`benchmarkReport.js`, puro/testável) com browser, plataforma,
viewport, resolução de câmera, orientação, engine automático atual, e
disponibilidade/detecção/validade/tempo por engine (Modo A e, se já rodado,
Modo B). **Nunca inclui** a chave completa, CNPJ, pedido, valor ou
fornecedor — só métricas técnicas, para poder ser colado e compartilhado sem
expor dado fiscal.

### Confirmado: sem fallback automático entre nativo e ZXing na mesma sessão

Investigado lendo `startLiveScan` (`liveScanner.js`): a escolha de engine
(`isNativeCode128Supported()`) acontece **uma única vez**, antes de abrir a
câmera, e vale para toda a sessão de leitura — se o nativo estiver disponível
mas não conseguir ler a NF em 10s, o ZXing **não** assume no meio da mesma
sessão (só reabrindo o scanner, o que não muda a escolha, já que a
disponibilidade do nativo não muda entre uma abertura e outra). Isto é um
risco real caso o nativo se mostre pior que o ZXing numa NF real — mas esta
tarefa é só de diagnóstico: **nenhuma mudança foi feita no scanner de
produção**. O benchmark (Modo A/B) é exatamente a ferramenta para descobrir
se esse risco se confirma antes de decidir mudar `startLiveScan`.

### `@undecaf/zbar-wasm` — versão, licença e carregamento

- **Versão instalada:** `0.11.0` (a mais recente no momento desta tarefa).
- **Licença declarada pelo pacote:** LGPL-2.1+ (arquivo `LICENSE` do pacote
  publicado no npm; repositório
  [`undecaf/zbar-wasm`](https://github.com/undecaf/zbar-wasm), fork mantido
  de `samsam2310/zbar.wasm`). Isto é só documentação técnica — **não** é uma
  decisão jurídica; qualquer implicação de usar uma dependência LGPL num
  produto deve passar por revisão jurídica própria antes de ir para produção
  de verdade (aqui ela está isolada como ferramenta de diagnóstico, carregada
  como módulo WASM separado via `import()`, nunca linkada estaticamente no
  bundle principal).
- **Carregamento:** `zbarDecoder.js` só importa o pacote dentro de um
  `import()` dinâmico, memoizado (`loadZbar()`) — o binário (`zbar.wasm`,
  ~239kB) e o glue JS (~13kB) só são baixados quando o engine ZBar é
  realmente usado (painel de benchmark aberto **e** ZBar testado/capturado).
  Nunca faz parte do bundle inicial da aplicação — ver
  [Impacto no bundle](#impacto-no-bundle) abaixo.
- **API usada:** `scanImageData(imageData)`, filtrando o resultado por
  `typeName === 'ZBAR_CODE128'` — o ZBar detecta vários formatos (QR, EAN,
  DataMatrix...), mas só CODE128 é aceito, igual aos outros dois engines.

#### Bug real encontrado e corrigido: `zbar.wasm` 404 em desenvolvimento

Ao testar o painel pela primeira vez, o ZBar falhava com
`WebAssembly.instantiate(): expected magic word ... found 3c 21 64 6f` — que é
`<!do` em ASCII, ou seja: o navegador recebeu **HTML** (a própria
`index.html` do app) em vez do binário `.wasm`. Causa raiz, confirmada
inspecionando as requisições de rede: o pacote calcula a URL do `.wasm` com
`new URL('zbar.wasm', import.meta.url)`, relativo ao próprio módulo — mas o
pré-empacotamento de dependências do Vite em dev (`node_modules/.vite/deps/`)
copia só o JS gerado, não esse `.wasm` irmão. A URL calculada apontava para
`/node_modules/.vite/deps/zbar.wasm`, que não existe ali; o servidor de dev
caiu no fallback padrão de SPA (serve `index.html` para qualquer rota não
encontrada) — daí o HTML disfarçado de erro de WASM.

**Correção:** `vite.config.js` (novo arquivo — o projeto não tinha nenhum até
agora) exclui `@undecaf/zbar-wasm` do pré-empacotamento
(`optimizeDeps.exclude`), fazendo o Vite servir o pacote direto de
`node_modules` em dev, onde o `.wasm` está de fato ao lado do `.mjs`.
Verificado depois da correção: a requisição passa a ser
`GET /node_modules/@undecaf/zbar-wasm/dist/zbar.wasm` →
`200 application/wasm`. **A build de produção nunca teve esse problema** — o
`vite build` já resolvia corretamente a URL do asset via sua própria análise
de `new URL(..., import.meta.url)`, gerando um arquivo hasheado
(`dist/assets/zbar-*.wasm`) servido com o content-type certo — verificado
tanto pelo conteúdo de `dist/assets/` quanto por uma checagem de rede real
contra `vite preview`.

### Impacto no bundle

Medido com `npm run build`, comparando antes/depois desta tarefa:

| Chunk | Antes | Depois | Observação |
|---|---|---|---|
| `index-*.js` (bundle principal) | 259.093 bytes | 259.114 bytes | +21 bytes — irrelevante |
| `NfeReaderPage-*.js` | 993.491 bytes | 994.562 bytes | +~1kB — só o `React.lazy()` e a checagem da flag |
| `NfeScannerBenchmark-*.js` | — | 14.828 bytes | **novo, chunk separado**, só baixado com o painel aberto |
| `index-*.mjs` (glue do ZBar) | — | 12.938 bytes | **novo, chunk separado**, só baixado quando ZBar é usado |
| `zbar-*.wasm` | — | 238.653 bytes | **novo, asset separado**, idem |
| CSS global | 55.164 bytes | 57.526 bytes | +2.362 bytes — estilos do painel (CSS não é code-split pelo Vite; ficam na folha global mesmo sem o painel ser aberto) |

Conclusão: o bundle inicial da aplicação (o que todo usuário baixa sempre)
cresce em torno de **1kB de JS + 2,3kB de CSS** — o restante (~266kB de
JS/WASM do ZBar + o painel) só é baixado por quem realmente abrir
`?nfeScannerDebug=1` e usar o benchmark.

### Fixtures — matriz comparativa (`testFixtures/validate-decoder-benchmark.mjs`)

Mesmo conjunto de fixtures de `testFixtures/README.md`, rodado nos três
engines em Nível A (decoder cru, mesma imagem, sem recorte/rotação/deskew) e
no pipeline de produção completo (Nível B). Resultado medido nesta máquina
(headless Chromium com `--use-fake-device-for-media-stream`; nativo aparece
"indisponível" porque este ambiente/versão de Chromium não expôs suporte a
`code_128` no `BarcodeDetector` — diferente do Android Chrome real, onde ele
existe):

| fixture | nativo | ZXing (cru) | ZBar (cru) |
|---|---|---|---|
| clean.png | indisponível | OK 22ms | OK 35ms |
| tight-margin.png | indisponível | OK 3ms | OK 3ms |
| zero-margin.png | indisponível | OK 2ms | OK 3ms |
| rotated-90deg.png | indisponível | **não detectou** 6ms | OK 3ms |
| low-res.png | indisponível | OK 2ms | OK 2ms |
| low-contrast.png | indisponível | OK 3ms | OK 4ms |
| tilted-2deg.png | indisponível | OK 7ms | OK 10ms |
| tilted-6deg.png | indisponível | **não detectou** 7ms | OK 11ms |
| tilted-10deg.png | indisponível | OK 5ms | OK 11ms |
| tight-margin-tilted-4deg.png | indisponível | **não detectou** 7ms | OK 19ms |
| **Resumo** | 0/10 | **7/10**, ~6ms médios | **10/10**, ~10ms médios |

Achado que surpreendeu: o ZBar **cru** (sem nenhum recorte/rotação manual)
decodificou 10/10, incluindo rotação de 90° e inclinações que o ZXing cru
não decodificou sem ajuda do pipeline de estágios — sugere que o ZBar já tem
alguma tolerância a rotação/inclinação embutida no próprio algoritmo. Isto
**não** é ainda motivo para trocar o engine de produção: são fixtures
sintéticas e limpas, sem o ruído de uma foto real de celular (compressão,
blur, luz) — só uma pista forte o bastante para valer a pena confirmar com a
NF real. `tilted-10deg.png`, que falhava consistentemente sem o estágio de
deskew (ver `testFixtures/README.md`), decodificou no nível cru desta rodada
— reforça a nota já existente ali de que o efeito de reamostragem em cada
ângulo específico não é perfeitamente previsível, não uma contradição.

Para reproduzir: `npm run dev` num terminal, depois
`node src/features/nfeReader/testFixtures/validate-decoder-benchmark.mjs`
(mesmo pré-requisito de `playwright-core` de `validate-fixtures.mjs`).

### Dynamsoft Barcode Reader — referência comercial (não instalado)

Pesquisado para servir de referência profissional num teste futuro
separado — **não instalado** neste projeto, nem no bundle principal nem no
benchmark:

- Pacote atual: `dynamsoft-barcode-reader-bundle` (o antigo
  `dynamsoft-javascript-barcode` está descontinuado).
- Suporta CODE128 (e vários outros formatos), leitura via câmera do navegador
  embutida no próprio SDK.
- Licença de teste: um trial embutido de 24h funciona sem nenhuma
  configuração; para um teste mais longo, dá para pedir uma licença de trial
  de 30 dias pelo portal deles (extensível a até 60 dias no total).
- Exige contexto seguro (HTTPS) — mesma exigência de `getUserMedia` que o
  resto deste módulo já tem.
- **Como testar sem comprometer este repositório:** um projeto separado
  (fora deste repo, ou numa branch descartável nunca mergeada), instalando o
  pacote e pedindo a licença de trial pelo portal da Dynamsoft — a chave de
  licença **nunca** deve ser commitada (nem em `.env` versionado, nem em
  código). Objetivo do teste: mesma NF, mesmo celular, mesmo navegador, igual
  ao Modo A/B deste benchmark — se o Dynamsoft ler de cara onde
  nativo/ZXing/ZBar não leem, é evidência forte de que o problema está no
  stack gratuito/configuração atual; se nem ele ler, o problema provavelmente
  está na foto/impressão/física do código, não no decoder.

## Log de diagnóstico

Todo o pipeline loga no console do navegador com prefixo `[NFe]` — fluxo
normal via `console.log`/`console.debug`, e qualquer erro inesperado (não o
"não achei nada" esperado de uma tentativa) via `console.error` com
`{ name, message, stack }` completos. Não há `catch {}` silencioso em nenhum
ponto do pipeline: uma falha em uma etapa (ex. um recorte específico que não
consegue rotacionar) só pula aquela tentativa e segue para a próxima, sempre
com o motivo registrado. Isso foi decisão deliberada para que um problema em
produção seja diagnosticável a partir do console, sem precisar reproduzir
localmente.

Além do log de fluxo, `decodeDiagnostics.js` classifica CADA tentativa de
decodificação em um de cinco desfechos (não_encontrado/formato_errado/
tamanho_inválido/dv_inválido/válido) — tanto no pipeline estático
(`barcodeReader.js`, via `onAttempt`) quanto no scanner ao vivo
(`liveScanner.js`, via `onDiagnostics`, throttled a 500ms). `extractor.js`
usa esses contadores para escolher a mensagem de aviso certa (ver
[Escolha final da chave](#escolha-final-da-chave-e-cruzamento-de-fontes-extractorjs))
em vez de um "não localizado ou ilegível" genérico, e `NfeLiveScanner.jsx`
mostra os contadores num painel só em desenvolvimento (ver
[Painel de diagnóstico](#painel-de-diagnóstico-só-em-desenvolvimento)).
Nunca loga a chave inteira, só métricas — seguro para deixar em
`console.debug` mesmo fora de desenvolvimento.

## Reentrância — clique duplo

`NfeReaderPage.jsx` guarda um `processingRef` (`useRef(false)`) que é marcado
`true` no início de `runAnalysis` e liberado no `finally`. Um segundo clique
disparado antes do primeiro terminar (ex. duplo clique físico, antes do React
re-renderizar o botão como `disabled`) é ignorado e logado como
`[NFe] Análise já em andamento — clique ignorado.`, em vez de rodar o
pipeline inteiro duas vezes em paralelo (o que gerava logs duplicados e
resultado indeterminado sobre qual das duas execuções "vencia" no estado).

## Assets self-hosted (pdf.js e tesseract.js)

`scripts/copy-vendor-assets.mjs`, rodado automaticamente no `npm install`
(hook `postinstall`), copia de `node_modules` para `public/` (servido tanto em
dev quanto em `dist/` após o build) os arquivos que essas duas libs montam
dinamicamente em tempo de execução e que por isso o bundler não consegue
resolver estaticamente:

- `public/pdfjs/{wasm,cmaps,standard_fonts,iccs}/` — de `pdfjs-dist`.
- `public/tesseract/worker.min.js` + `public/tesseract/core/` (as 4 variantes
  de `tesseract-core*.wasm.js`) — de `tesseract.js`/`tesseract.js-core`.

Ambos os diretórios ficam fora do controle de versão (`.gitignore`), já que
são inteiramente regenerados a partir de `node_modules` — nada ali é editado
à mão. O dado de idioma treinado do tesseract.js (`eng.traineddata`, algumas
dezenas de MB) **não** é self-hosted: continua vindo do CDN oficial do
tesseract.js na primeira execução de OCR em cada navegador (padrão
recomendado pela própria lib — auto-hospedar um pacote de idioma inteiro só
para reconhecer dígitos não compensaria), e fica em cache no IndexedDB do
navegador depois disso. Consequência prática: **as etapas de texto e código
de barras funcionam 100% offline; o fallback de OCR precisa de internet na
primeira vez que roda em cada navegador.**

## Code-splitting

`NfeReaderPage` (e todas as suas dependências pesadas — `pdfjs-dist`,
`@zxing/*`, `tesseract.js`) é carregado via `React.lazy` a partir de `App.jsx`,
então esse código só é baixado por quem efetivamente abrir a tela "Leitura
automática (beta)" — o restante do app (fluxo de `Novo recebimento`, etc.) não
paga esse custo.

Dentro do módulo, `NfeScannerBenchmark.jsx` é, por sua vez, um segundo nível
de `React.lazy` a partir de `NfeReaderPage.jsx` — e `@undecaf/zbar-wasm` (o
maior peso do benchmark, JS+WASM) só é baixado dentro dele via `import()`
dinâmico em `zbarDecoder.js`. Ver
[Impacto no bundle](#impacto-no-bundle) para os números medidos.

## Testes

`npm test` roda `node --test src/features/nfeReader/*.test.mjs
src/features/nfeReader/decoders/*.test.mjs` — sem navegador, sem dependência
de teste adicional (usa o test runner nativo do Node). `chaveNFe.test.mjs`
cobre: validação do DV de uma chave real, extração de todos os campos
interpretados, `findValidNfeKeys` com a chave formatada com espaços/hífens/
quebras de linha, rejeição de sequências de 44 dígitos com DV inválido,
deduplicação de chaves repetidas no mesmo texto, e rejeição de uma chave com
DV adulterado via `interpretarChave`. `analysisBuilder.test.mjs` cobre
`analyzeNfeKey`/`buildAnalysisFromKey`: chave válida preenchendo os campos
derivados dela, ausência de invenção de pedido/valor/data quando não há texto
(caso do scanner), rejeição de chave com DV inválido sem lançar, aceite de
chave formatada com espaços, e propagação correta de `fontesCruzadas`/
`origensChave`. `decodeDiagnostics.test.mjs` cobre a classificação de
desfecho (`classifyDecodedText`) e o contador (`createDiagnosticsCounter`).

Do benchmark de decoders (ver [seção acima](#benchmark-de-decoders-diagnóstico)):
`decoders/decoderTypes.test.mjs` cobre `buildDecodeResult`/`maskValue`/
`unavailableResult` — mascaramento correto, classificação de chave válida/
inválida/tamanho errado, propagação de erro técnico sem inventar tempo.
`imageStats.test.mjs` cobre `computeLuminanceStats` com imagens sintéticas
(branco puro, preto puro, metade/metade). `cameraCapabilities.test.mjs` cobre
`summarizeCameraState` com capabilities completas, ausentes (tudo "N/D", nunca
um valor inventado) e o caso de zoom `0` (não confundido com "ausente").
`benchmarkReport.test.mjs` cobre o texto de "Copiar diagnóstico", incluindo
uma checagem explícita de que nenhuma chave de 44 dígitos ou termo fiscal
proibido (CNPJ/pedido/valor/fornecedor) aparece no texto gerado.
`scannerDebug.test.mjs` cobre a flag em vários formatos de query string e o
caso sem `window`.

Mas testes de lógica pura não provam que o **decoder** consegue interpretar
pixels de verdade — para isso, `testFixtures/` tem dois scripts Playwright
repetíveis: `validate-fixtures.mjs` (pipeline de produção,
`readCode128FromCanvas`) e `validate-decoder-benchmark.mjs` (os três engines
isolados, Nível A/B) — ver [testFixtures/README.md](testFixtures/README.md) e
a [matriz comparativa](#fixtures--matriz-comparativa-testfixturesvalidate-decoder-benchmarkmjs)
acima. Nenhum dos dois faz parte de `npm test` (precisam de navegador +
servidor de dev rodando), mas são a forma de reproduzir "essa imagem
decodifica, em qual engine?" sem precisar de celular físico toda vez.

O restante do pipeline (renderização de PDF, ZXing/nativo ao vivo via
câmera, tesseract.js) depende de APIs de navegador (`Canvas`, `Worker`,
`getUserMedia`, `BarcodeDetector`) e não roda no test runner do Node —
`liveScanner.js` e `NfeLiveScanner.jsx` estão na mesma situação de
`barcodeReader.js`/`ocrReader.js`/`pdfExtractor.js` já eram. A validação
desses caminhos é manual, seguindo o roteiro em
["Como testar manualmente"](../../../README.md#como-testar-manualmente) no
README raiz.

## Limitações conhecidas e decisões de escopo

Deliberadas, não esquecidas — mantidas estreitas para o pipeline continuar
rápido:

- **Um único nível de contraste** (`THRESHOLD_LEVEL = 160`) é tentado no
  código de barras, não uma varredura de vários níveis. Cobre boa parte dos
  casos de baixo contraste; casos piores caem para o fallback de OCR, que é o
  caminho pensado para digitalização realmente ruim.
- **OCR tenta só 2 regiões, sem rotação.** Mais lento que o ZXing, então o
  conjunto de tentativas é menor por design — feito para o caso comum (chave
  impressa na horizontal, perto do topo), não para toda variação de
  digitalização.
- **Sem garantia de leitura em qualquer digitalização.** O objetivo do
  pipeline é degradar bem (nunca travar, sempre permitir preenchimento
  manual), não vencer qualquer scan por pior que seja.
- **OCR de página inteira/interpretação completa do documento está fora de
  escopo** — o OCR aqui é estritamente um fallback de 44 dígitos, não um
  substituto para leitura de campos de texto livre.
- **O scanner ao vivo não faz OCR contínuo sobre o vídeo, de propósito.**
  Rodar `tesseract.js` frame a frame seria pesado demais para celular; o
  objetivo do scanner é ser rápido e confiável para código de barras. OCR
  continua sendo estritamente do pipeline de arquivo/foto/captura manual
  ("Capturar e analisar").
- **Deskew não recupera 100% das inclinações entre 3° e 10°**, por design —
  ver [Investigando a robustez do scanner](#investigando-a-robustez-do-scanner-e-de-onde-vieram-os-estágios)
  e `testFixtures/README.md` para os números exatos e o caso conhecido que
  ainda falha (`tilted-10deg.png`). Não é tratado como bug escondido: está
  documentado e coberto pelo script de validação.
- **`BarcodeDetector` nativo é Chromium-only.** Safari/iOS (e navegadores sem
  suporte) usam sempre o caminho ZXing — mais lento, mas testado e
  funcional; a leitura nunca fica indisponível por falta do nativo, só um
  pouco menos rápida.
- **ROI (região de interesse) real não foi implementado.** Cortar o frame de
  vídeo só na área da moldura antes de decodificar poderia reduzir ainda mais
  o custo por tentativa, mas exigiria um pipeline de captura de frame
  próprio — não há evidência hoje de que isso resolva algo que os estágios
  atuais (nativo, recortes, margem, deskew) não resolvam; fica registrado
  como possível melhoria futura, não implementado nesta rodada.
- **Zoom não é ajustado automaticamente**, mesmo quando a câmera suporta —
  zoom agressivo pode cortar o código ou piorar a experiência; a lanterna já
  cobre o caso de baixa luz.
- **Testado com dispositivo real de forma limitada durante o
  desenvolvimento.** A implementação foi validada em navegador headless com
  câmera falsa (`--use-fake-device-for-media-stream` do Chromium) — cobre o
  fluxo de permissão, início/parada da câmera, o laço de decodificação ao
  vivo sem disparar o bug de rotação do ZXing, e o encerramento correto das
  tracks. Não substitui teste em aparelho físico Android/iOS — ver
  ["Testes que precisam de dispositivo físico"](../../../README.md#como-testar-manualmente)
  no README raiz.
- **O benchmark de decoders (`?nfeScannerDebug=1`) só compara — não decide.**
  Esta tarefa deliberadamente não trocou qual engine o scanner de produção
  usa (`startLiveScan`, `liveScanner.js`); a matriz de fixtures (ver
  [Benchmark de decoders](#benchmark-de-decoders-diagnóstico)) é evidência de
  laboratório, não o teste decisivo — que continua sendo a mesma NF real, no
  mesmo celular, testada nos três engines (Modo A/B) antes de qualquer
  mudança em produção. `BarcodeDetector` nativo apareceu "indisponível" nos
  testes automatizados desta máquina (Chromium headless) — isso é uma
  limitação do ambiente de teste, não uma afirmação sobre Android Chrome
  real, onde o suporte existe.

## Conexão futura (não feita)

`extractor.js` foi isolado exatamente para, quando fizer sentido usar isso de
verdade, a Etapa 3 (Evidências) do wizard `Novo recebimento` poder chamar
`analyzeNfeFile()` ao anexar a Nota Fiscal e pré-preencher
`numeroNf`/`serieNf`/`fornecedor`/`cnpjFornecedor` — sem reescrever nada do
pipeline descrito aqui.
