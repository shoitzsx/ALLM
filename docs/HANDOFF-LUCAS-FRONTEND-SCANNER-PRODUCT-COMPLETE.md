# Handoff técnico completo — Frontend, UX, Scanner e Produto (Lucas)

Contexto do documento: registro técnico extremamente detalhado de tudo que Lucas desenvolveu, decidiu ou conduziu no projeto ALM (frontend, UX, scanner de NF-e, produto), para servir de insumo a outra sessão de IA que vai desenhar a próxima arquitetura do sistema usando Supabase. Não é um resumo — cada seção reflete leitura direta do código (com arquivo:linha), não paráfrase superficial.

## Convenção de evidência (usada em todo o documento)

- **[Código]** — confirmado lendo o arquivo-fonte diretamente, com caminho e linha citados.
- **[Teste]** — confirmado por um teste automatizado existente (`npm test`) ou por um dos scripts `validate-*.mjs` do módulo de scanner.
- **[Git]** — confirmado por `git log`/`git show` (hash, autor, arquivos alterados).
- **[Decisão de produto]** — decisão já tomada e registrada (nos prompts originais, em comentários de código, ou nesta conversa), não uma suposição.
- **[Ideia futura]** — visão/plano ainda não implementado, registrado explicitamente como tal.
- **[Hipótese]** — interpretação razoável, não 100% confirmada; sinalizada como tal sempre que aparecer.

---

## 1. Visão do produto

**Objetivo do ALM**: substituir um processo de recebimento de materiais hoje baseado em planilha Excel, grupo de WhatsApp, e-mail e pastas de rede (`L:\Compartilhado\Suprimentos\Suprimentos\NFE's`) por uma ferramenta digital única — upload de fotos/documentos, armazenamento com acesso restrito, pesquisa rápida **[Decisão de produto, `promptV2.md:5,25`]**.

**Quem usa**: equipe de Almoxarifado (lança e concilia recebimentos), Suprimentos (resolve divergências), Administrador (gestão completa, único perfil que pode mexer em registros finalizados) e um perfil só-leitura, Consulta **[Decisão de produto, `promptV1.md`/`promptV2.md` seção 6; confirmado no código via `USER_ROLE_OPTIONS`, `data.js:96-101`]**.

**Fluxo de recebimento (como funciona hoje)**: criar registro → informar/pesquisar Pedido de Compra → cadastrar itens (quantidade, unidade, descrição) → tirar fotos/upload de documentos (NF, DACTE, Pedido, outros) → registrar observações/divergências → identificar responsável (hoje automático pelo usuário logado) → avançar por um fluxo de status definido → consulta posterior rápida **[Decisão de produto, `promptV2.md` seções 2-3]**.

**Fluxo de status** (`Em digitação → Aguardando documentação → Em conferência → Divergência identificada → Conferido/Finalizado`) foi uma decisão explícita da v2 do prompt original, corrigindo a v1 (que não tinha status nem campo de Responsável formal) **[Decisão de produto, `promptV2.md:44,238-246`]** — confirmado implementado 1:1 no código via `RECEBIMENTO_STATUS` (`data.js:9-15`).

**Problema operacional que resolve**: elimina re-envio de fotos por WhatsApp/e-mail, pastas criadas manualmente, Responsável anotado informalmente dentro de "Observações", ausência de campo de Status, e falta de lista controlada para Unidade/Tipo (hoje digitação livre na planilha real) **[Decisão de produto, `promptV2.md:18-24`]**.

**Nota sobre OCR/leitura automática de NF**: a v1 do prompt original listava "Leitura de dados da NF" como automação desejável sem qualificar prioridade; a v2 **reclassificou isso explicitamente como Fase 2, não pré-requisito do MVP** ("dado que o processo atual é 100% manual/escaneado") **[Decisão de produto, `promptV2.md:198,246`]** — isso é relevante porque o scanner (Seção 5) acabou sendo construído de qualquer forma, com escopo deliberadamente contido (só a chave de 44 dígitos, nunca os itens/valores) — compatível com essa reclassificação de prioridade, não a contradiz.

---

## 2. Minha participação (Lucas)

Atribuição por autor confirmada via `git log --format="%h %an %s"` **[Git]**. Lucas é autor de **26 dos 36 commits** no histórico do projeto (todos os commits sem indicação de autor abaixo são de Lucas). Outros autores: **Gorann0** (backend — OAuth do Drive, persistência no Sheets, confiabilidade de upload, testes), **MatteusKobner** (dark mode, remoção de dados mock), **paidoszz** (merge, remoção de dados mock), **shoitzsx** (commit inicial do repositório).

### Frontend (interface/produto) — todos de Lucas
- Toda a arquitetura de componentes do React (routing hash-based, store global, API client) — commit `f43318e` "extract layout and receipt components from App.jsx" (refatoração que separou `Sidebar`, `MobileHeader`/`MobileNav`, `navigation.js`, `KpiStrip`, `ReceiptsTable`/`ReceiptMobileCard`, `FilterBar`, `PageHeader` do `App.jsx` monolítico).
- Toda a integração frontend do fluxo de anexos resumíveis: commit `89cc8a5` "integrate resumable attachment uploads" (`src/App.jsx` 159 linhas alteradas, `src/api.js`, `src/store.js`, `src/features/attachments/*` novo).
- O fix do bug de imports ausentes + estado "Finalizando..." + CORS/quota percebidos do lado do frontend: commit `2f1e9b4` "fix: Drive upload CORS, Sheets read quota, and stale imports".
- O fix do bug de loading/erro/vazio indistinguíveis: commit `8e64135` "fix: distinguish loading, error and empty receipt states".
- 100% do módulo de scanner de NF-e, do zero: commits `2381a69` (introdução câmera+scanner ao vivo), `6d113d0` (gate por capability, não viewport), `8349683`/`9711597`/`23a2a7d` (robustez do scanner, deskew, benchmark de decoders), `4374c49` (fallback de foto de alta qualidade + ZBar em produção), `81d03e1` (esconder scanner ao vivo da UI de produção), `0337822` (handoff pra "Novo recebimento").
- Vários ajustes de UI/UX pontuais: `5dc0a12` (contraste do logo), `91d61b6` (fix filtro NF-pendente escondendo tudo), `8631c4e` (truncamento de título), `9fa7aca` (tokens de design), `e67b1aa` (reorganização de assets de marca), `7812c75` ("mudei visual"), `6b2fd4b` ("Restyle UI toward a sober corporate/enterprise look").
- Migração do backend para Vercel Functions no mesmo projeto do frontend: `0ab79c2` (toca `src/api.js` minimamente também).
- O fix de roteamento aninhado da Vercel (histórico já coberto em `docs/HANDOFF-GORAN-VERCEL-ROUTING-PRODUCTION.md`): `c7bffda`.
- Remoção de dados fictícios da UI de apresentação: `f70552e`, `2999290` ("Popular dados de demonstração para apresentação").
- `451cf92` "Leitura de codigo de barras" — commit inicial que introduziu a ideia de leitura de código de barras antes mesmo da reestruturação completa do módulo scanner.

### Debugging conduzido/documentado por Lucas
- Toda a investigação do incidente de 404/roteamento da Vercel em Production (seção já coberta no handoff `HANDOFF-GORAN-VERCEL-ROUTING-PRODUCTION.md`, não repetida aqui).
- O diagnóstico do bug de imports ausentes (`attachmentDownloadHref` etc.) via passagem manual de ESLint `no-undef`, documentado em `docs/HANDOFF-GORAN-ATTACHMENTS-DEBUG.md` (criado por Lucas, 685 linhas) junto com a investigação de CORS do Drive e quota de leitura do Sheets.
- A investigação completa do pipeline de decodificação do scanner (ZBar vs ZXing vs BarcodeDetector nativo), incluindo um benchmark com 10 fixtures sintéticas e scripts de validação via Playwright contra um dev server real — não suposição, evidência medida (`src/features/nfeReader/testFixtures/README.md`).
- O root-cause de um bug real de produção ("Could not create a Canvas element.") rastreado até o código-fonte da própria `@zxing/library` (`OneDReader.decode` chamando `image.rotateCounterClockwise()` internamente quando `TRY_HARDER` está ativo) — corrigido removendo o hint e reimplementando rotação manualmente.
- O root-cause de um bug real do React StrictMode em `receiptHandoff.js` (dupla invocação do inicializador de `useState` consumindo o valor na primeira chamada) — encontrado testando com Playwright, documentado no cabeçalho do próprio arquivo.

### Infra que acompanhei (sem ser o autor principal, mas participei da investigação)
- Debug completo de upload resumível pro Google Drive (CORS, sessionUrl, timeout/retry) — documentado em `docs/HANDOFF-GORAN-ATTACHMENTS-DEBUG.md`.
- Investigação e correção do roteamento da Vercel (`fix/vercel-api-routing`), incluindo descoberta de que o catch-all dinâmico (`api/v1/[...path].mjs`) só casava 1 segmento de path.
- Análise comparativa do relatório técnico da turma (PDF "Visão Geral — Escalabilidade e Evolução Tecnológica do ALM") contra o código real, incluindo a descoberta de que já existe um documento interno (`ARQUITETURA_TECNICA_ALM.md`) com uma "decisão arquitetural fixa" para PostgreSQL + Google Shared Drive que diverge em detalhes da recomendação do relatório (Supabase especificamente).

---

## 3. Frontend — arquitetura completa

**React 18.3.1 + react-dom 18.3.1** **[Código, `package.json:26-27`]**. Entry point `src/main.jsx` monta `<App/>` dentro de `<React.StrictMode>` **[Código, `main.jsx:12-16`]** — isso importa porque o StrictMode duplica a chamada do inicializador de `useState` em desenvolvimento, o que já causou o bug real do `receiptHandoff.js` descrito acima.

