# 02 — Estado real e reconciliação das fontes

Esta parte responde duas perguntas: **o que o repositório realmente tem hoje** e **onde as três fontes de projeto (código, `ARQUITETURA_TECNICA_ALM.md` v1.0 e a especificação do ChatGPT) se contradizem**, com a decisão tomada em cada conflito.

## 1. Fotografia do repositório

Tudo abaixo foi conferido lendo o código ou rodando comandos em 06/10/2026.

### 1.1 Git, branches e Vercel

| Fato | Evidência |
|---|---|
| A branch atual é `fix/vercel-api-routing`; o HEAD `48b1583` tem a mensagem "Implement new feature for user authentication and improve error handling", mas **só adiciona o handoff do Lucas (589 linhas de documentação)**. Não existe nenhuma implementação de autenticação | `git show --stat HEAD` `[CÓDIGO]` |
| `main` (`780062a`) e a branch **divergiram** em `cedcb3f`. A branch tem 3 commits que a `main` não tem (`c7bffda` rewrite do Vercel, `ad20592` e `48b1583` docs). A `main` tem 2 que a branch não tem (`780062a` melhorias de anexos e nomes no Drive, `6f315fb` doc) | `git log main..HEAD` e `HEAD..main` `[CÓDIGO]` |
| O dry-run do merge `main` → branch **não tem conflito**, apesar de os dois lados tocarem `backend/app.mjs` | `git merge-tree --write-tree HEAD main` `[TESTE]` |
| O handoff do Lucas diz que o fix do routing é `c7bffda`; o handoff do Goran, auditando a `main`, diz que ele não está lá. **Os dois estão certos**: o fix existe só na branch | cruzamento dos itens acima |
| Na branch existem `vercel.json` (rewrite `/api/v1/:path*` → `/api/router?path=:path*`) e `api/router.mjs`; o catch-all `api/v1/[...path].mjs` foi removido. `routeParts` lê o parâmetro `path` | `vercel.json`, `api/router.mjs`, diff de `c7bffda` `[CÓDIGO]` |
| **O fix nunca foi validado de ponta a ponta.** No Preview, o request passou do `NOT_FOUND` da Vercel e chegou em `api/router.mjs`, mas a função morreu por falta da env do Sheets. Falta um novo Preview com todas as variáveis | `docs/HANDOFF-GORAN-VERCEL-ROUTING-PRODUCTION.md` §13 e §28 `[DOC-ALM]` |
| `npm test`: **90/90 passando** na branch. A suíte cobre anexos, scanner e os caminhos do repositório/Sheets ligados a anexos e NF (`backend/attachments.test.mjs`); **não cobre** o handler HTTP, o serviço de recebimentos de ponta a ponta, auth nem routing | `package.json` (script `test`) `[TESTE]` |
| `.env` e `backend/.env` existem localmente e estão no `.gitignore`; nenhum arquivo rastreado tem nome de segredo | `git check-ignore`, `git ls-files` `[CÓDIGO]` |

### 1.2 Identidade e permissões

| Fato | Evidência |
|---|---|
| A identidade é o header `X-User-Id`. **Sem header, o backend assume o primeiro usuário demo, que é Administrador** | `backend/app.mjs:75` `[CÓDIGO]` |
| `getUsuario` lê a **aba inteira** de usuários a cada requisição e **não confere `ativo`**: um usuário desativado continua entrando | `backend/repositories/recebimentosRepository.mjs:217` `[CÓDIGO]` |
| A aba `Usuarios` vazia é preenchida com **4 usuários demo** (`USR-001` a `USR-004`). Não existe lista real de funcionários em lugar nenhum | `backend/app.mjs:71`, `src/data.js:103-140` `[CÓDIGO]` |
| Perfis reais: **Administrador, Almoxarifado, Suprimentos, Consulta** | `src/data.js:96-101` `[CÓDIGO]` |
| Permissões já têm códigos em português: `recebimentos.read/create/update/archive`, `itens.read/write`, `anexos.read/write`, `divergencias.read/write`, `status.write`, `usuarios.write`, `auditoria.read`, `historico.read`. `Suprimentos` recebe **o mesmo conjunto de escrita que `Almoxarifado`**; só o status é restrito | `backend/services/recebimentosService.mjs:13-16`, `src/data.js:169-174` `[CÓDIGO]` |
| `GET /auth/me` já devolve `permissoes`, mas **o frontend nunca chama `api.me()`**; o "usuário atual" é a constante `DEMO_CURRENT_USER`. Não existe tela de login nem de usuários | `src/api.js`, `src/data.js:142`, handoff do Lucas §4.7 `[CÓDIGO]` |
| O backend importa constantes de domínio **do frontend** (`../../src/data.js`: status, transições, catálogos, `DEMO_USERS`) | `backend/services/recebimentosService.mjs:2`, `backend/app.mjs:2` `[CÓDIGO]` |

