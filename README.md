# ALM - Recebimento de Materiais

MVP responsivo para registrar, acompanhar e consultar recebimentos de materiais do Almoxarifado. A aplicacao substitui o controle espalhado entre planilha, e-mail, grupo de WhatsApp, documentos digitalizados e pastas de rede por uma interface unica para cadastro, consulta, anexos, divergencias e historico.

Este projeto foi criado a partir do levantamento do Projeto ALM e da versao 2 do prompt funcional.

## Status Atual

O MVP esta pronto para validacao funcional em navegador. Ele roda localmente, sem servidor corporativo, banco de dados externo ou login real.

Ja inclui:

- Dashboard com indicadores do periodo, status, pendencias e divergencias.
- Consulta de recebimentos em formato parecido com a planilha atual.
- Pesquisa por palavra-chave, filtros, ordenacao, paginacao e exportacao CSV compativel com Excel.
- Cadastro guiado em quatro etapas.
- Multiplos itens por recebimento/pedido.
- Upload demonstrativo de fotos e documentos.
- NF/documento com obrigatoriedade condicional: pode ficar pendente na criacao, mas e exigida para finalizacao.
- Controle de status: Em digitacao, Aguardando documentacao, Em conferencia, Divergencia identificada e Conferido/Finalizado.
- Tela de detalhes com dados gerais, itens, anexos, fotos, divergencias, historico e acoes.
- Tela de pendencias operacionais.
- Persistencia local no navegador usando `localStorage`.

Fora do MVP:

- Login corporativo real.
- API/backend.
- Banco de dados corporativo.
- Armazenamento definitivo de arquivos.
- Integracao com ERP.
- OCR/leitura automatica de Nota Fiscal.
- Auditoria imutavel em servidor.

## Como Instalar

Pre-requisito:

- Node.js 18 ou superior.
- Git, caso o projeto seja compartilhado via repositorio.

No Windows PowerShell, dentro da pasta do projeto:

```powershell
npm.cmd install
npm.cmd run dev
```

Em Git Bash, CMD, Linux ou macOS:

```bash
npm install
npm run dev
```

Depois de iniciar, abra o endereco informado no terminal. Normalmente sera algo como:

```text
http://localhost:5173/
```

Se a porta estiver ocupada, o Vite pode usar outra porta. Use sempre a URL que aparecer no terminal.

`npm install` também roda automaticamente (`postinstall`) `scripts/copy-pdfjs-assets.mjs`, que copia os recursos do `pdfjs-dist` (wasm de JBIG2/OpenJPEG, cmaps, fontes padrão e perfis ICC) para `public/pdfjs/`. Esses arquivos são necessários para o módulo `Leitura automática (beta)` conseguir abrir PDFs digitalizados corretamente — se `public/pdfjs/` sumir por algum motivo, rode `node scripts/copy-pdfjs-assets.mjs` de novo.

## Backend/API (implantação iniciada)

A pasta `backend/` contém a primeira implementação do servidor real do MVP. Ela usa Node.js nativo para reduzir dependências e uma persistência JSON local como adaptador de desenvolvimento. A API foi desenhada para que esse adaptador possa ser trocado por PostgreSQL sem alterar o contrato HTTP.

Endpoints principais:

- `GET/POST /api/v1/recebimentos`
- `GET/PATCH /api/v1/recebimentos/:id`
- `GET/POST/PATCH/DELETE /api/v1/recebimentos/:id/itens`
- `GET/POST/DELETE /api/v1/recebimentos/:id/anexos`
- `GET/POST /api/v1/recebimentos/:id/divergencias`
- `POST /api/v1/recebimentos/:id/divergencias/:divergenciaId/resolver`
- `POST /api/v1/recebimentos/:id/divergencias/:divergenciaId/reabrir`
- `POST /api/v1/recebimentos/:id/status`
- `GET /api/v1/recebimentos/:id/historico/status`
- `GET /api/v1/recebimentos/:id/historico/auditoria`
- `GET/POST/PATCH /api/v1/usuarios`
- `GET /api/v1/auth/me`
- `GET /api/v1/catalogos`
- `GET /api/v1/dashboard`