**Vite 6.0.5** **[Código, `package.json:31`]**. `vite.config.js:1-29`: o dev server faz proxy de `/api` → `http://localhost:3001` (backend local), então o frontend sempre chama caminhos relativos `/api/v1/...`, idênticos em dev e em produção (Vercel). `optimizeDeps.exclude: ['@undecaf/zbar-wasm']` contorna um bug real do pré-bundling do esbuild em dev, onde o binário `.wasm` não é copiado junto do JS — comentário longo no próprio arquivo explicando o bug real que motivou isso.

**Routing: hash routing feito à mão, sem biblioteca de router** **[Código, `src/layout/navigation.js`]**:
- `ROUTES` (`navigation.js:4-10`): `dashboard: '/'`, `receipts: '/recebimentos'`, `newReceipt: '/novo'`, `pending: '/pendencias'`, `nfeReader: '/leitura-automatica'`. A rota de detalhe `/recebimentos/:id` **não está em `ROUTES`** — é casada ad-hoc em `App.jsx:1384` via `route.path.startsWith('/recebimentos/')`.
- `useHashRoute()` (`navigation.js:26-37`): hook `useState` + listener de `hashchange`, mais um `scrollTo({top:0, behavior:'instant'})` a cada troca de hash.
- `navigate(path)` (`navigation.js:39-46`): seta `window.location.hash`; se já estiver nesse hash, faz scroll suave ao topo em vez de navegação nula.
- Despacho no topo vive em `App()` (`App.jsx:1370-1389`) como uma cadeia de if/else no `route.path`, não uma tabela/switch.

**Gerenciamento de estado: um único store global feito à mão, sem Redux/Zustand/Context** **[Código, `src/store.js`]**:
- `let state` no nível do módulo (`store.js:54`), mutado só via `setState()` (merge raso + `emit()` pra um `Set` de listeners).
- `useRecebimentosStore()` (`store.js:1015-1079`) é o único hook de consumo, construído sobre `useSyncExternalStore` do React 18 — sem Provider, todo componente que chama o hook compartilha exatamente o mesmo snapshot.
- **MVP é estado volátil de propósito**: `loadPersistedState()` sempre retorna um estado padrão novo (`store.js:48-52`), `persistState()` é um no-op deliberado (`store.js:56-58`) — comentário no código diz literalmente "dados vivem somente em memória"; dar refresh na página perde tudo até re-hidratar da API.
- **Mutação local-first + sync em background**: toda função de domínio (`createRecebimento`, `updateRecebimento`, `addItem`, `transitionStatus`, `addDivergence` etc., `store.js:231-751`) é um mutador local puro sobre o estado em memória. `storeActions` (`store.js:851-950`) envelopa cada uma pra TAMBÉM chamar a função `api.*` correspondente via `syncMutation()` — uma fila de promessas por recebimento (`apiMutationQueues`, serializa mutações por id), e sempre chama `refreshReceiptFromApi(id)` depois do sucesso OU falha (uma mutação rejeitada ainda é corrigida pelo estado real do servidor). **Exceção**: anexos (add/remove) não são otimistas — comentário explícito no código: a UI só atualiza depois que o servidor confirma 201/200.
- `requireWritePermission()` (`store.js:126-129`) lança exceção se `role === 'Consulta'` — único gate de permissão client-side dentro do store.

**API client** (`src/api.js`):
- `API_BASE = import.meta.env.VITE_API_URL || '/api/v1'`.
- `currentUserId()` lê `localStorage['alm:api:user:v1']`, padrão `'USR-001'`; `setApiUser()` é exportada mas **nunca chamada em lugar nenhum do `src/`** — o mecanismo de troca de usuário existe no cliente mas não tem UI nenhuma pra acioná-lo.
- `apiRequest()` sempre manda `Content-Type: application/json` + `X-User-Id: <currentUserId()>`. Em erro, constrói o `Error` a partir de `payload.error.details`/`payload.error.message` do backend (não genérico), anexa `.code`/`.details` — é isso que permite a UI mostrar a mensagem específica do backend em vez de algo genérico.
- **Nenhuma lógica de retry em `api.js`** — um único `fetch`, sem backoff/retry wrapper.

**Tema**: `src/theme.jsx`, chave `localStorage['alm-theme']`, padrão `'light'`. Prevenção de "flash do tema errado": um `<script>` inline em `index.html` seta o tema antes mesmo do React montar.

**Responsivo/mobile — não é só CSS reflow da mesma marcação**: breakpoint estrutural em **920px**. `AppShell` sempre renderiza `<Sidebar>` + `<header className="topbar">` (desktop) E `<MobileHeader>` + `<MobileNav>` (mobile) simultaneamente no JSX — CSS `display:none/flex` alterna entre os dois. Mesmo padrão de duplo-render na tabela de recebimentos: `ReceiptsTable` sempre renderiza tanto `<table>` quanto `.mobile-records` (cards), CSS escondendo um ou outro. Outros breakpoints: 1180px, 640px (formulário/detalhe vira coluna única, modal vira bottom sheet), 360px. `prefers-reduced-motion: reduce` é respeitado.

**Design system/primitivos de UI** — tudo em `src/ui.jsx`: `StatusBadge` (mapeia os 5 status pra label/ícone/classe), `Avatar` (iniciais), `Modal` (Escape fecha, lock de scroll do body, `role="dialog" aria-modal`), `ToastHost` (`aria-live="polite"`), `EmptyState` (reutilizado em loading/erro/vazio em todo lugar), `FieldError`, `formatDate`/`formatDateTime`/`formatFileSize` (Intl `pt-BR`). Botões são classes CSS puras (`btn btn-primary`/`btn-secondary`/`btn-ghost`/`btn-danger-soft`), sem abstração de componente.

---

## 4. Todas as telas

Todas vivem dentro de `src/App.jsx`, exceto o leitor de NF-e (lazy-loaded).

### 4.1 DashboardPage (`App.jsx:300-434`), rota `/`
- **Propósito**: visão geral operacional / página de entrada.
- **Dados**: `store.receipts`, `store.metrics` (ver Seção 10).
- **Renderiza**: `KpiStrip`, painel "Recebimentos por status" (barras CSS puras, sem lib de gráfico), "Recebimentos recentes" (top 5 por `atualizadoEm`), "Requer atenção" (NF pendente ou divergência aberta, primeiros 5).
- **Ações**: "Novo recebimento", links de painel navegam pra recebimentos/pendências, clique em linha navega ao detalhe.
- **Loading/erro/vazio**: `<InitialLoadState>` (3 estados: `loading|error|ready`) — esse padrão existe especificamente porque antes loading/erro/vazio renderizavam a mesma UI de "nenhum recebimento" (bug real, corrigido no commit `8e64135`).
- **Permissões**: nenhuma diferença visível por perfil nesta tela.

### 4.2 ReceiptsPage (`App.jsx:436-507`), rota `/recebimentos`
- **Propósito**: tela de consulta/pesquisa principal (a "Consulta" do prompt original).
- Aceita `?q=` (busca pré-preenchida) e `?focus=search` (autofoco, usado pelo ícone de busca do `MobileHeader`).
- **Filtros** (estado do componente, nunca enviados como query param pro backend — ver Seção 9): `search, status, tipo, fornecedor, responsavel, periodoInicio, periodoFim, nfPendente`.
- **Ações**: "Exportar Excel" (CSV client-side via Blob), "Novo recebimento", limpar filtros, alternar ordenação, alternar painel de filtros avançados.
- **Vazio**: distinto do vazio de carga inicial — `<EmptyState icon={Search}>` "Nenhum recebimento encontrado" com ação "Limpar filtros".

### 4.3 NewReceiptPage (`App.jsx:521-877`), rota `/novo`
- **Propósito**: wizard de 4 passos (`WIZARD_STEPS`): Identificação → Itens → Evidências → Revisão.
- Formulário semeado por `peekPendingReceiptPrefill()` — leitura não-destrutiva do handoff do scanner de NF-e (ver Seção 5).
- Anexos ficam **só em preview local até o save** — não são enviados durante o wizard, só no momento de salvar.
- **Ações**: validação por passo (`validateStep`), seletores de arquivo por categoria (Foto/Nota Fiscal/DACTE/Pedido/Certificado/Outro), "Salvar e continuar depois" (rascunho, sem validação completa) vs "Enviar para conferência" (valida passos 0+1, cria o recebimento e já transiciona o status).
- **Erro**: `pushToast('Não foi possível salvar', error.message, 'error')` — mensagem **crua do backend**, não genérica.
- **Permissão**: nenhum guard de UI explícito escondendo "Novo recebimento" pra perfil Consulta — se um usuário Consulta chegasse aqui, a exceção só estouraria no momento do `store.createRecebimento` (via `requireWritePermission`), não antes.

