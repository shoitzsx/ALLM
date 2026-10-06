# 06 — Frontend, scanner, Portaria e notificações

**Dono:** Lucas · **Testes E2E e dispositivos:** Marcelo · **Contratos de API:** Goran e Kobner

## 1. O ponto de partida

Fatos do handoff do Lucas, conferidos no código na parte 02: hash routing próprio; `store.js` com 1.086 linhas, **local-first**, que replica regras do backend; lista inteira carregada e filtrada no navegador; usuário atual fixo (`DEMO_CURRENT_USER`); `api.me()` nunca chamada; notificações só `success` e `error`; scanner ao vivo oculto, captura fotográfica em uso; **Portaria inexistente**.

A especificação do ChatGPT tratou o frontend como "tela de login + telas novas". O trabalho maior é outro: **mudar a relação entre o store e o servidor**.

## 2. O que muda

Esforço em tamanhos relativos `[ESTIMATIVA]`: P = dias, M = 1 a 2 semanas, G = 2 semanas ou mais.

| # | Mudança | Hoje | Depois | Esforço |
|---|---|---|---|---|
| 1 | Autenticação (login, PIN, sessão, guarda de rotas) | Usuário fixo, header `X-User-Id` | Cookie de sessão, `/auth/me`, redirecionamento para login | M |
| 2 | **Store com o servidor como autoridade** | Local-first: muda o estado e sincroniza depois | Chama a API e **substitui o registro pela resposta** | **G** |
| 3 | Permissões na UI | `requireWritePermission` por string de perfil | `can('anexos.delete')` a partir de `permissoes` | M |
| 4 | Lista, busca e paginação no servidor | Carrega tudo, filtra no cliente | Consulta por filtros e cursor | G |
| 5 | Dashboard do servidor | Recalculado no cliente | `GET /dashboard` | P |
| 6 | Telas novas | — | Portaria, chegadas, excluídos, usuários, auditoria, integrações, filtros salvos, exportar | G (somadas) |
| 7 | Notificações em 5 níveis + mensagens por código | 2 níveis | `SUCCESS`, `INFO`, `WARNING`, `ERROR`, `PROGRESS` | M |
| 8 | Ações que existem sem botão | Reabrir divergência, itens, arquivar | Botões e modais | M |
| 9 | Acessibilidade | Linhas da tabela só com mouse | Teclado e foco | P |
| 10 | Foto: orientação, remoção de GPS/EXIF, compressão | Envia como veio, limite 4 MiB | Trata no cliente (v1 §7) | M |

## 3. Migração do store em 4 passos

O princípio é **estrangular** o store antigo aos poucos, sem reescrever tudo de uma vez e sem parar de entregar.

1. **Autenticação sem mexer na lógica.** `src/api.js`: `credentials: 'same-origin'`, sai o `X-User-Id`. Novo `AuthProvider` com `GET /auth/me`; guarda de rota (sem sessão → `#/login`); `currentUser` passa a ser o usuário real; sai `DEMO_CURRENT_USER` do bundle. O store continua igual.
2. **Mutações com o servidor como autoridade.** Para cada ação, em ordem de risco (`transitionStatus`, `createRecebimento`, `updateRecebimento`, divergências, itens; anexos **já** são assim): `await api.x()` → colocar no estado **o registro devolvido** (com `versao`) → apagar o mutador local equivalente. A fila por recebimento (`apiMutationQueues`) permanece.
3. **Versão e conflito.** Guardar `versao`, enviar `If-Match`, tratar `409 VERSION_CONFLICT` (recarrega o registro e mostra aviso).
4. **Consultas.** Trocar `hydrateRecebimentosFromApi` (todas as páginas) por `useReceiptsQuery(filtros, cursor)`; remover `filterRecebimentos` do cliente; contadores da sidebar e dashboard vêm do servidor.

Remoções ao final: `DEMO_USERS`, `DEMO_CURRENT_USER`, `setApiUser`, as comparações `role === 'Consulta'`, e os imports de `src/data.js` que o backend também usa (mover status, transições e catálogos para um módulo compartilhado ou para `GET /catalogos`; hoje o backend importa o arquivo do frontend).

**Regressão a cada passo:** os 90 testes atuais, os scripts Playwright do scanner (`validate-*.mjs`, hoje fora do `npm test`) e o smoke de rotas.

## 4. Cliente HTTP

