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
| [`barcodeReader.js`](barcodeReader.js) | Leitura de código de barras CODE_128 estático (arquivo/foto) via `@zxing/browser`/`@zxing/library`, com a estratégia manual de recorte/contraste/rotação (ver [por que sem `TRY_HARDER`](#por-que-o-zxing-roda-sem-try_harder)). Exporta `buildCode128Hints()`, reaproveitado também pelo scanner ao vivo. |
| [`liveScanner.js`](liveScanner.js) | Leitura contínua de CODE_128 pela câmera (`@zxing/browser`, `decodeFromConstraints`), com os MESMOS hints de `barcodeReader.js` e a MESMA validação de chave de `chaveNFe.js`. Sem dependência de arquivo/canvas estático — usado só pelo scanner ao vivo. |
| [`ocrReader.js`](ocrReader.js) | Fallback de OCR via `tesseract.js`, restrito a dígitos, usado só quando código de barras falha. Só se aplica ao pipeline de arquivo/foto — o scanner ao vivo não usa OCR (ver [Entradas em celular/tablet](#entradas-em-celulartablet-foto-e-scanner-ao-vivo)). |
| [`canvasUtils.js`](canvasUtils.js) | Primitivas de canvas DOM compartilhadas por `barcodeReader.js` e `ocrReader.js`: clonar, recortar, rotacionar, ampliar, binarizar (threshold). |
| [`textHeuristics.js`](textHeuristics.js) | Regex fracas sobre o texto do PDF para campos que a chave não cobre (data de emissão, valor total, pedido de compra) — sempre confiança "conferir" ou "baixa". |
| [`supplierCatalog.js`](supplierCatalog.js) | Catálogo local `CNPJ → nome do fornecedor` em `localStorage` (único uso de `localStorage` no app; alimentado a cada nota confirmada manualmente). |
| [`NfeReaderPage.jsx`](NfeReaderPage.jsx) | Tela: upload/foto/scanner, botão "Analisar nota", revisão com selos de confiança, edição manual, "Confirmar dados" → JSON copiável. |
| [`NfeLiveScanner.jsx`](NfeLiveScanner.jsx) | Overlay em tela cheia do scanner ao vivo: preview da câmera, guia de posicionamento, lanterna/troca de câmera quando suportadas, estados de permissão negada/sem câmera. |
| [`chaveNFe.test.mjs`](chaveNFe.test.mjs) | Testes de `node:test` para a matemática da chave (sem navegador). |
| [`analysisBuilder.test.mjs`](analysisBuilder.test.mjs) | Testes de `node:test` para a montagem do resultado a partir de uma chave (`analyzeNfeKey`/`buildAnalysisFromKey`), incluindo o caso do scanner (sem texto de PDF). |

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

Depois, `readCode128FromCanvas(canvas)` tenta decodificar em várias
combinações, na ordem, retornando no primeiro sucesso:

1. **6 recortes proporcionais** (`CROP_VARIANTS`, `barcodeReader.js:45`): topo
   25%, topo 35%, topo direito, topo esquerdo, metade superior, página
   inteira — nessa ordem, das regiões mais baratas/menos ruidosas (o código de
   barras do DANFE fica perto do topo) até a página toda como último recurso.
   Um recorte com menos de `MIN_DECODE_WIDTH = 1200` px de largura é ampliado
   2× (`upscaleCanvas`, com `imageSmoothingEnabled = false` para não borrar as
   barras finas).
2. Para cada recorte, **2 versões**: original e com contraste binarizado
   (`thresholdCanvas`, limiar fixo `THRESHOLD_LEVEL = 160` — um único nível,
   deliberadamente; ver [limitações conhecidas](#limitações-conhecidas-e-decisões-de-escopo)).
3. Para cada versão, **4 rotações** (0°/90°/180°/270°), feitas manualmente por
   `rotateCanvas` (`canvasUtils.js`, via `ctx.translate` + `ctx.rotate` +
   `ctx.drawImage` sobre um `<canvas>` DOM comum).

No pior caso isso é 6 × 2 × 4 = 48 tentativas de decodificação, cada uma
logada em `console.debug`. A primeira que funcionar retorna o texto decodificado.

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

Em telas de até 920px (mesmo corte usado no resto do app para alternar entre
layout desktop e mobile/tablet), a etapa "1. Selecionar arquivo" ganha duas
entradas adicionais, lado a lado com o upload:

- **Tirar foto** — um segundo `<input type="file" accept="image/*"
  capture="environment">`, oculto, ao lado do input de upload normal
  (`NfeReaderPage.jsx`, `cameraInputRef`). `capture="environment"` é só uma
  *preferência* para o navegador priorizar a câmera traseira — não uma
  garantia; onde não suportado, o dispositivo abre o seletor de arquivos
  normal. A foto resultante é o mesmo tipo de `File` que o upload comum: cai
  no mesmíssimo `onSelectFile` → `analyzeNfeFile(file)`, sem pipeline
  paralelo.
- **Escanear código de barras** — abre `NfeLiveScanner.jsx` em tela cheia,
  com a câmera ao vivo (não é um seletor de arquivo).

No desktop (>920px) só "Selecionar arquivo" aparece — a tela continua igual à
versão original.

### Scanner ao vivo (`liveScanner.js` + `NfeLiveScanner.jsx`)

Diferente do upload/foto, o scanner não produz um `File`: ele decodifica o
código de barras diretamente de frames de vídeo via
`BrowserMultiFormatReader.decodeFromConstraints` (`@zxing/browser`, já usado
no resto do módulo), com preferência por câmera traseira
(`facingMode: { ideal: 'environment' }`) e sem solicitar microfone (nunca
`audio: true`).

**Mesmos hints, mesmo motivo de nunca usar `TRY_HARDER`.** `liveScanner.js`
usa `buildCode128Hints()`, exportado de `barcodeReader.js` — a mesma função,
não uma cópia — então o [bug de rotação interna do ZXing](#por-que-o-zxing-roda-sem-try_harder)
não pode ressurgir aqui: `decodeFromConstraints` decodifica cada frame
chamando o mesmo `decodeFromCanvas` de sempre por baixo dos panos.

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

## Testes

`npm test` roda `node --test src/features/nfeReader/*.test.mjs` — sem
navegador, sem dependência de teste adicional (usa o test runner nativo do
Node). `chaveNFe.test.mjs` cobre: validação do DV de uma chave real, extração
de todos os campos interpretados, `findValidNfeKeys` com a chave formatada
com espaços/hífens/quebras de linha, rejeição de sequências de 44 dígitos com
DV inválido, deduplicação de chaves repetidas no mesmo texto, e rejeição de
uma chave com DV adulterado via `interpretarChave`. `analysisBuilder.test.mjs`
cobre `analyzeNfeKey`/`buildAnalysisFromKey`: chave válida preenchendo os
campos derivados dela, ausência de invenção de pedido/valor/data quando não há
texto (caso do scanner), rejeição de chave com DV inválido sem lançar, aceite
de chave formatada com espaços, e propagação correta de `fontesCruzadas`/
`origensChave`.

O restante do pipeline (renderização de PDF, ZXing estático, ZXing ao vivo via
câmera, tesseract.js) depende de APIs de navegador (`Canvas`, `Worker`,
`getUserMedia`) e não roda no test runner do Node — `liveScanner.js` e
`NfeLiveScanner.jsx` estão na mesma situação de `barcodeReader.js`/
`ocrReader.js`/`pdfExtractor.js` já eram. A validação desses caminhos é
manual, seguindo o roteiro em
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
  continua sendo estritamente do pipeline de arquivo/foto.
- **Testado com dispositivo real de forma limitada durante o
  desenvolvimento.** A implementação foi validada em navegador headless com
  câmera falsa (`--use-fake-device-for-media-stream` do Chromium) — cobre o
  fluxo de permissão, início/parada da câmera, o laço de decodificação ao
  vivo sem disparar o bug de rotação do ZXing, e o encerramento correto das
  tracks. Não substitui teste em aparelho físico Android/iOS — ver
  ["Testes que precisam de dispositivo físico"](../../../README.md#como-testar-manualmente)
  no README raiz.

## Conexão futura (não feita)

`extractor.js` foi isolado exatamente para, quando fizer sentido usar isso de
verdade, a Etapa 3 (Evidências) do wizard `Novo recebimento` poder chamar
`analyzeNfeFile()` ao anexar a Nota Fiscal e pré-preencher
`numeroNf`/`serieNf`/`fornecedor`/`cnpjFornecedor` — sem reescrever nada do
pipeline descrito aqui.