### 4.4 DetailPage (`App.jsx:879-1307`), rota `/recebimentos/:id`
- **Propósito**: visão completa de um recebimento + todas as mutações possíveis (anexar documento, registrar/resolver divergência, remover anexo, avançar status).
- Encontra o recebimento na lista já hidratada (não faz fetch dedicado); calcula `allowedStatuses` via `getAllowedNextStatuses(receipt, currentUser)`.
- **Seções**: Dados gerais, Itens recebidos (destaque vermelho se `quantidadeSolicitada !== quantidadeRecebida`), Documentos (grid de anexos com ver/baixar/remover, mais um card de CTA sintetizado "Nota Fiscal pendente" quando não há doc de NF), Fotos do recebimento (só se existirem), Divergências, Histórico (merge de `historicoStatus` + `historicoAlteracoes`, até 10 entradas), painel condicional "Próximas etapas".
- **Ação primária contextual** computada do status atual (DIGITACAO→"Enviar para conferência"/"com pendência", AGUARDANDO_DOCUMENTACAO→"Adicionar Nota Fiscal" ou "Iniciar conferência", CONFERENCIA→"Finalizar recebimento", DIVERGENCIA sem pendências→"Devolver à conferência").
- **Upload de anexo é serializado de propósito**: se a categoria for "Nota Fiscal", primeiro aguarda `store.updateRecebimento` (número/série da NF) resolver completamente no backend **antes** de iniciar o upload do arquivo — corrige uma race condition real onde duas escritas quase simultâneas na mesma linha da planilha deixavam a confirmação do anexo presa.
- Fila de upload por arquivo com estados granulares `pending/uploading/finalizing/success/error`.
- **Gap encontrado**: `reopenDivergence` existe ponta a ponta (store → api → backend) mas **não há botão algum na UI que o chame** — divergências resolvidas só mostram um check, sem ação de reabrir.

### 4.5 PendingPage (`App.jsx:1309-1353`), rota `/pendencias`
- **Propósito**: visão tipo kanban de "o que precisa de ação hoje".
- Três baldes sobrepostos (um recebimento pode aparecer em mais de um): `docs` (NF pendente, fora de DIGITACAO), `review` (status CONFERENCIA), `divergence` (divergência aberta).
- Cards são acessíveis por teclado (`role="button" tabIndex={0}` + `onKeyDown` Enter) — diferente da tabela principal (ver Seção 12, inconsistência de acessibilidade).
- O badge global "Pendências" na Sidebar usa uma definição ligeiramente **diferente/mais ampla** que os três baldes somados individualmente.

### 4.6 NF-e Reader (`src/features/nfeReader/NfeReaderPage.jsx`), rota `/leitura-automatica`
Coberto em detalhe na Seção 5. Lazy-loaded especificamente para manter `pdfjs-dist`/`@zxing`/`tesseract.js`/`@undecaf/zbar-wasm` fora do bundle principal.

### 4.7 Telas que NÃO existem hoje (confirmado ausentes)
- **Nenhuma tela de Usuários** — apesar do backend implementar `GET/POST /usuarios` e `GET/PATCH /usuarios/:id` por completo, não existe rota, item de nav ou componente correspondente em `src/`.
- **Nenhuma tela de Configurações.**
- **Nenhuma tela de Login/autenticação.** `api.me()` (→ `GET /auth/me`) existe mas **nunca é chamada em lugar nenhum do `src/`**. O "usuário atual" é sempre `DEMO_CURRENT_USER` hardcoded (= `DEMO_USERS[0]`, "Marcos Teixeira", perfil Administrador). Clicar no chip de usuário na topbar só mostra um toast: *"Perfil demonstrativo — A autenticação corporativa será conectada na implantação."*

---

## 5. Scanner — documentação completa (seção mais importante)

### 5.0 Como começou e objetivo
Introduzido do zero por Lucas no commit `2381a69` "add camera photo capture and live barcode scanner", evoluindo por mais 7 commits dedicados até a forma atual. Objetivo: eliminar a digitação manual da chave de acesso de 44 dígitos da NF-e (que aparece no DANFE como código de barras CODE_128 e como número impresso). **Explicitamente fora de escopo desde sempre**: ler itens, valores ou quantidades do documento — só a chave e o que é calculável matematicamente a partir dela.

### 5.1 Arquitetura — visão geral do módulo
`src/features/nfeReader/` tem seu próprio `README.md` de 963 linhas — a documentação interna mais completa de qualquer parte do projeto. Arquivos principais: `NfeReaderPage.jsx` (orquestração/UI principal), `NfeLiveScanner.jsx` (scanner ao vivo — hoje escondido, ver 5.3), `NfePhotoCapture.jsx` (captura de foto dedicada — o caminho de câmera real usado em produção), `NfeScannerBenchmark.jsx` (painel de diagnóstico, só com flag), `extractor.js` (orquestrador do pipeline), `pdfExtractor.js`, `barcodeReader.js` (pipeline robusto ZXing+nativo), `zbarReader.js` (fast path ZBar), `ocrReader.js` (Tesseract, último recurso), `chaveNFe.js` (validação/interpretação da chave), `analysisBuilder.js` (monta o resultado final com confiança por campo), `textHeuristics.js` (regex fracas pra pedido/data/valor), `canvasUtils.js`, `decodeDiagnostics.js`, `nativeBarcodeDetector.js`, `cameraCapabilities.js`, `photoCapture.js`, `supplierCatalog.js`, `receiptHandoff.js`, `scannerDebug.js`, `benchmarkReport.js`, `benchmarkLiveRunner.js`.

**Bibliotecas** (`package.json`): `@undecaf/zbar-wasm` (ZBar via WebAssembly), `@zxing/browser` + `@zxing/library` (ZXing), `tesseract.js` (OCR), `pdfjs-dist` (texto embutido do PDF + renderização de página como imagem). `BarcodeDetector` não é dependência — é API nativa do navegador (Chromium apenas; Safari/iOS sempre cai pro caminho ZXing).

### 5.2 Pipeline de decodificação, exato, em ordem
Cada etapa só roda se a anterior não resolveu (`extractor.js`):

1. **PDF → texto embutido** (`pdfExtractor.js`). Se o PDF tiver a chave como texto selecionável (comum em PDF digital), encontra e **para aqui** — nunca renderiza a página como imagem, nunca aciona ZXing/OCR.
2. **Caminho rápido (fast path)**, uma tentativa de cada, sequencial, sem recorte/rotação/contraste:
   - **ZBar cru** primeiro.
   - **ZXing cru** segundo.
   - Motivo da ordem: benchmark com fixtures sintéticas mostrou ZBar 10/10 (incluindo rotação e inclinação leve) vs ZXing cru sozinho 7/10.
3. **Pipeline robusto** (`readCode128FromCanvas`, só se os dois acima falharem):
   1. `BarcodeDetector` nativo (se o navegador suportar) + ZXing na imagem inteira (original e com mais contraste), testando 4 rotações cardeais.
   2. Recortes da imagem (`CROP_VARIANTS`, pra fotos da página inteira, não só do código).
   3. Margem branca artificial (recupera fotos com o código enquadrado rente demais).
   4. Pequenas inclinações de correção (deskew) — só roda se nada acima resolveu.
4. **OCR** (`ocrReader.js`, Tesseract.js) — último recurso, lê os 44 dígitos impressos por extenso abaixo do código de barras (não as barras).

Compartilhado verbatim entre `analyzeNfeFile` (upload de arquivo/foto) e `analyzeNfeCanvas` (captura "ao vivo" de emergência) — sem lógica duplicada.

### 5.3 Fluxo de usuário completo, real, em produção

**Descoberta importante que não estava no meu conhecimento prévio deste projeto**: o **scanner ao vivo (câmera em tela cheia) está escondido da interface de produção hoje**. Commit `81d03e1` "[nfe] hide live scanner from production UI". Comentário no próprio código (`NfeReaderPage.jsx:399-408`):
> *"Scanner ao vivo (NfeLiveScanner) escondido da interface de produção — testado fisicamente (iPhone/Safari e Android/Chrome) e considerado pouco confiável por enquanto, mesmo quando o BarcodeDetector nativo está disponível. 'Fotografar código' (testada com sucesso no iPhone) é a única ação de câmera dedicada à leitura do código de barras agora."*

Todo o código do scanner ao vivo (`NfeLiveScanner.jsx`, `liveScanner.js`, `nativeBarcodeDetector.js`, `zbarReader.js`, `decoders/`) continua existindo, testado e funcional — só não é alcançável pela UI normal, apenas pelo painel de diagnóstico (`?nfeScannerDebug=1`, Modo B "teste ao vivo").

**O que o usuário final realmente vê hoje** (painel "1. Selecionar arquivo", decidido por **capability do dispositivo, nunca por largura de tela ou user-agent**):
1. **"Selecionar arquivo"** — sempre visível. `<input type="file" accept="application/pdf,image/jpeg,image/png">`, "PDF ou imagem, até 10 MB".
2. **"Tirar foto"** — só se o dispositivo tiver câmera E touch. Usa `<input capture="environment">` nativo do navegador, cai no mesmo `onSelectFile` de sempre.
3. **"Fotografar código"** — aparece sempre que houver câmera (mesmo sem touch — ex. webcam de notebook). Abre `NfePhotoCapture`, um overlay de câmera dedicado construído pelo projeto.

Depois de escolher arquivo: linha de preview (nome + tamanho) → botão "Analisar nota" (vira "Analisando…" com spinner, bloqueado contra duplo-clique via `useRef`, não `useState`, pra já valer antes do próximo re-render).

**Painel "2. Revisão"**, aparece depois da análise:
- Cabeçalho alterna entre "Chave de acesso validada... via {origem}" (sucesso) e "Nenhuma chave de acesso válida foi localizada. Preencha os campos manualmente." (falha) — mas **mesmo na falha, o usuário sempre pode prosseguir e preencher à mão**, nunca trava o fluxo.
- Campos de "Dados do recebimento" (numeroNf, serieNf, cnpjFornecedor, fornecedor, pedido, dataRecebimento) e "Referência da NF-e — candidatos a novos campos" (chaveAcesso, ufEmitente, anoMesEmissao, dataEmissao, valorTotal) — esses últimos são explicitamente informados na própria UI como "ainda não existem no modelo de recebimento do backend, são só candidatos."
- Cada campo tem um selo de confiança: **Alta confiança** / **Conferir** / **Baixa confiança** / **Não encontrado**.
- Todo campo é editável; se o usuário mudar o valor extraído, o selo vira "Corrigido manualmente".

