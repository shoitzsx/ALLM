# ALM - Recebimento de Materiais

MVP responsivo para registrar, acompanhar e consultar recebimentos de materiais do Almoxarifado. A aplicacao substitui o controle espalhado entre planilha, e-mail, grupo de WhatsApp, documentos digitalizados e pastas de rede por uma interface unica para cadastro, consulta, anexos, divergencias e historico.

Este projeto foi criado a partir do levantamento do Projeto ALM e da versao 2 do prompt funcional.

## Especificacao da Versao Corporativa

A arquitetura implementavel aprovada para a proxima etapa esta em [`ARQUITETURA_TECNICA_ALM.md`](ARQUITETURA_TECNICA_ALM.md). O documento detalha PostgreSQL, indices e busca, Google Shared Drive, upload seguro, API, permissoes, migracao, backup, OCR futuro, riscos e ordem de implementacao. O frontend atual continua sendo um prototipo local ate que backend, login, banco e storage real sejam implementados.

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