### 1.3 Dados e regras

| Fato | Evidência |
|---|---|
| Persistência: 7 abas do Sheets (`Recebimentos`, `Itens`, `Divergencias`, `HistoricoStatus`, `Auditoria`, `Anexos`, `Usuarios`). Leitura do agregado por `batchGet` (1 chamada); mutações gerais por `replaceChildren`, que **lê, apaga e reinsere as 5 abas filhas inteiras** | `backend/repositories/recebimentosRepository.mjs:132-156` `[CÓDIGO]` |
| Protocolo `REC-AAAA-NNNN` (**4 dígitos**), calculado em memória por `max + 1` sobre todos os recebimentos: **duas criações simultâneas podem gerar o mesmo número** | `backend/services/recebimentosService.mjs:41` `[CÓDIGO]` |
| O `id` do recebimento **é o protocolo** (`REC-2026-0012`); as rotas do frontend e a propriedade `almReceiptId` dos arquivos no Drive usam esse valor | handoff do Lucas §13, `backend/integrations/googleDrive.mjs:91` `[CÓDIGO]` |
| 5 status: Em digitação → Aguardando documentação → Em conferência → Divergência identificada → Conferido/Finalizado. Finalizado não tem transições, só administrador força | `src/data.js:9-15, 145-165` `[CÓDIGO]` |
| Exclusão hoje: recebimento tem `arquivado` (reversível, **sem botão na UI**); anexo tem `removido` (lógico) mas o binário no Drive é apagado de verdade; item é removido fisicamente; divergência nunca é apagada | handoffs + `googleDrive.mjs:179` `[CÓDIGO]` |
| Auditoria: texto livre (`acao`, `detalhes`) numa aba, por recebimento, **regravável** por `replaceChildren`. Sem antes/depois, sem IP, sem acesso a arquivo | handoff do Goran §8 `[DOC-ALM]` |

### 1.4 Drive, Sheets e segurança

| Fato | Evidência |
|---|---|
| Drive via OAuth de conta Google real, escopo `drive.file`, pasta criada pelo próprio app | `googleDrive.mjs:8-11`, `.env.example` `[CÓDIGO]` |
| Upload: o navegador envia os bytes **direto ao Drive** (resumível, fatias de 1 MiB); a API só cria a sessão e confirma. Limite **4 MiB** por arquivo, por causa do teto de 4,5 MB de resposta da função na Vercel | `docs/attachments-api.md`, `src/features/attachments/constraints.js` `[CÓDIGO]` |
| Exclusão de anexo: `drive.files.delete` (**definitiva, sem lixeira**) antes de marcar o Sheets | `googleDrive.mjs:179` `[CÓDIGO]` |
| Marcadores de recuperação usam `appProperties` (**privadas ao app que criou o arquivo**) | `googleDrive.mjs:91` `[CÓDIGO]` |
| Escritas no Sheets usam `valueInputOption: 'RAW'`: **sem risco de fórmula injetada** pelo Sheets | `googleSheets.mjs:112,144,210` `[CÓDIGO]` |
| Downloads saem com `Content-Disposition` e `X-Content-Type-Options: nosniff` | `backend/app.mjs:35-36` `[CÓDIGO]` |
| `CORS_ORIGIN` tem padrão **`*`** | `backend/config/env.mjs:45` `[CÓDIGO]` |
| O export "Exportar Excel" é feito **no navegador** e `csvCell` **não neutraliza** células iniciadas por `=`, `+`, `-`, `@`. Um fornecedor chamado `=HYPERLINK(...)` vira fórmula ao abrir no Excel | `src/data.js:499-505`, `src/App.jsx:180-185` `[CÓDIGO]` |

### 1.5 Frontend