**O que realmente é pré-preenchido no "Novo recebimento" vs. preenchido manual** — `buildReliableReceiptPrefill` só deixa passar campos com confiança **Alta**:
- `numeroNf`, `serieNf`, `cnpjFornecedor` — Alta sempre que a chave é válida (derivados matematicamente).
- `fornecedor` — Alta **só** se o CNPJ já estiver no catálogo local de fornecedores (`supplierCatalog.js`, `localStorage`, alimentado só quando um recebimento é confirmado manualmente antes). Se o CNPJ é inédito, fica "Não encontrado" — **não há OCR/NLP tentando ler o nome do fornecedor da imagem**.
- `pedido` — sempre confiança Baixa (regex fraca sobre texto de PDF, nunca disponível pra foto/scan puro) — **nunca é auto-preenchido**, sempre manual.
- `dataRecebimento` — sempre "Não encontrado" (sugestão de hoje, não extração real) — o default do próprio wizard é usado em vez disso.
- Os campos de "Referência" (chave, UF, ano/mês, data de emissão, valor total) **nunca** entram no prefill — são só pra conferência visual.

**Painel "3. Confirmar dados"**: o botão só monta um objeto de prefill e navega pra "Novo recebimento" — **nada é salvo no backend neste momento**. Existe um botão secundário "Ver JSON (depuração)" só visível em dev ou com a flag de debug — nunca em produção normal.

### 5.4 Mecanismo de handoff (`receiptHandoff.js`) e o bug real do StrictMode
Variável de módulo em memória (`let pending = null`), deliberadamente não `sessionStorage`/`localStorage`/URL (não deve sobreviver a F5, não deve vazar entre sessões, SPA não recarrega página mesmo assim). Comentário no cabeçalho do arquivo documenta um **bug real encontrado durante desenvolvimento, testando com Playwright**: a primeira versão tinha uma única função "pega e limpa" chamada direto no inicializador de `useState` — como o StrictMode chama o inicializador duas vezes, a primeira chamada consumia o valor real, a segunda via `null` (já limpo), e o React descartava o resultado da primeira — o formulário sempre abria vazio. Corrigido separando em `peekPendingReceiptPrefill()` (não-destrutiva, segura de chamar duas vezes) e `clearPendingReceiptPrefill()` (destrutiva, chamada uma vez via `useEffect`).

### 5.5 Estados de UI, por componente
- **NfeReaderPage**: idle (sem arquivo) → arquivo selecionado → analisando (spinner, botão bloqueado) → resultado mostrado (sucesso ou falha, nunca bloqueia) → confirmado (navega embora). Mais uma faixa de erro persistente pra falhas no nível de carregar o arquivo (distinto dos "warnings" dentro do painel de revisão).
- **NfeLiveScanner** (só alcançável via diagnóstico hoje): máquina de estados explícita `REQUESTING → SCANNING → CAPTURING → FOUND/ERROR/PAUSED`. Dicas de texto mudam em 3s/7s, ramificando por orientação (retrato: "tente girar o celular") ou disponibilidade de lanterna. Timeout de fast path (3s, só com BarcodeDetector nativo) entrega pro `NfePhotoCapture` em vez de continuar tentando.
- **NfePhotoCapture** (o caminho de câmera real em produção): `REQUESTING → PREVIEW → CAPTURING → FOUND/FAILED/ERROR`. `FAILED` oferece 3 recuperações: "Tirar outra foto" / "Selecionar arquivo" / "Preencher manualmente". Fallback automático (puro feature-detection, nunca user-agent): se a API `ImageCapture` não existe, ou existe mas `takePhoto()` lança em runtime, cai silenciosamente pro `<input capture="environment">` nativo.
- **NfeScannerBenchmark** (só com `?nfeScannerDebug=1`): Modo A (frame único, roda nativo→ZXing→ZBar→pipeline completo em sequência, compara vídeo vs. foto), Modo B (teste ao vivo de 10s por engine, mutuamente exclusivo).

### 5.6 Painel de diagnóstico — pra quem é e o que mostra
Gate: query string `?nfeScannerDebug=1`, **nunca** `import.meta.env.DEV` — motivo explícito no README: "o teste decisivo (NF real, celular físico) precisa acontecer no deploy HTTPS (Vercel), não só em desenvolvimento local." Custo zero pra usuário normal (lazy-loaded, ZBar só baixado via `import()` dinâmico quando realmente usado). **Nunca expõe a chave completa de 44 dígitos/CNPJ/pedido/valor** no texto de "Copiar diagnóstico" — verificado por teste dedicado (`benchmarkReport.test.mjs`). Serve só pra comparar os 3 engines de decodificação lado a lado com evidência real de celular físico — "só compara, não decide" (nunca trocou qual engine a produção usa).

### 5.7 Permissão de câmera e capability
`CAMERA_SUPPORTED`/`TOUCH_CAPABLE`/`CAN_TAKE_PHOTO`/`CAN_SCAN_BARCODE` computados **uma vez**, no carregamento do módulo, via feature detection pura (`navigator.mediaDevices?.getUserMedia`, `matchMedia('(pointer: coarse)')`, `navigator.maxTouchPoints`) — **nunca** user-agent, **nunca** largura de viewport (princípio de design repetido em vários comentários: um tablet em paisagem ainda tem câmera+touch independente da largura da janela).

Mapeamento de erro de câmera pra mensagem amigável (fonte única, reusada por todos os componentes de câmera):
- `NotAllowedError`/`PermissionDeniedError` → "Permissão da câmera negada. Libere o acesso... ou use 'Selecionar arquivo'."
- `NotFoundError`/`DevicesNotFoundError` → "Nenhuma câmera compatível foi encontrada neste dispositivo."
- `NotReadableError`/`TrackStartError` → "Não foi possível acessar a câmera — ela pode estar em uso por outro aplicativo."
- Contexto inseguro (não-HTTPS) → mensagem específica avisando que IP local em `http://` não dá acesso à câmera em celular (só `localhost` funciona em dev).

HTTPS é obrigatório pra câmera — testar em celular físico durante dev exige um túnel HTTPS (ngrok/localtunnel) ou testar direto contra um deploy de preview.

### 5.8 Campos reconhecidos, exatamente (confirmado em `chaveNFe.js` + `analysisBuilder.js`)
Tudo derivado por slice de substring da chave de 44 dígitos, layout fixo da NF-e: UF (posições 0-1), ano/mês (2-5), CNPJ (6-19), modelo (20-21), série (22-24), número (25-33), tipo de emissão (34), código numérico (35-42), DV (43). Validação: dígito verificador módulo 11 padrão (peso cíclico 2→9 da direita pra esquerda nos primeiros 43 dígitos).

**Confirmado: zero extração de item/quantidade/valor existe em qualquer lugar do módulo.** Não há parsing de XML, não há OCR de página inteira, não há tentativa de ler descrição de item, quantidade ou valor unitário. `textHeuristics.js` (29 linhas) só implementa três regex estreitas — data de emissão (perto da palavra "emissão"), valor total (perto de "valor total [da nota]"), pedido (perto de "pedido [de compra]") — e o próprio README diz explicitamente: *"OCR de página inteira/interpretação completa do documento está fora de escopo — o OCR aqui é estritamente um fallback de 44 dígitos, não um substituto para leitura de campos de texto livre."*

### 5.9 Formatos aceitos
`application/pdf`, `image/jpeg`, `image/png` no seletor de arquivo da tela de scanner (nota: os anexos em si, Seção 8, aceitam uma lista maior incluindo webp/gif/avif/heic/heif — são validações independentes, uma pro scanner, outra pros anexos do recebimento).

### 5.10 O que funcionou vs. o que falhou (medido, não suposição)
Fixtures sintéticas (10 PNGs CODE_128 gerados offline via `jsbarcode`+`node-canvas`, nunca commitados como dependência) com uma chave matematicamente válida mas fictícia, cada uma testando uma distorção: limpa / margem apertada / margem zero / rotação 90° / baixa resolução / baixo contraste / inclinação 2°/6°/10° / margem+inclinação combinadas.

- **Pré-deskew**: decodificava de forma confiável até ~2° de desvio, falhava a partir de 3°.
- **Pós-deskew**: a maioria de 3°-10° passou a ser recuperada, **mas `tilted-10deg.png` continua falhando** — limitação conhecida e documentada, não escondida.
- Benchmark de decoders: ZBar cru 10/10 (incluindo rotação/inclinação), ZXing cru sozinho 7/10, BarcodeDetector nativo "indisponível" no ambiente de teste headless (ressalvado explicitamente como limitação do ambiente de teste, não afirmação sobre Android Chrome real).
- Bug real de produção corrigido: `"Could not create a Canvas element."` vindo de dentro do ZXing quando `TRY_HARDER` estava ativo — causa raiz: `OneDReader.decode` da própria `@zxing/library` chama `image.rotateCounterClockwise()` internamente na primeira falha, que por sua vez chama `getTempCanvasElement()`. Corrigido removendo o hint inteiramente e reimplementando rotação manual via canvas DOM normal (`rotateCanvas`).