No ambiente de desenvolvimento, a identidade é simulada pelo header `X-User-Id` (`USR-001` a `USR-004`). Isso **não substitui login corporativo**; é apenas o mecanismo temporário para exercitar as permissões reais no servidor.

Para executar:

```bash
npm run api
```

Em outro terminal:

```bash
npm run dev
```

A aplicação React usa `src/api.js` e o `store.js` agora opera em modo API-first. O `localStorage` permanece apenas como cache/offline durante a transição. Quando a API está disponível, o estado inicial é carregado do servidor e as mutações são sincronizadas em fila por recebimento.

Arquivos enviados são gravados em `backend/uploads/` e seus metadados ficam associados ao recebimento. Para produção, essa camada deve ser substituída por storage corporativo/objeto e PostgreSQL.

## Como Gerar a Versao de Producao

Para compilar:

```bash
npm run build
```

Para testar a versao compilada:

```bash
npm run preview
```

A pasta gerada sera:

```text
dist/
```

Essa pasta contem os arquivos estaticos finais, mas ainda nao resolve backend, login, banco ou arquivos corporativos.

## Como Usar a Aplicacao

1. Acesse o dashboard para ver os indicadores principais.
2. Entre em `Recebimentos` para consultar a lista geral.
3. Use a busca e os filtros para localizar por pedido, NF, fornecedor, item, responsavel, tipo, status ou periodo.
4. Clique em uma linha para abrir os detalhes do recebimento.
5. Use `Novo recebimento` para cadastrar um novo processo.
6. Preencha dados gerais, itens, fotos/documentos e revise antes de salvar.
7. Caso a NF ainda nao tenha chegado, deixe como pendente.
8. Quando tudo estiver correto, mova o status ate `Conferido/Finalizado`.
9. Em caso de problema, registre uma divergencia no detalhe do recebimento.
10. Use `Exportar` para gerar arquivo CSV que abre no Excel.

## Fluxo de Trabalho Representado

O processo desenhado no MVP segue esta logica:

```text
Criar recebimento
-> informar pedido, fornecedor, tipo e data
-> adicionar itens recebidos
-> anexar fotos e documentos
-> registrar observacoes/divergencias
-> acompanhar pendencias
-> conferir
-> finalizar
```

Fluxo de status:

```text
Em digitacao
-> Aguardando documentacao
-> Em conferencia
-> Divergencia identificada
-> Conferido/Finalizado
```

A NF/documento pode ficar pendente no primeiro cadastro, porque no processo real ela nem sempre chega no mesmo momento do material.

## Estrutura dos Arquivos

Arquivos principais:

- `src/App.jsx`: telas, navegacao, formularios e interacoes da aplicacao.
- `src/data.js`: dados de exemplo, listas controladas, status, filtros, metricas e regras auxiliares.
- `src/store.js`: estado da aplicacao, persistencia local, criacao/alteracao de recebimentos e historico.
- `src/ui.jsx`: componentes visuais reutilizaveis.
- `src/styles.css`: estilos responsivos da interface.
- `src/features/nfeReader/`: modulo experimental de leitura automatica de NF-e (beta), isolado do fluxo principal — veja a secao dedicada acima.
- `src/main.jsx`: ponto de entrada React.
- `package.json`: scripts e dependencias.
- `README.md`: este guia.

Pastas geradas:

- `node_modules/`: dependencias instaladas. Nao deve ser editada manualmente.
- `dist/`: versao compilada gerada por `npm run build`.

## Divisao Sugerida Para o Time

Lucas:

- Coordenar o escopo funcional e validar se o fluxo bate com o processo real do Almoxarifado.
- Testar cadastro, consulta, filtros, exportacao e telas em computador/celular.
- Priorizar o que entra no MVP e o que fica para fase 2.
- Consolidar feedback dos usuarios.