| Comportamento | Regra |
|---|---|
| Credenciais | `credentials: 'same-origin'`; nenhum token em `localStorage` |
| `401` (`UNAUTHORIZED`, `SESSION_EXPIRED`) | Limpa o estado, vai para o login com "Sua sessão expirou" |
| `403 FORBIDDEN` | Aviso `WARNING`: sem permissão |
| `403 PIN_CHANGE_REQUIRED` | Vai para a troca de PIN |
| `409 VERSION_CONFLICT` | Recarrega o registro e mostra o aviso de alteração por outra pessoa |
| `429` | Mensagem de espera |
| `503` (`DB_*`) | `ERROR` com "Tentar novamente" |
| Prazo | `AbortController` com limite (ex.: 20 s). Hoje **não há deadline** nem retry (handoff do Goran) |
| Retry | Só em `GET`; nunca em mutação sem `Idempotency-Key` |
| `requestId` | Guardar o de cada erro e mostrar em "Detalhes técnicos" (copiável) para suporte |
| Atividade | `POST /auth/ping` por interação, no máximo a cada 2 min |

## 5. Telas

### 5.1 Login (`#/login`)

- **Matrícula:** `autoComplete="username"`; aceita letras e números (formato final: Q2).
- **PIN:** `type="password" inputMode="numeric" pattern="[0-9]*" maxLength=8 autoComplete="current-password"`; botão mostrar/ocultar; `Enter` envia.
- **Teclado numérico na tela** em dispositivo touch, decidido **por capability** (`matchMedia('(pointer: coarse)')`), nunca por largura ou user-agent: o mesmo princípio já usado no scanner. No desktop, teclado físico.
- Estados: enviando, erro genérico ("Matrícula ou PIN inválidos, ou acesso temporariamente bloqueado. Se continuar, procure seu supervisor."), espera por `429`.
- Não guardar o PIN. Lembrar a última matrícula é opcional e **desligado** na Portaria.
- Foco inicial na matrícula; mensagens com `role="alert"`.

### 5.2 Troca de PIN obrigatória

PIN atual (o temporário), novo e confirmação; regras visíveis ("8 dígitos; evite sequências e números repetidos"); trata `WEAK_PIN`.

### 5.3 Sessão e usuário

Chip do usuário com nome, matrícula e perfil (hoje ele só mostra um toast demonstrativo). Menu com **"Trocar usuário"** (logout + limpeza do estado do store). Aviso 60 s antes de expirar por inatividade ("Continuar conectado?").

### 5.4 Menu por perfil

O menu é construído a partir de `permissoes`; o servidor continua recusando o que não é permitido.

| Perfil | Itens |
|---|---|
| `PORTARIA` | Portaria (única) |
| `CONSULTA` | Visão geral, Recebimentos, Pendências (somente leitura) |
| `ALMOXARIFADO`, `SUPRIMENTOS` | Operação completa conforme a matriz + consulta da Portaria |
| `ENCARREGADO`+ | + Excluídos |
| `SUPERVISOR`+ | + Auditoria |
| `ADMINISTRADOR` | + Usuários, Integrações |

### 5.5 Excluir, restaurar e "Excluídos"

- O modal de remoção de anexo (hoje com motivo opcional) passa a exigir **motivo** (mínimo 5 caracteres) e explica: "O arquivo ficará em quarentena por 90 dias e poderá ser restaurado por um supervisor".
- Tela **Excluídos** (`excluidos.read`): tipo, item, quem excluiu, quando, motivo, e, para arquivos, estado e prazo de purga. Ações **Restaurar** (`SUPERVISOR`+) e **Purgar** (`ADMINISTRADOR`, com confirmação forte).

### 5.6 Usuários, Auditoria, Integrações

- **Usuários:** o backend já tem CRUD. A tela lista, cria, ativa/desativa, define perfil e papel superior, **reseta PIN** (mostra o PIN temporário **uma vez**, com botão copiar e aviso), bloqueia/desbloqueia e revoga sessões. Importação por CSV para o administrador.
- **Auditoria:** filtros (usuário, entidade, ação, período, recebimento); cada linha mostra o **diff por campo** em linguagem legível; IP e user-agent só com `auditoria.tecnica`; exportável.
- **Integrações:** estado do espelho do Sheets (última sincronização, atraso), fila, falhas, reconciliação do Drive, botão "Sincronizar agora".

### 5.7 O que já existe no backend e falta na tela

Adicionar/editar/excluir **item**, **reabrir divergência**, **arquivar/restaurar** (agora excluir/restaurar). São baratos e evitam que um erro de digitação force a exclusão de um recebimento inteiro.

## 6. Pesquisa e filtros