| Fato | Evidência |
|---|---|
| `store.js` (1.086 linhas) é **local-first**: cada ação muda o estado local primeiro e sincroniza depois, **replicando no cliente regras que também existem no backend** (transições, permissões) | handoff do Lucas §3 `[DOC-ALM]` |
| A lista inteira é carregada no início (`pageSize: 100`, todas as páginas) e **filtrada no navegador**; o backend já aceita `q`, `status`, `fornecedor`, `pedido`, `numeroNf`, `orderBy`, `page`, `pageSize`, mas a UI não usa | handoff do Lucas §9 `[DOC-ALM]` |
| O dashboard é recalculado no cliente; `GET /dashboard` existe e **ninguém chama** | handoff do Lucas §10 `[DOC-ALM]` |
| Existem ponta a ponta mas **sem botão na UI**: reabrir divergência, arquivar/restaurar, adicionar/editar/remover item | handoff do Lucas §18 `[DOC-ALM]` |
| Notificações: só `success` e `error` são usadas | handoff do Lucas §11 `[DOC-ALM]` |
| Scanner ao vivo existe e está **oculto** da produção; "Fotografar código" é o caminho em uso. Não há parsing de XML nem leitura de itens/valores | handoff do Lucas §5 `[DOC-ALM]` |
| **Portaria: 0% implementado.** "Portaria" só aparece em `promptV1/V2.md` como "carimbo da Portaria Fiscal" na nota em papel | handoff do Lucas §6 `[DOC-ALM]` |

## 2. As três fontes lado a lado

| Tema | Código hoje | `ARQUITETURA_TECNICA_ALM.md` v1.0 | Especificação do ChatGPT | **Decisão desta revisão** |
|---|---|---|---|---|
| Banco | Google Sheets | PostgreSQL (Cloud SQL) | Supabase Postgres | **Supabase Postgres** (D01) |
| Hospedagem | Vercel Functions | Cloud Run + Fastify + TypeScript | Vercel | **Vercel Pro**; Cloud Run como plano B (D12) |
| Identidade | `X-User-Id` | OIDC corporativo + cookie `__Host-` | Supabase Auth com e-mail sintético | **Matrícula + PIN próprios** (D03) |
| Perfis | 4 | 4 (códigos em maiúsculas) | 9 inventados | **5 funcionais + 3 superiores** (D05) |
| Códigos de permissão | `recebimentos.read` etc. (pt) | matriz por ação, sem códigos | `receipts.read` etc. (en) | **estende os atuais (pt)** |
| Nomes no banco | camelCase pt (abas) | snake_case pt | snake_case en | **snake_case pt da v1** |
| JSON da API | camelCase pt | snake_case | não definido | **camelCase atual** (D20) |
| Código do recebimento | `REC-AAAA-NNNN`, `max+1` | `REC-AAAA-NNNNNN`, atômico | `REC-AAAA-XXXX`, função transacional | **6 dígitos + `codigo_legado`** (D06) |
| Chave do recebimento | `id` = protocolo (texto) | `uuid` + `codigo` | `uuid` + `protocol` | **`uuid` + `codigo` + `codigo_legado`** |
| Erros da API | `{error:{code,message,details}}` | `problem+json` | `{error..., requestId}` | **atual + `requestId`** |
| Auditoria | texto livre, regravável | triggers, antes/depois, append-only, `arquivo_acessos` | `audit_events` gravada pela aplicação | **v1 + eventos de autenticação e exportação** (D08) |
| Exclusão | 4 mecanismos diferentes | `excluido_*` lógica; purga por job | `deleted_*` e `archived` misturados | **`excluido_*` único** (D07) |
| Arquivos | Drive pessoal, upload direto, ≤ 4 MiB | Shared Drive, upload pela API, hash/antivírus, 20/50 MiB | Drive; Shared Drive "a avaliar" | **híbrido**: upload direto + verificação pós-upload (D09) |
| Concorrência | fila no navegador | `versao` + `If-Match` | `version` (citado) | **v1** |
| Busca | no navegador | FTS + trigram, cursor | `unaccent`/trigram (citado) | **v1 + filtros salvos** (D14) |
| Sheets | banco | não previsto | espelho via outbox, upsert | **espelho por snapshot** (D10) |
| Backup | nenhum além de Sheets/Drive | PITR + dump + cópia S3 | "depende do plano" | **v1 ajustada ao plano** (parte 07) |
| Roadmap | — | 10–12 semanas, 8 etapas | 10 fases sem prazo | **F0–F9 com donos e saídas** (parte 07) |

## 3. O que reaproveitar da v1 sem alterar

Estas seções do `ARQUITETURA_TECNICA_ALM.md` continuam valendo e **não são repetidas** aqui:

| Seção da v1 | Assunto |
|---|---|
| §2 e §3 | Modelo de dados e DDL completo (schema `alm`, catálogos, triggers de normalização, finalização, histórico, auditoria, roles `alm_api`/`alm_job`) |
| §4 e §5 | Índices, busca ranqueada e autocomplete (`unaccent`, `pg_trgm`, `tsvector`) |
| §6 | `storage_containers`, `StorageService`, estrutura lazy de pastas, proxy de arquivos com `Range` |
| §7 | Idempotência de upload, deduplicação por `(recebimento_id, sha256)`, saga banco↔Drive |
| §8 | Matriz de autorização por perfil e workflow de status; cookie de sessão, CSRF, controles |
| §11 | Migração do histórico de arquivos da pasta de rede (`alm-migrate`) |
| §12 | Backup do banco e dos arquivos (RPO/RTO) |
| §14 | Escalabilidade e limite de 500.000 itens por Shared Drive |
| §17 e §18 | Riscos e checklist de produção |