Marcelo:

- Trabalhar na parte de backend/API.
- Desenhar endpoints para recebimentos, itens, anexos, divergencias, historico e usuarios.
- Substituir o `localStorage` por chamadas reais para servidor.
- Preparar validacoes de negocio no backend.

Goran Henrique:

- Cuidar do banco de dados e modelagem.
- Criar tabelas para recebimentos, itens, anexos, divergencias, usuarios, status e auditoria.
- Pensar em indices para busca por pedido, NF, fornecedor, item, status e periodo.
- Planejar migracao dos registros historicos da pasta de rede.

Kobner:

- Focar em seguranca, arquivos e infraestrutura.
- Definir autenticacao, perfis de acesso e permissoes.
- Planejar armazenamento seguro dos anexos, backup e politica de exclusao.
- Preparar ambiente de homologacao/publicacao interna.

Essa divisao pode mudar conforme a experiencia de cada um, mas separa bem produto, backend, dados e infraestrutura.

## Modelo de Dados Inicial

Entidades principais para a proxima fase:

- `usuarios`: nome, e-mail, perfil, status.
- `recebimentos`: pedido, NF/documento, fornecedor, tipo, data, responsavel, status, observacoes.
- `recebimento_itens`: recebimento, item, descricao, quantidade, unidade, quantidade solicitada, quantidade recebida.
- `anexos`: recebimento, tipo, nome, caminho/URL, tamanho, usuario, data.
- `divergencias`: recebimento, tipo, descricao, status, responsavel, data, resolucao.
- `historico_status`: recebimento, status anterior, novo status, usuario, data, comentario.
- `auditoria`: entidade, acao, usuario, data, antes/depois.

## Regras Importantes

- Todo recebimento deve ter responsavel. No MVP ele e preenchido automaticamente pelo usuario demonstrativo.
- Unidade e tipo de recebimento devem vir de listas controladas.
- NF/documento nao bloqueia a criacao, mas bloqueia a finalizacao.
- Recebimento com divergencia aberta nao deve ser finalizado sem tratamento.
- Remocao definitiva de informacoes importantes deve exigir permissao administrativa na versao corporativa.
- Toda mudanca relevante deve gerar historico.

## Proximas Fases

Fase 1 - Validacao do MVP:

- Rodar com dados simulados.
- Apresentar para Almoxarifado e Suprimentos.
- Ajustar campos, nomes, filtros e status.
- Validar se o fluxo no celular resolve o uso atual do WhatsApp.

Fase 2 - Backend e Banco:

- Criar API.
- Criar banco de dados.
- Migrar estado local para persistencia real.
- Implementar usuarios e permissoes.
- Implementar upload real de arquivos.

Fase 3 - Homologacao:

- Testar com usuarios reais.
- Importar parte do historico da pasta de rede.
- Validar performance, seguranca, backup e restauracao.
- Ajustar relatorios e dashboard.

Fase 4 - Evolucoes:

- Integracao com ERP para consulta de pedidos.
- OCR de Nota Fiscal.
- Notificacoes automaticas.
- Protocolos de recebimento em PDF.
- Melhorias em auditoria e trilhas de aprovacao.

## Comandos Uteis

Instalar dependencias:

```bash
npm install
```

Rodar localmente:

```bash
npm run dev
```

Compilar:

```bash
npm run build
```

Visualizar compilado:

```bash
npm run preview
```

No PowerShell, se o comando `npm` for bloqueado por politica de execucao, use:

```powershell
npm.cmd run dev
```

## Observacoes Para Compartilhar

Este projeto ainda e uma prova funcional. Ele serve para demonstrar o fluxo, validar a experiencia e orientar a construcao da versao corporativa. Para uso real, os pontos mais importantes sao backend, banco, login, armazenamento seguro de anexos e auditoria em servidor.


## Leitura automática de NF-e (beta) — módulo experimental