- **Campo único** no topo ("Pesquise NF, pedido, produto, fornecedor ou responsável…"), com o atalho `/` que já existe, e **autocomplete agrupado por tipo** (v1 §9).
- **Filtros:** manter os atuais (status, tipo, fornecedor, responsável, período, NF pendente) e acrescentar: com divergência, com/sem anexo, origem (Portaria × Almoxarifado), material, pedido, NF. **Chips** dos filtros ativos e "Limpar".
- **Presets de data:** hoje, 7 dias, 30 dias, mês atual.
- **Meus filtros** (★): salvar o filtro atual com nome, aplicar, renomear, excluir; filtros globais aparecem marcados; só quem tem `filtros.global` cria global.
- **Ordenação por coluna** clicável (hoje só a data) e **paginação por cursor** ou "carregar mais".
- **URL como estado:** `#/recebimentos?q=aguia&status=EM_CONFERENCIA&de=2026-09-01`.
- Estados: esqueleto ao carregar; vazio ("Nenhum recebimento encontrado" + "Limpar filtros"); erro com "Tentar novamente"; contagem anunciada em região `aria-live="polite"`.
- A normalização no cliente deixa de ser a fonte da verdade (fica, no máximo, para destacar o trecho encontrado).

## 7. Portaria e scanner (D15)

### 7.1 O scanner hoje

Pipeline: texto do PDF → ZBar → ZXing → pipeline robusto → OCR dos 44 dígitos como último recurso. **Fotografar código** é o caminho em produção; o scanner ao vivo existe, testado, mas **oculto** depois de teste físico em iPhone/Safari e Android/Chrome. Extrai só o que se deriva da chave (UF, ano/mês, CNPJ, modelo, série, número, DV), com selo de confiança por campo; **não** lê itens nem valores e **não** faz parsing de XML. "Confirmar dados" nunca salva sozinho (confirmado por `validate-receipt-handoff.mjs`).

### 7.2 Fluxo da Portaria

```
[Portaria]  Fotografar código ─> analisa (mesmo pipeline) ─> Revisão: NF, série, CNPJ,
            fornecedor (se o CNPJ é conhecido), chave
   └─> Confirmar ─> POST /portaria/chegadas
          ├─ chave nova ─> "Chegada registrada CHG-00000123" ─> GET /portaria/identificar?chave=
          │       ├─ há recebimento ─> mostra "REC-2026-000184 · Em conferência"
          │       └─ não há        ─> "Aguardando recebimento" (aparece para o Almoxarifado)
          └─ chave já registrada e ativa ─> 409 ARRIVAL_DUPLICATE:
                  "Esta nota já foi registrada hoje às 08:42 por Maria (matrícula 10482)."
   Falha de leitura ─> "Digitar a chave (44 dígitos)" ou "NF + CNPJ"  (metodo_leitura = MANUAL)
```

Telas: **(1) Início:** botão grande "Fotografar código", "Selecionar arquivo", "Digitar"; lista "Chegadas de hoje" (código, NF, fornecedor, hora, status) e busca por NF ou chave. **(2) Revisão** com selos de confiança e edição. **(3) Resultado.**

### 7.3 Regras

- **Captura fotográfica estática.** O scanner ao vivo **continua oculto** até uma nova rodada de teste físico. Critério sugerido para reativar `[PROPOSTA]`: pelo menos 95% de leituras corretas em 50 notas reais, em 3 aparelhos diferentes, incluindo iPhone/Safari.
- **Nunca** salvar sem confirmação humana.
- **Persistir só:** chave, NF, série, CNPJ, fornecedor (se casar), método de leitura, resumo da confiança, usuário e hora. **Não** gravar imagem nem texto bruto de OCR. Se a empresa quiser guardar a foto da nota, ela entra como **anexo do recebimento** pelo fluxo normal.
- **Duplicidade:** a chave ativa duplicada é recusada com mensagem clara (Q6). Cancelar uma chegada é de superior.
- **Sem modo offline** no MVP; mostrar claramente a falta de conexão.
- **Fornecedor:** hoje o catálogo vive no `localStorage` (`supplierCatalog.js`); passa a vir de `alm.fornecedores`.
- Campos "candidatos" (UF, ano/mês, data de emissão, valor total) continuam só para conferência.

### 7.4 Usar a chave também no Almoxarifado

No wizard de novo recebimento, o prefill do scanner hoje **descarta** a chave ("não existe no modelo"). Passar a enviar `nfeChaveAcesso`; o backend valida o dígito verificador (módulo 11) e grava em `recebimentos.nfe_chave_acesso`. Duplicidade vira **alerta**, não bloqueio (Q6). Se existir chegada com a mesma chave, sugerir o vínculo.

### 7.5 Testes do scanner

- Os `validate-*.mjs` (Playwright) não rodam no `npm test`. Entram no CI do Marcelo, com Chromium.
- Rodada física antes de qualquer reativação do ao vivo: iPhone/Safari, Android/Chrome, tablet, webcam de notebook; pouca luz; nota dobrada; foto de tela.
- **Fora do escopo:** XML de NF-e (pipeline próprio, futuro) e leitura de itens/valores por OCR.

## 8. Notificações e feedback

### 8.1 Cinco níveis