### 5.11 Limitações que permanecem (lista exaustiva, direto do README + comentários)
- Só um nível de limiar de contraste (`THRESHOLD_LEVEL = 160`), não uma varredura multi-nível — casos piores caem pro OCR por design.
- OCR tenta só 2 regiões, sem rotação — busca deliberadamente menor que a do ZXing.
- "Sem garantia de leitura em qualquer digitalização" — o objetivo é degradação graciosa (nunca travar, sempre permitir preenchimento manual), não vencer todo scan.
- OCR de página inteira / interpretação completa do documento está fora de escopo.
- O scanner ao vivo não roda OCR contínuo em frames de vídeo por design (Tesseract.js frame-a-frame seria pesado demais num celular).
- Deskew não recupera 100% de inclinações 3°-10° por design.
- `BarcodeDetector` nativo é Chromium-only; Safari/iOS sempre usam o caminho ZXing (mais lento, mas funcional).
- Nenhum recorte de região-de-interesse (ROI) do frame de vídeo foi implementado — marcado como possível melhoria futura, não feito.
- Zoom nunca é auto-ajustado mesmo quando suportado, por design (zoom agressivo poderia cortar o código).
- "Testado com dispositivo real de forma limitada durante o desenvolvimento" — validado principalmente via Chromium headless com `--use-fake-device-for-media-stream`, não substitui teste real em Android/iOS físico.
- O scanner ao vivo (câmera em tela cheia) está **escondido da produção hoje** (Seção 5.3) — considerado pouco confiável em teste físico real.

### 5.12 Scripts de validação (Playwright, não rodam no `npm test` padrão)
`validate-fixtures.mjs` (roda o pipeline real contra as 10 fixtures, só `tilted-10deg.png` espera falha), `validate-decoder-benchmark.mjs` (compara os 3 decoders + pipeline completo, não decide vencedor), `validate-photo-capture.mjs` (valida a UI guiada por capability — confirma que "Fotografar código" sempre aparece e "Escanear código de barras" nunca aparece, confirma fallback sem crash quando `ImageCapture` falha), `validate-receipt-handoff.mjs` (valida a integração "Confirmar dados"→"Novo recebimento" ponta a ponta, **confirma zero requisições `POST /recebimentos` disparam durante todo o fluxo** — ou seja, "Confirmar dados" nunca salva sozinho).

---

## 6. Portaria (controle de acesso/chegada)

**0% implementado — o termo não existe em nenhum lugar do código da aplicação, só em dois documentos de planejamento, e mesmo ali não descreve uma funcionalidade de portaria/controle de acesso.**

Busca em todo o repositório por "portaria" (e termos relacionados) retorna só duas ocorrências, idênticas: a frase **"Nota Fiscal com carimbo da Portaria Fiscal"**, em `promptV1.md:11` e `promptV2.md:11`. No contexto de logística brasileira, "Portaria" ali se refere à **guarita física de entrada do estabelecimento que carimba a nota fiscal recebida** como etapa de prova-de-entrada em papel do processo manual **que está sendo substituído** — é listada como um documento a ser escaneado/fotografado (junto com DACTE, pedido de compra), não como um módulo de sistema, tela, fluxo ou entidade de dados a ser construída.

**Nenhum código correspondente existe** em `src/` ou `backend/` — nenhuma rota, componente, endpoint de API, status, categoria de documento ou campo de dados relacionado a portaria. O mais próximo no catálogo real de tipos de documento (`DOCUMENT_TYPE_OPTIONS`) é simplesmente `'Nota Fiscal'` como categoria genérica de anexo — não existe um sub-campo distinto de "carimbo da portaria".

**Estado atual vs. ideia futura**: tudo relacionado a portaria como **módulo de sistema** (usuário da portaria, acesso restrito, scanner como função principal, identificação de chegada, consulta simples) é **[Ideia futura]** pura — nada foi sequer esboçado em código. Se um módulo de Portaria (ex.: check-in de motorista/caminhão no portão) for considerado, é um conceito genuinamente novo, sem rota, modelo de dados ou stub existente pra construir em cima.

---

## 7. Almoxarifado — todos os fluxos

Todos vivem dentro de `DetailPage` (Seção 4.4) e do wizard `NewReceiptPage` (Seção 4.3):

- **Receber** (criar o registro inicial): wizard de 4 passos em `NewReceiptPage`, termina em `store.createRecebimento` seguido opcionalmente de `transitionStatus`.
- **Editar**: `store.updateRecebimento` — usado hoje concretamente só pelo fluxo de "Adicionar Nota Fiscal" (atualizar número/série antes do upload). Não existe uma tela/formulário genérico de "editar recebimento" fora desse caso específico.
- **Conferir**: ação contextual "Iniciar conferência" (status CONFERENCIA) e "Finalizar recebimento" — ambas via `transitionStatus`.
- **Adicionar documento**: modal "Adicionar documento" em `DetailPage`, fluxo completo coberto na Seção 8.
- **Divergência**: modal de criação (`store.addDivergence`) e de resolução (`store.resolveDivergence`) — ambos funcionais. **Reabrir divergência resolvida não tem botão na UI** apesar de existir ponta a ponta no store/API/backend (gap confirmado, Seção 4.4).
- **Finalizar**: ação contextual "Finalizar recebimento", bloqueada por `validateStatusTransition` se faltar NF e arquivo obrigatórios (mensagem de erro crua do backend chega ao usuário: "A NF e seu arquivo são obrigatórios para finalizar.").
- **Pesquisar**: coberto em detalhe na Seção 9.
- **Consultar histórico**: painel "Histórico" em `DetailPage`, merge de `historicoStatus` (mudanças de status) + `historicoAlteracoes` (auditoria genérica), ordenado decrescente, capado em 10 entradas visíveis.

---

## 8. Anexos no frontend