Tela isolada em `Leitura automática (beta)` no menu lateral (`src/features/nfeReader/`), separada do fluxo de `Novo recebimento`. Objetivo: validar se dá para extrair dados de Notas Fiscais reais da empresa antes de mexer no cadastro que já está em uso. Ninguém é obrigado a usar — quem continuar cadastrando manualmente não é afetado.

Documentação técnica completa do pipeline (diagrama, o que cada arquivo faz, algoritmo da chave, por que o ZXing roda sem `TRY_HARDER`, assets self-hosted, limitações conhecidas): [`src/features/nfeReader/README.md`](src/features/nfeReader/README.md).

O que ela faz, 100% no navegador, em ordem de custo (cada etapa só entra em cena se a anterior não achou uma chave válida):

1. Upload de um PDF (DANFE) ou foto (JPG/PNG) da NF, com um botão explícito **Analisar nota** — nada roda automaticamente ao selecionar o arquivo.
2. Se for PDF, tenta extrair o texto embutido (`pdfjs-dist`). Se achar uma chave de 44 dígitos válida (dígito verificador módulo 11 — `src/features/nfeReader/chaveNFe.js`, função `findValidNfeKeys`, tolerante a espaço/ponto/hífen/quebra de linha entre os dígitos), usa ela direto e **para por aqui** — não renderiza página nem aciona leitor de código de barras/OCR.
3. Sem chave no texto → renderiza a 1ª página em ~300 DPI (ou usa a foto direto) e tenta ler um código de barras CODE_128 com `@zxing/browser`/`@zxing/library`, testando vários recortes da página (topo 25%/35%, topo direito/esquerdo, metade superior, página inteira), cada um em versão original e com contraste ajustado, nas 4 rotações — tudo com canvases DOM próprios, sem depender da rotação automática interna do ZXing.
4. Código de barras também não achou → tenta OCR com `tesseract.js` sobre a mesma imagem, restrito a dígitos, como último recurso para digitalizações ruins.
5. Se texto e código de barras encontrarem a mesma chave (caso raro, já que o texto quando encontrado pula o código de barras), marca confiança mais alta indicando as duas origens.
6. Interpreta a chave (UF, ano/mês, CNPJ, série, número da NF) e cruza o CNPJ com um catálogo local de fornecedores (`localStorage`, isolado neste módulo — o resto do app continua volátil).
7. Heurísticas fracas por regex (`textHeuristics.js`) tentam achar data de emissão, valor total e pedido de compra no texto — sempre com confiança "conferir" ou "baixa", nunca "alta".
8. Tela de revisão com todos os campos editáveis e selo de confiança (alta / conferir / baixa / não encontrado). Editar um campo mostra um indicador "corrigido manualmente".
9. **Confirmar dados** gera o JSON final no formato do modelo de recebimento (`numeroNf`, `serieNf`, `cnpjFornecedor`, `fornecedor`, `pedido`, `dataRecebimento`) mais um objeto `referenciaNfe` separado (`chaveAcesso`, `ufEmitente`, `anoMesEmissao`, `dataEmissao`, `valorTotal`) — candidatos a campo novo, **não gravados** no backend. Um botão copia o JSON.

Quando nem texto, nem código de barras, nem OCR conseguirem localizar uma chave válida (digitalização realmente ruim), o pipeline degrada para "não encontrado" em vez de travar; todo o log de cada tentativa (`[NFe] ...`) fica no console do navegador, e o usuário sempre pode preencher manualmente.