**Validação feita:** os 8 blocos `sql` da v1 passam no parser real do Postgres, e todos os nomes que o delta desta revisão referencia existem neles `[TESTE]`. Isso não prova que executam; é o primeiro passo do spike S1.

## 4. Lacunas e arestas da v1 que esta revisão corrige

A v1 foi escrita antes do código ter Vercel, Supabase ou Portaria, e assumindo um projeto do zero. Ao cruzar com o código e com as plataformas, aparecem estes pontos:

| # | Aresta | Consequência | Correção nesta revisão |
|---|---|---|---|
| a | A v1 exige que **o arquivo passe pela API** (hash, magic bytes, antivírus). Função na Vercel recebe no máximo **4,5 MB** e não roda ClamAV | Incompatível com o upload direto que já funciona e com a Vercel | Manter upload direto; confirmar com `sha256Checksum` do Drive e ler os primeiros bytes por `Range`; antivírus só se Q8 exigir (parte 05) |
| b | Login por OIDC corporativo | A empresa quer matrícula + PIN | D03/D04 |
| c | `usuarios.ultimo_login_em` na tabela auditada | **Cada login** vira `UPDATE`, bump de `versao` e uma linha em `historico_alteracoes` | Coluna sai de `usuarios`; contador fica em `credenciais_pin` (delta SQL) |
| d | `auditar_mutacao()` grava `to_jsonb(OLD/NEW)` | Inclui `busca_fts` e as colunas `*_busca`: **infla a auditoria** | Remover colunas derivadas do snapshot (parte 04, seção 6) |
| e | `bloquear_mutacao_filho_finalizado()` só libera uma lista fixa de colunas técnicas | O job de quarentena/purga **falharia** em recebimento finalizado | Função recriada com as colunas novas (delta SQL) |
| f | API em snake_case, `problem+json`, `/transicoes`, cursor | Diverge do contrato que o frontend consome | D20 preserva o contrato atual |
| g | Código com 6 dígitos, gerado só pelo banco (a trigger recusa código informado) | O legado tem 4 dígitos e não pode ser inserido como está | D06: importar em ordem do número legado e guardar o original em `codigo_legado` |
| h | Não existe matrícula em `usuarios` | Falta o identificador de login | Delta SQL |
| i | Marcadores do Drive em `properties` (visíveis a todos os apps) | Hoje usamos `appProperties` (privadas) | Re-marcar na migração para outra identidade (parte 05) |
| j | Pressupõe Google Workspace (Shared Drive, service account) | Não confirmado | Q1 e plano B no D09 |
| k | Backend em TypeScript/Fastify | O repositório é JavaScript `.mjs` com `http` puro | **Fora do escopo**: manter JS; migrar para TS é opcional e independente |
| l | Cloud SQL + Cloud Run | O time já usa Vercel e quer Supabase | D12 |

## 5. O que o ChatGPT acrescentou de útil e foi mantido

- A separação explícita entre estado atual e proposta.
- Outbox transacional para o espelho do Sheets (corrigida: snapshot em vez de upsert por linha).
- Auditoria separada do histórico operacional.
- Papéis separados de cargos.
- Portaria como entidade própria (`chegada`), e não como um "recebimento com menos botões".
- Soft delete com retenção e restauração; Drive nunca apagado de imediato.
- A observação de que mudanças diretas no Drive/Sheets só podem ser detectadas, não impedidas (mantida, com limites honestos, parte 05).
- A divisão de responsabilidades por pessoa (ajustada).

## 6. Pendências de fontes

- A conversa colada com o ChatGPT veio **truncada** (parou no meio da "Parte 1"). Avaliei o documento final `ALM_2_0_Especificacao_Arquitetura_Completa.md`, que chegou inteiro, e o diagrama.
- O handoff completo do Goran (`HANDOFF-GORAN-BACKEND-INFRA-COMPLETE.md`) **não está no repositório**; só foi colado na conversa. Recomendo versioná-lo em `docs/`.
- O relatório da turma ("Visão Geral — Escalabilidade e Evolução Tecnológica do ALM", PDF), citado no handoff do Lucas, não foi fornecido.