### 8.1 Validação client-side (`src/features/attachments/constraints.js`, 36 linhas, lida por completo)
```js
MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024               // 4 MiB
RESUMABLE_UPLOAD_CHUNK_BYTES = 1024 * 1024           // 1 MiB
ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'image/gif', 'image/avif', 'image/heic', 'image/heif',
]
```
Comentário no topo: "Espelha os limites documentados em `docs/attachments-api.md` — o backend continua sendo a autoridade final; isto é só validação client-side para feedback imediato." `validateAttachmentFile(file)` lança erro tipado (`.code`) pra `FILE_NAME_REQUIRED`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE` — síncrono, antes de qualquer chamada de rede.

### 8.2 Fluxo completo, ponta a ponta
1. **Seleção** — zona de upload no modal "Adicionar documento". `accept` muda entre lista de imagem e lista completa dependendo da categoria; `multiple` só permitido pra "Foto"/"Outro"; `capture="environment"` setado pra "Foto". Todo arquivo passa por `validateAttachmentFile` no cliente; rejeitados viram um único toast agregado.
2. **Submissão** — se a categoria é "Nota Fiscal", primeiro `await` em `store.updateRecebimento` (número/série) **antes** de iniciar qualquer upload — serializado de propósito (comentário explícito: já causou confirmação de anexo presa por disputa na mesma linha da planilha).
3. **Upload por arquivo, sequencial**, cada um com status independente `pending → uploading → finalizing → success|error`.
4. **Dentro do store** (`uploadAttachment`): revalida client-side (defesa em profundidade) → `POST /anexos/upload-sessions` (pega `sessionUrl`) → **PUT direto pro Google Drive**, em fatias de 1 MiB, com `Content-Range` por fatia — **o binário do arquivo nunca passa pelo backend/Vercel Function** (decisão arquitetural permanente, documentada como nunca devendo ser revertida, por causa do teto de payload de 4,5 MB do Vercel Function) → `POST /anexos` de confirmação (só esse passo persiste a metadata no Sheets) → só depois do sucesso confirmado, o estado local muda ("sem sucesso otimista em nenhum ponto").
5. **"Finalizando..."** — confirmado exatamente: é a janela entre os bytes atingirem 100% enviados e o `POST /anexos` de confirmação ainda não ter retornado. Renderizado só no rótulo pequeno por-arquivo na lista — o botão principal do modal não distingue esse estado (mostra só "Enviando…"), uma limitação de granularidade conhecida, não um bug.
6. **Falha por arquivo** não aborta o lote inteiro — o arquivo fica com status erro, o loop continua pros demais; toast final avisa se nem todos foram anexados.

### 8.3 Download e remoção
- **Download**: link `<a target="_blank">` direto, **sem diálogo de confirmação**, ícone de olho.
- **Remoção**: ícone de lixeira abre `Modal` de confirmação com campo de motivo opcional — chama o backend primeiro, só some da UI se o backend confirmar (se der erro, o anexo continua visível).

### 8.4 Mensagens de erro (`errorMessages.js`, arquivo completo)
Mapa completo: `UNAUTHORIZED`→"Sessão expirada...", `FORBIDDEN`→"Você não tem permissão...", `ATTACHMENT_NOT_FOUND`/`FILE_NOT_FOUND`→"O arquivo não está mais disponível.", `ATTACHMENT_ALREADY_LINKED`→"Este arquivo já está vinculado...", `FILE_TOO_LARGE`→"O arquivo excede o limite de 4 MiB.", `UNSUPPORTED_FILE_TYPE`→"Este tipo de arquivo não é aceito.", `DRIVE_NOT_CONFIGURED`→"O armazenamento de documentos ainda não está disponível.", `UPLOAD_CANCELLED`→"Envio cancelado." — qualquer `DRIVE_*` não mapeado cai num genérico; qualquer outro código cai no `error.message` cru.

### 8.5 O bug de imports ausentes — confirmado corrigido
Commit `2f1e9b4` corrigiu um `ReferenceError` real em produção: `attachmentDownloadHref`, `friendlyAttachmentError`, `validateAttachmentFile`, `ALLOWED_ATTACHMENT_ACCEPT`, `ALLOWED_IMAGE_ACCEPT` eram usados em `App.jsx` sem import correspondente. Mensagem do commit documenta o bug com precisão: *"predates this change (present on origin/main) and only surfaced once a receipt had a real confirmed attachment to render."* Encontrado via passagem manual de ESLint `no-undef` (não commitada ao projeto). **Estado atual: confirmado corrigido** — os 3 imports corretos estão presentes em `App.jsx:76-78` hoje.

---

## 9. Pesquisa

**Hoje é inteiramente client-side**, apesar do backend suportar filtros via query string. Evidência: `hydrateRecebimentosFromApi()` busca **todas as páginas de todos os recebimentos pra memória** no carregamento do app, sem nenhum parâmetro de busca/status/fornecedor/pedido — toda a filtragem acontece depois, em memória, via `filterRecebimentos()`.

O backend **já suporta independentemente** `?q=`, `status`, `fornecedor`, `pedido`, `numeroNf`, `orderBy`, `order`, `page`, `pageSize`, `includeArchived` como query params — mas a UI de busca nunca envia nenhum deles. É uma divisão real e demonstrável entre a lógica de busca do cliente e do servidor, não redundância proposital.

**Campos pesquisados** pela caixa de texto única: `protocolo`, `pedido`, `numeroNf`, `fornecedor`, `cnpjFornecedor`, `tipo`, `status`, nome do responsável, `observacoes`, mais uma string achatada de todo item (`numero código descrição unidade`) e toda divergência (`tipo descrição`) — tudo concatenado num único "palheiro" de busca.

**Algoritmo de match**: a query é dividida por espaço em termos; **todos** os termos precisam aparecer como substring em algum lugar do palheiro (lógica E) — busca multi-palavra, mas sem sintaxe de campo-específico, sem OU/exclusão.

**Acento/maiúscula-insensível: sim**, via normalização (decomposição Unicode NFD + remove diacríticos + `toLocaleLowerCase('pt-BR')`) — "São Paulo" casa com "sao paulo" e vice-versa.

**Sem fuzzy matching** — substring pura, sem tolerância a erro de digitação/Levenshtein, sem stemming.

**Filtros de UI existentes**: busca livre, status (select exato), checkbox "NF pendente", painel expansível com: par de datas (`periodoInicio`/`periodoFim`), fornecedor (select derivado dinamicamente dos dados carregados, não de um catálogo real), tipo (select do catálogo fixo), responsável (select derivado dinamicamente). Alternância de direção de ordenação por `dataRecebimento` apenas — embora a camada de domínio suporte ordenar por `protocolo`/`pedido`/`numeroNf`/`fornecedor`/`tipo`/`responsavel`/`status`/`quantidade`, **nenhuma dessas tem controle de UI**.

**Conspicuamente ausente**: campo de busca dedicado pra `pedido` (só alcançável pela busca livre geral, embora a camada de domínio já suporte um filtro dedicado); filtro dedicado por item (número/código/descrição, suportado no domínio, sem controle de UI); presets de intervalo de data (últimos 7/30 dias); filtros salvos/nomeados; ordenação por coluna clicável na tabela; paginação server-side real (o frontend já anula isso pedindo `pageSize: 100` em todas as páginas e guardando tudo em memória); filtro booleano de "com divergência" na UI (suportado no domínio, sem controle).

**O que queremos no futuro** (visão do usuário, registrada aqui como **[Ideia futura]**, nenhuma parte implementada ainda): busca realmente server-side, filtros combináveis por data/empresa/fornecedor/status/material/NF/pedido expostos na UI, usando os parâmetros que o backend já aceita.

---

## 10. Dashboard

Componente `KpiStrip` — 4 indicadores em linha, **sem biblioteca de gráfico nenhuma no projeto** (confirmado: nenhum recharts/chart.js/d3/visx em `package.json`):
- "Total de recebimentos" — contagem total.
- "Materiais recebidos hoje" — com texto meta de quantos recebimentos hoje.
- "Documentações pendentes".
- "Divergências abertas".

O "gráfico" é um painel "Recebimentos por status" — barras horizontais calculadas manualmente (`width = (total/max) * 100%`, piso de 8% pra barras zeradas), `<div>`s estilizados, nada de SVG/canvas/lib.

**Cálculo 100% client-side**, sobre o que já estiver em `store.receipts` (a lista inteira, pré-carregada — ver Seção 9). A função real (`getDashboardMetrics`) também computa `porFornecedor`, `porTipo` e `evolucaoMensal` — **mas nenhum dos três é renderizado em lugar nenhum da `DashboardPage`** (dado morto no objeto retornado; o prompt original pedia exatamente "Recebimentos por fornecedor", "por tipo" e "Evolução mensal" como painéis — só a quebra por status chegou na UI real).

**Nenhum filtro se aplica ao dashboard** — sempre reflete o dataset inteiro carregado (não-arquivado por padrão); não existe seletor de período, filtro de fornecedor, nada escopado.

**Divergência confirmada backend/frontend**: o backend expõe independentemente `GET /dashboard`, retornando uma forma bem menor (`{ total, status, nfPendentes, divergencias }`) — e `api.dashboard()` existe no cliente mas **nunca é chamada em lugar nenhum**. O dashboard que o usuário realmente vê é inteiramente reconstruído client-side a partir da lista crua de recebimentos; o endpoint dedicado do backend é código morto do ponto de vista do frontend.

---

## 11. Notificações e feedback

**Toasts**: `pushToast(title, message, type='success')` definida uma vez dentro do `App()` raiz, passada como prop pra quem precisa (não existe dispatcher/contexto global de toast — é prop drilling simples de um lugar só). Auto-remove em **4400ms**; `ToastHost` também tem botão de fechar manual.

**Sistema de severidade é mínimo, não um enum completo**: `type` só é passado como `'success'` (padrão) ou `'error'` em todo o código (confirmado via grep de todas as chamadas) — `ToastHost` só distingue visualmente esses dois casos (ícone de alerta vs. check). Classes CSS são templadas como `toast-${type}`, então `warning`/`info` **poderiam** existir em CSS mas nunca são instanciadas via JS — sistema de 2 estados hoje, apesar do nome de classe sugerir mais.

**Faixas inline (`info-strip`)** são um mecanismo visualmente parecido mas estruturalmente separado — persistentes, não transientes, usadas em formulários pra avisos contextuais (ex.: alerta de quantidade divergente, "NF ainda não disponível", banner de documentação pendente).

**A mensagem de erro específica do backend chega ao usuário na maioria dos casos** (não é substituída por algo genérico) — porque `apiRequest()` já constrói o `Error` a partir do payload real do backend. A única exceção deliberada é a camada de anexos, que intercepta por `.code` e mostra mensagens curadas em português (Seção 8.4) — porque erros crus do Drive/armazenamento seriam técnicos/em inglês demais pro usuário final.

**Loading**: `<InitialLoadState>` é o único padrão consistente de carregamento/erro em nível de página (usado idêntico no Dashboard, Recebimentos, Pendências). Pra mutações em andamento não existe componente compartilhado — cada tela gerencia seu próprio booleano e troca o ícone do botão por um spinner.

**Progresso granular real**: só existe na fila de upload de anexos (Seção 8.2) — por-arquivo, com percentual.

**Confirmação**: ações destrutivas/importantes (remover anexo) passam por `Modal` com campo de motivo opcional, não por `confirm()` nativo nem undo inline.

**O que queremos padronizar no futuro** **[Ideia futura]**: um sistema de severidade completo SUCCESS/ERROR/WARNING/INFO/PROGRESS — hoje só SUCCESS/ERROR realmente existem.

---

## 12. UX

**Sidebar**: logo/marca (navega pra home), seção "Operação", itens de navegação (Visão geral, Recebimentos, Novo recebimento, Pendências com badge de contagem vermelho, Leitura automática (beta)). Rodapé: avatar+nome/perfil do usuário sempre-hardcoded, e um badge "Ambiente de validação" com tooltip avisando explicitamente que os dados só vivem nesta sessão de navegador e se perdem no refresh — uma admissão intencional, visível ao usuário, de que isto é uma build de MVP não-persistente.

**Atalhos de teclado**: exatamente um — `/` em qualquer lugar (exceto com foco já em input/textarea/select) foca a busca global; hint visual `<kbd>/</kbd>` ao lado do campo. `Modal` suporta Escape. Nenhum outro atalho (sem navegação tipo `g+d`, sem command palette `cmd+k`).

**Mobile é estruturalmente distinto, não só reflow** — componentes `MobileHeader`/`MobileNav`/`ReceiptMobileCard` sempre montados em paralelo aos equivalentes desktop, alternados via CSS, não uma árvore de componente única responsiva.

**Acessibilidade — geralmente boa, mas inconsistente**:
- Presente: `aria-label` na maioria dos botões só-ícone, `role="search"` na busca global, `role="dialog" aria-modal` no Modal, `role="status"/"alert"` nos estados de carga/erro, `aria-live="polite"` no host de toast, `aria-pressed` no toggle de tema, cards de pendência navegáveis por teclado (`role="button" tabIndex={0}` + Enter).
- **Faltando/inconsistente**: as linhas da tabela principal de desktop (`<tr onClick>`) são **só-mouse**, sem `role="button"`/`tabIndex`/handler de teclado — inconsistência direta com os cards mobile equivalentes (mesmo dado, mesma navegação), que são acessíveis por teclado. Sem skip-links. Sem lógica explícita de focus-trap dentro do Modal além da ordem de tab nativa.

**Tema claro/escuro**: toggle no topbar desktop (com label) e no header mobile (só ícone), persistido em `localStorage`, aplicado via atributo `data-theme` no `<html>`. Script inline no `index.html` evita flash do tema errado antes do React montar.

---

## 13. Modelo de dados que o frontend espera

Nomes de campo confirmados em `store.js` e cruzados contra `backend/app.mjs` (`receiptResponse`/`attachmentResponse` — o backend não renomeia campos pro formato de rede além de mapear anexos).

**Recebimento**:
```
id, protocolo (formato REC-<ano>-<seq de 4 dígitos>)
pedido, numeroNf, serieNf (null quando ausente, nunca '')
dataRecebimento ('YYYY-MM-DD')
fornecedor, cnpjFornecedor
tipo (Estoque | Débito Direto | Industrialização | Comodato | Outro)
responsavel: { id, nome, name, iniciais, perfil, role }
status (enum de 5 valores, ver abaixo)
observacoes
criadoEm, atualizadoEm (ISO datetime)
itens: [Item], anexos: [Anexo], divergencias: [Divergencia]
historicoStatus: [entrada], historicoAlteracoes: [entrada de auditoria]
arquivado (boolean — soft-delete), arquivadoEm, arquivadoPor, restauradoEm
```

**Item**: `{ id (IT-...), numero, codigo, descricao, quantidadeSolicitada, quantidadeRecebida, unidade }` (unidade: PÇ/UN/KG/M/L/CX/JG/RL).

**Anexo**: `{ id (ANX-...), nome, categoria, tipo (espelha categoria), mimeType, tamanho, dataInclusao, incluidoPor, url, removido, removidoEm, removidoPor, motivoRemocao }`. Categorias reais: Nota Fiscal (única com `requiredForClosing: true`), DACTE, Pedido, Foto, Certificado, Outro.

**Divergência**: `{ id (DIV-...), tipo, descricao, itemId (nullable — pode ser em nível de recebimento), criadaEm, criadaPor, resolvida, resolvidaEm, resolvidaPor, resolucao }`. Tipos: Quantidade incorreta, Material avariado, Material diferente, Falta de documentação, Problema de embalagem, Outro.

**Entrada de histórico de status**: `{ id, data, usuario, de, para, observacao }` (`de` é null na criação).
**Entrada de auditoria**: `{ id, data, usuario, acao, detalhes }` — texto livre.

**Usuário/ator**: `{ id, nome, name, iniciais, email, perfil, role }` — `nome`/`name` e `perfil`/`role` são duplicados pt/en consistentemente em todo o projeto.

**Status** (5 valores): Em digitação → Aguardando documentação → Em conferência → Divergência identificada → Conferido/Finalizado. Permissão por perfil: Administrador/Almoxarifado podem qualquer transição que o fluxo permita; Suprimentos só pra Conferência/Divergência; Consulta não pode nenhuma.

**Perfis**: Administrador, Almoxarifado, Suprimentos, Consulta.

**Nota importante**: `SUPPLIER_OPTIONS` é um array **vazio e congelado** no código — não existe catálogo real de fornecedores ainda; as opções mostradas na UI são sempre derivadas dinamicamente dos fornecedores já presentes nos recebimentos carregados, nunca de um catálogo mestre dedicado.

**Exemplo sanitizado** (valores ilustrativos, campos reais):
```json
{
  "id": "REC-2026-0012", "protocolo": "REC-2026-0012",
  "pedido": "4500873245", "numeroNf": "248913", "serieNf": "1",
  "dataRecebimento": "2026-10-02",
  "fornecedor": "Fornecedor Exemplo Ltda", "cnpjFornecedor": "12345678000199",
  "tipo": "Estoque",
  "responsavel": { "id": "USR-002", "nome": "Ana Ferreira", "perfil": "Almoxarifado" },
  "status": "Em conferência", "observacoes": "Entrega no portão 2.",
  "itens": [{ "id": "IT-abc", "numero": "10", "codigo": "MAT-000123", "descricao": "Parafuso M8", "quantidadeSolicitada": 100, "quantidadeRecebida": 98, "unidade": "UN" }],
  "anexos": [{ "id": "ANX-xyz", "nome": "nf-248913.pdf", "categoria": "Nota Fiscal", "mimeType": "application/pdf", "removido": false }],
  "divergencias": [], "arquivado": false
}
```

---

## 14. APIs consumidas pelo frontend

Todas as chamadas passam exclusivamente por `src/store.js` → `src/api.js` — **nenhum componente chama `api.*` diretamente**.

| Método | HTTP/rota | Quem chama |
|---|---|---|
| `me()` | `GET /auth/me` | **Ninguém** — definida, nunca chamada. |
| `listRecebimentos` | `GET /recebimentos?<params>` | Só `hydrateRecebimentosFromApi`, sempre `{includeArchived:true, pageSize:100}`, nunca com filtros de busca. |
| `getRecebimento` | `GET /recebimentos/:id` | `refreshReceiptFromApi`, após toda mutação. |
| `createRecebimento` | `POST /recebimentos` | `NewReceiptPage.save()`. |
| `updateRecebimento` | `PATCH /recebimentos/:id` | `DetailPage.saveDocument()` (NF antes do upload). |
| `addItem`/`updateItem`/`removeItem` | `POST/PATCH/DELETE /recebimentos/:id/itens[/:itemId]` | Existem no store, **sem chamador de UI** após a criação inicial. |
| `addDivergence` | `POST /recebimentos/:id/divergencias` | `DetailPage.saveDivergence()`. |
| `resolveDivergence` | `POST .../divergencias/:id/resolver` | `DetailPage.saveResolution()`. |
| `reopenDivergence` | `POST .../divergencias/:id/reabrir` | Existe ponta a ponta, **sem chamador de UI** (gap, ver Seção 4.4). |
| `transitionStatus` | `POST /recebimentos/:id/status` | `DetailPage.tryTransition()`, `NewReceiptPage.save(true)`. |
| `archive`/`restore` | `POST .../arquivar` / `.../restaurar` | Existem, **sem chamador de UI** (nenhum botão de arquivar em lugar nenhum). |
| `uploadAttachment` (legado base64) | `POST /recebimentos/:id/anexos` (com `dataBase64`) | Mantido só por compatibilidade, **não usado pelo fluxo atual**. |
| `createAttachmentUploadSession` | `POST .../anexos/upload-sessions` | Entrada real do upload. |
| PUT resumível | `PUT <sessionUrl>` (fora de `api.js`, direto pro Drive) | `resumableUpload.js`. |
| `confirmAttachment` | `POST /recebimentos/:id/anexos` (com `fileId`) | Logo após o PUT completar. |
| `removeAttachment` | `DELETE .../anexos/:id` | `DetailPage.confirmRemoveAttachment()`. |
| `dashboard()` | `GET /dashboard` | **Ninguém** — frontend computa seu próprio dashboard (Seção 10). |

---

## 15. Bugs importantes

- **`attachmentDownloadHref` e outros 4 imports ausentes** (`App.jsx`) — `ReferenceError` real em produção, só disparava quando havia pelo menos 1 anexo confirmado pra renderizar. Corrigido no commit `2f1e9b4`. **Confirmado corrigido hoje.**
- **"Finalizando..."** — não é bug, é um estado real e intencional cobrindo a janela entre bytes 100% enviados e confirmação do backend (Seção 8.2).
- **Salvamento de NF antes do upload** — race condition real onde duas escritas quase simultâneas na mesma linha da planilha deixavam a confirmação do anexo presa; corrigido serializando (`await` da atualização de NF antes de iniciar o upload).
- **Sheets 429 percebido pelo frontend** — investigado e parcialmente corrigido no backend (`batchGet`, caminhos de escrita dedicados pra anexo) — documentado em `docs/HANDOFF-GORAN-ATTACHMENTS-DEBUG.md`.
- **Roteamento aninhado da Vercel** — catch-all dinâmico (`api/v1/[...path].mjs`) só casava 1 segmento de path; rotas como `/recebimentos/:id` voltavam 404 da própria Vercel antes de chegar no backend. Corrigido com rewrite explícito em `vercel.json` + Function de caminho estático — coberto em detalhe em `docs/HANDOFF-GORAN-VERCEL-ROUTING-PRODUCTION.md`.
- **Bug do React StrictMode em `receiptHandoff.js`** — dupla invocação do inicializador de `useState` consumindo o valor do handoff na primeira chamada, formulário sempre abria vazio. Encontrado testando com Playwright, corrigido separando leitura não-destrutiva de limpeza destrutiva.
- **Bug real do ZXing** (`"Could not create a Canvas element."`) — causado por `TRY_HARDER` acionando rotação interna da própria biblioteca; corrigido removendo o hint e reimplementando rotação manual.
- **Filtro "NF pendente" escondendo tudo por padrão** — corrigido no commit `91d61b6`.
- **Loading/erro/vazio indistinguíveis** — as 3 situações renderizavam a mesma UI de "nenhum recebimento"; corrigido com o padrão `<InitialLoadState>` de 3 estados (commit `8e64135`).

---

## 16. Commits importantes

(Lista completa com hash, autor, descrição e arquivos já está na Seção 2 — Git log completo disponível via `git log --oneline --format="%h %an %s"`. Destaques fora da Seção 2, puramente cronológicos, do mais antigo pro mais recente relevante ao frontend/scanner):

1. `2381a69` Lucas — introdução original do scanner (câmera + leitura ao vivo).
2. `6d113d0` Lucas — gate de câmera por capability, não viewport (princípio de design que persiste em todo o módulo).
3. `9711597` Lucas — investigação de robustez do scanner (deskew, recortes) com 10 fixtures sintéticas novas.
4. `23a2a7d` Lucas — benchmark de decoders (ZBar vs ZXing vs nativo), subsistema `decoders/` completo.
5. `4374c49` Lucas — fallback de foto de alta qualidade (`NfePhotoCapture.jsx` nasce aqui), ZBar promovido pra produção.
6. `0337822` Lucas — handoff "Confirmar dados" → "Novo recebimento".
7. `81d03e1` Lucas — esconder scanner ao vivo da UI de produção (decisão de confiabilidade, não removida do código).
8. `f43318e` Lucas — grande refatoração extraindo componentes de `App.jsx` monolítico.
9. `89cc8a5` Lucas — integração do upload resumível de anexos na UI.
10. `2f1e9b4` Lucas — fix de imports ausentes + CORS + quota do Sheets.
11. `8e64135` Lucas — fix de loading/erro/vazio indistinguíveis.
12. `c7bffda` Lucas — fix de roteamento aninhado da Vercel.
13. `cedcb3f` Gorann0 — fix de confiabilidade de upload de anexo (backend).
14. `780062a` Gorann0 — nomeação de arquivo no Drive por protocolo+sequência, fix do bug de tela em branco (`loadState` sempre truthy).

---

## 17. O que está pronto

- Criar recebimento (wizard de 4 passos), com rascunho ou envio direto.
- Consultar/filtrar lista de recebimentos (client-side).
- Ver detalhe completo, histórico, itens.
- Anexar documento/foto via upload resumível direto pro Google Drive, com progresso granular.
- Baixar e remover anexo (com confirmação).
- Registrar e resolver divergência.
- Transicionar status conforme fluxo definido, com gating por perfil.
- Exportar lista pra CSV/Excel.
- Dashboard com 4 KPIs + quebra por status.
- Tema claro/escuro persistente.
- Layout mobile estruturalmente dedicado (não só CSS reflow).
- Scanner de NF-e: upload de PDF/foto → extração de chave de 44 dígitos com alta confiabilidade medida, prefill parcial e seguro (só campos de alta confiança) pro wizard de novo recebimento.
- Badge de pendências na sidebar/nav mobile.

## 18. O que está parcial

- **Scanner ao vivo (câmera em tela cheia)**: código completo e testado, mas escondido da produção por falta de confiabilidade em teste físico real — só "Fotografar código" (captura estática) está em produção.
- **Reabrir divergência**: implementado ponta a ponta (store/API/backend), sem botão de UI.
- **Arquivar/restaurar recebimento**: implementado ponta a ponta, sem botão de UI.
- **Adicionar/editar/remover item após criação**: implementado no store/API/backend, sem UI em `DetailPage`.
- **Dashboard por fornecedor/tipo/evolução mensal**: calculado no código, nunca renderizado.
- **Pesquisa por pedido/item dedicada**: suportada no domínio, sem campo de UI específico (só via busca livre geral).
- **Ordenação por coluna**: suportada no domínio (8 campos), só 1 exposto na UI (data).

## 19. O que ainda não existe

- **Supabase** (ou qualquer banco SQL) — zero referência em código hoje.
- **Autenticação real** — `api.me()` nunca chamada, usuário sempre hardcoded, sem tela de login, sem troca de perfil pela UI.
- **Login por matrícula + PIN** — conceito não implementado.
- **RBAC completo na UI** — permissão hoje só é reforçada no backend/store (`requireWritePermission`, `ROLE_STATUS_PERMISSIONS`); a UI não esconde ações pra perfis sem permissão, só falha ao tentar executar.
- **Soft delete global** — hoje só recebimento tem `arquivado` (soft-delete), e mesmo esse não tem botão de UI; anexo tem `removido` (soft-delete real, funcional); não existe um padrão único de soft-delete em toda a aplicação.
- **Trilha de auditoria completa** — existe `historicoAlteracoes` (texto livre, por recebimento), mas não é uma auditoria estruturada/pesquisável/exportável.
- **Pesquisa avançada** (server-side, filtros combináveis expostos na UI) — coberto em detalhe na Seção 9.
- **Portaria separada** (módulo de controle de acesso/chegada) — 0% implementado, coberto na Seção 6.
- **Filtros personalizados/salvos**.
- **Central de notificações** (sistema completo SUCCESS/ERROR/WARNING/INFO/PROGRESS) — hoje só 2 dos 5 estados existem de fato.
- **Tela de Usuários e tela de Configurações** — backend pronto pra Usuários, zero UI pra nenhuma das duas.

## 20. Visão futura

Registrado aqui como **[Ideia futura]** / **[Decisão de produto]** conforme indicado — esta é a visão articulada pelo usuário nesta conversa, a ser usada como ponto de partida pela próxima sessão que vai desenhar a arquitetura com Supabase:

- **Supabase como banco principal** — substituindo o Google Sheets como sistema de registro primário.
- **Google Sheets mantido como espelho/exportação** — não descartado, rebaixado a formato de exportação/leitura.
- **Google Drive para arquivos** — mantido como está hoje (anexos).
- **Login por matrícula + PIN** — autenticação real, substituindo o usuário hardcoded atual.
- **Separação Portaria / Almoxarifado** — dois módulos/perfis de acesso distintos, Portaria com o scanner como função principal, identificação de chegada, consulta simples.
- **Permissões por perfil e por ação** — mais granular que o atual (que só gate por status/write a nível de recebimento).
- **Exclusão somente por superiores** — já é uma diretriz desde o prompt original (seção 6: "Não permitir exclusão definitiva de informações importantes sem autorização administrativa"); a visão futura é reforçar isso de forma mais estrita/explícita no novo backend.
- **Soft delete em tudo**, não só em anexo.
- **Auditoria completa** de tudo, não só recebimento.
- **Pesquisa avançada** server-side, usando os parâmetros que o backend hoje já aceita mas a UI não expõe.
- **Filtros salvos**.
- **Google Sheets exportado com formatação** (não cru).
- **Notificações padronizadas** (SUCCESS/ERROR/WARNING/INFO/PROGRESS).

**Nuance já registrada nesta conversa, relevante pra quem for desenhar a arquitetura**: já existe um documento interno no repositório, `ARQUITETURA_TECNICA_ALM.md` (3254 linhas, datado de 01/09/2026), que abre com uma **"decisão arquitetural fixa"**: PostgreSQL para dados estruturados + Google Shared Drive institucional para arquivos + monolito modular + OIDC/RBAC + serviço de auditoria + jobs de reconciliação. Isso é mais específico (e diverge em alguns detalhes — Shared Drive institucional em vez de Drive pessoal, Postgres "puro" em vez de necessariamente via Supabase) do que a visão registrada aqui. Vale reconciliar os dois antes de prosseguir — não é um conflito necessariamente real, mas os dois documentos não se referenciam um ao outro hoje.

---

## 21. Tudo que está só no contexto das conversas (não óbvio pelo código)

- A decisão de esconder o scanner ao vivo da produção (`81d81e1`) foi tomada depois de **teste físico real em iPhone/Safari e Android/Chrome**, não só análise de código — **[confirmado em código]** (comentário + commit), mas o racional completo de "por que pouco confiável" vem de teste manual não documentado em detalhe além do comentário.
- A ordem ZBar-antes-de-ZXing no fast path veio de um **benchmark medido** com fixtures sintéticas (10/10 vs 7/10), não de intuição — **[Teste]**, documentado no README e nos scripts `validate-*.mjs`.
- O bug do React StrictMode em `receiptHandoff.js` e o bug do ZXing (`TRY_HARDER`) foram ambos **encontrados testando com Playwright / lendo o código-fonte da própria dependência**, não suposição — **[confirmado em comentário de código]**, framing explícito de "bug real, não hipótese" nos dois casos.
- A reclassificação de "leitura automática de NF" de prioridade MVP (v1) pra Fase 2 (v2) foi uma **decisão de produto consciente**, registrada na comparação entre `promptV1.md` e `promptV2.md` — **[Decisão de produto]**, não always-foi-assim.
- O fato de que `ARQUITETURA_TECNICA_ALM.md` já existe com uma decisão de Postgres "fixa" diferente em detalhes da visão de Supabase registrada aqui é uma **observação feita nesta própria conversa** (comparando o relatório da turma contra o código), não algo documentado em lugar nenhum antes — **[Hipótese de reconciliação necessária]**, ainda não resolvida/decidida.
- A atribuição de autoria (Lucas vs. Gorann0 vs. outros) usada na Seção 2 vem inteiramente de `git log`, não de memória de conversa — **[Git]**, altamente confiável, mas pode mudar se novos commits forem feitos depois deste documento ser gerado (ver aviso de "não presumir HEAD" no handoff de Vercel/routing, mesmo princípio se aplica aqui).

---

## Fontes consultadas

**Arquivos lidos por completo ou em profundidade**: `src/App.jsx`, `src/store.js`, `src/api.js`, `src/data.js`, `src/theme.jsx`, `src/ui.jsx`, `src/layout/navigation.js`, `src/layout/Sidebar.jsx`, `src/layout/MobileHeader.jsx`, `src/layout/MobileNav.jsx`, `src/components/dashboard/KpiStrip.jsx`, `src/components/recebimentos/ReceiptsTable.jsx`, `src/components/shared/FilterBar.jsx`, `src/features/nfeReader/{README.md, NfeReaderPage.jsx, NfeLiveScanner.jsx, NfePhotoCapture.jsx, NfeScannerBenchmark.jsx, extractor.js, analysisBuilder.js, chaveNFe.js, textHeuristics.js, receiptHandoff.js, cameraCapabilities.js, photoCapture.js, barcodeReader.js, zbarReader.js, testFixtures/README.md}`, `src/features/attachments/{constraints.js, errorMessages.js, resumableUpload.js, resumableUpload.test.mjs}`, `docs/attachments-api.md`, `docs/HANDOFF-GORAN-ATTACHMENTS-DEBUG.md`, `docs/HANDOFF-GORAN-VERCEL-ROUTING-PRODUCTION.md`, `ARQUITETURA_TECNICA_ALM.md` (trecho de abertura), `promptV1.md`, `promptV2.md`, `vite.config.js`, `package.json`.

**Commits consultados**: todo o `git log --oneline --format="%h %an %s"` (36 commits) mais `git show --stat` em todos os commits relevantes ao frontend/scanner/anexos (lista completa na Seção 2 e Seção 16).