**Sobre o OCR (`tesseract.js`):** o worker e o núcleo WASM ficam self-hosted em `public/tesseract/` (copiados de `node_modules` no `npm install`, sem CDN — mesmo esquema usado para os recursos do `pdf.js` em `public/pdfjs/`). O dado de idioma treinado (`eng.traineddata.gz`, algumas dezenas de MB) é a única peça que continua vindo do CDN oficial do tesseract.js na primeira vez que o OCR roda em cada navegador — é o padrão recomendado pela própria lib, já que auto-hospedar um pacote de idioma inteiro só para reconhecer dígitos não compensa. Depois da primeira vez, o navegador guarda esse arquivo em cache (IndexedDB) e não baixa de novo. Por isso o fallback de OCR **precisa de internet na primeira execução por navegador**; as outras etapas (texto do PDF, código de barras) continuam 100% offline. O núcleo do tesseract.js também deixa `dist/`/`public/` bem mais pesado (~44 MB) — isolado nesta tela via `React.lazy`, então só é baixado por quem realmente abrir "Leitura automática (beta)".

Fora de escopo, de propósito, nesta fase:

- OCR de página inteira / interpretação completa do documento (Document AI e afins) — o OCR aqui é só um fallback estreito para a chave de 44 dígitos, restrito a dígitos e a duas regiões da página.
- Integração com Google Sheets/Drive.
- Alteração no `backend/server.mjs` ou no modelo de dados do recebimento — os campos de `referenciaNfe` são só sugestão.
- Gravação automática em um recebimento (`api.createRecebimento` não é chamado por este módulo).
- Garantir leitura de código de barras/OCR em digitalizações ruins — a meta é degradar bem, não vencer qualquer digitalização.

Conexão futura (não feita agora): a lógica de `src/features/nfeReader/extractor.js` foi isolada exatamente para que, quando o app estiver pronto para usar isso de verdade, a Etapa 3 (Evidências) do wizard `Novo recebimento` possa chamar `analyzeNfeFile()` ao anexar a Nota Fiscal e pré-preencher `numeroNf`/`serieNf`/`fornecedor`/`cnpjFornecedor`, sem reescrever nada do pipeline.

### Como testar manualmente

1. Rode `npm run dev` e abra `Leitura automática (beta)` no menu.
2. **PDF digital com texto** (a maioria dos DANFEs gerados por sistema): selecione o arquivo, clique em Analisar nota. Espera-se a chave encontrada via "texto do PDF", NF/série/CNPJ com selo verde (alta confiança) — e o log do console mostrando que código de barras e OCR nem foram tentados.
3. **PDF escaneado ou foto sem texto embutido, mas com código de barras legível**: o texto fica vazio/insuficiente, a página é renderizada e o código de barras é achado em uma das combinações de recorte/rotação — acompanhe o console (`[NFe] Tentando CODE_128 - ...`) para ver as tentativas.
4. **Digitalização ruim** (sem texto, código de barras ilegível, mas a chave ainda aparece impressa/legível na imagem): o pipeline cai para OCR — no console aparece `[NFe] Código de barras não resolveu — tentando OCR como último recurso.`. Na primeira vez que isso roda no navegador, é preciso estar com internet (baixa o pacote de idioma do tesseract.js uma única vez).
5. **Arquivo sem chave legível em lugar nenhum**: o resumo da revisão indica que nenhuma chave válida foi localizada (depois de tentar texto, código de barras e OCR); preencha os campos e confirme normalmente — sem travar.
6. Preencha o Fornecedor manualmente uma vez para um CNPJ novo e confirme — na próxima análise de uma nota do mesmo CNPJ, o Fornecedor deve vir pré-preenchido do catálogo local com selo verde.
7. Clique em Confirmar dados e depois em Copiar para validar o JSON final.
8. `npm test` roda o teste da matemática da chave (`src/features/nfeReader/chaveNFe.test.mjs`) sem precisar de navegador.

## MVP volátil — sem dados mock

O MVP atual inicia sem recebimentos fictícios. Os dados criados durante a utilização ficam somente em memória no navegador e são sincronizados com a API enquanto a página está aberta. **Ao atualizar/recarregar a página, os recebimentos exibidos são zerados.**

Não é utilizado `localStorage` nem `sessionStorage` para persistir recebimentos. O backend também inicia com banco em memória vazio e não grava os recebimentos em `backend/data.json`.