| Nível | Quando | Persistência | ARIA | Exemplo |
|---|---|---|---|---|
| `SUCCESS` | Ação concluída | 4 s | `role="status"` | "Recebimento criado." |
| `INFO` | Informação neutra | 6 s | `role="status"` | "Sincronizando com o Google Sheets…" |
| `WARNING` | Dá para seguir, com ressalva | 8 s ou até fechar | `role="status"` | "NF ainda não informada: o recebimento só poderá ser finalizado com ela." |
| `ERROR` | Falhou | Até fechar; botão de ação | `role="alert"` | "Não foi possível enviar o documento. Tentar novamente." + detalhe técnico recolhido com `requestId` |
| `PROGRESS` | Operação longa | Até concluir | `role="status"`, `aria-valuenow` | "Enviando documento 2 de 6… 63%" e "Finalizando…" |

Regras: **nunca só cor** (ícone + texto); no máximo 3 visíveis; deduplicar mensagens idênticas; respeitar `prefers-reduced-motion`; no celular, acima da navegação inferior. Hoje `pushToast(title, message, type)` só recebe `success` ou `error`, mas o CSS já usa `toast-${type}`: basta estender o `type` e criar as classes.

### 8.2 Mensagens por código

Estender o padrão de `src/features/attachments/errorMessages.js` para um arquivo único de todos os códigos da API:

| Código | Mensagem ao operador |
|---|---|
| `UNAUTHORIZED`, `SESSION_EXPIRED` | "Sua sessão expirou. Entre novamente." |
| `INVALID_CREDENTIALS` | "Matrícula ou PIN inválidos, ou acesso temporariamente bloqueado. Se continuar, procure seu supervisor." |
| `TOO_MANY_ATTEMPTS` | "Muitas tentativas. Aguarde alguns minutos e tente de novo." |
| `PIN_CHANGE_REQUIRED` | "Você precisa criar um novo PIN para continuar." |
| `WEAK_PIN` | "Escolha um PIN menos previsível (evite sequências e números repetidos)." |
| `FORBIDDEN` | "Você não tem permissão para esta ação." |
| `VERSION_CONFLICT` | "Este recebimento foi alterado por outra pessoa. Carregamos a versão mais recente." |
| `BUSINESS_RULE` | A mensagem do servidor (já em português) |
| `ARRIVAL_DUPLICATE` | "Esta nota já foi registrada na Portaria." |
| `RETENTION_NOT_ELAPSED` | "Este arquivo ainda está no prazo de retenção." |
| `FILE_IN_QUARANTINE` | "Este arquivo está em quarentena." |
| `DB_UNAVAILABLE`, `DB_TIMEOUT` | "Serviço temporariamente indisponível. Tente novamente em instantes." |

Regra: o operador **nunca** vê mensagem técnica de Drive, banco ou Google; o `requestId` fica no detalhe.

### 8.3 Notificações persistentes (Fase 2)

Tabela `notificacoes` (fora do delta atual): destinatário (usuário ou papel), tipo, título, mensagem, entidade, `lida_em`, `criado_em`. Sino com contador; atualização por **polling** a cada 30 a 60 s no MVP; Realtime só se houver necessidade. Candidatos: chegada sem recebimento; divergência aguardando análise; falha de sincronização (ADM); arquivo perto da purga (supervisor); exportação concluída.

## 9. Para começar hoje, sem esperar o backend

1. `AuthProvider`, `LoginPage` e guarda de rotas contra um **mock** de `POST /auth/login` e `GET /auth/me`, ligado só em desenvolvimento (por exemplo `VITE_AUTH_MOCK`, nunca em produção). O contrato do mock é o da parte 03, seção 5.
2. Extrair `usePermissions()` / `can(codigo)` e converter os pontos que hoje comparam `role === 'Consulta'`.
3. Adicionar `INFO`, `WARNING` e `PROGRESS` ao toast.
4. Criar `errorMessages` global.

Assim o Lucas e o Kobner trabalham em paralelo e se encontram no contrato.

## 10. Acessibilidade e mobile

- Linhas da tabela de recebimentos (`<tr onClick>`) são só de mouse: `role="button"`, `tabIndex` e `Enter`, como nos cards.
- Foco preso no `Modal` e *skip link*.
- Alvo de toque ≥ 44×44 px; fonte ≥ 16 px em campos no celular (evita zoom no iOS).
- Estado sempre com texto e ícone.
- Portaria em tablet: testar paisagem e retrato. PIN pad com botões grandes e `aria-label`.

## 11. O que não fazer

- Não reativar o scanner ao vivo "porque agora existe a Portaria".
- Não usar botão escondido como única proteção.
- Não guardar PIN, token ou dado pessoal em `localStorage`.
- Não manter regra de negócio duplicada no cliente (transições, permissões): o servidor manda.
