# ALM 2.0 — Arquitetura revisada (v2)

**Data:** 06/10/2026
**Base do código:** branch `fix/vercel-api-routing` em `48b1583` e `main` em `780062a`
**Status:** proposta para revisão da equipe. **Nada aqui foi implementado.**

Este conjunto de documentos parte da "Especificação ALM 2.0" gerada pelo ChatGPT (`ALM_2_0_Especificacao_Arquitetura_Completa.md`), **corrige-a** e a **reconcilia** com o que o repositório já tem: o `ARQUITETURA_TECNICA_ALM.md` (v1.0, 3.254 linhas, com DDL PostgreSQL completo) e os três handoffs. Cada afirmação importante foi conferida contra o código, contra testes que rodei, ou contra a documentação oficial do fornecedor.

A conclusão central: **a especificação do ChatGPT não conhecia o `ARQUITETURA_TECNICA_ALM.md`**. Por isso duplicou, e em vários pontos contradisse, um documento que a própria equipe já tinha e que é mais profundo em banco, auditoria, busca, arquivos, backup e migração. O caminho certo não é escolher um dos dois; é manter a v1 como base técnica e aplicar por cima as decisões novas (Supabase, matrícula + PIN, Portaria, Sheets como espelho). É isso que estes documentos fazem.

## Como ler

Leia a parte 01 inteira (15 min). Depois leia só a(s) parte(s) da sua área.

| Parte | Conteúdo | Dono da revisão |
|---|---|---|
| [01-resumo-e-decisoes.md](01-resumo-e-decisoes.md) | Arquitetura em uma página, registro de decisões D01–D20, perguntas para a empresa, próximos passos | todos |
| [02-estado-real-e-reconciliacao.md](02-estado-real-e-reconciliacao.md) | O que existe de fato no código, e como as três fontes (código, v1, ChatGPT) se contradizem | Goran, Kobner |
| [03-identidade-permissoes-portaria.md](03-identidade-permissoes-portaria.md) | Login por matrícula + PIN, sessão, bloqueio, papéis e matriz de permissões, regra de exclusão | Kobner (dono), Lucas (UI), Marcelo (testes) |
| [04-dados-auditoria-busca.md](04-dados-auditoria-busca.md) | Acesso ao banco, código do recebimento, exclusão lógica, auditoria, pesquisa e filtros salvos, contrato da API | Goran, Kobner |
| [05-arquivos-sheets-jobs.md](05-arquivos-sheets-jobs.md) | Drive (ciclo de vida, quarentena), Sheets como espelho e exportação, outbox e jobs, matriz de falhas | Goran (dono), Marcelo |
| [06-frontend-scanner-notificacoes.md](06-frontend-scanner-notificacoes.md) | Impacto no frontend, telas novas, notificações, Portaria e scanner | Lucas (dono), Marcelo |
| [07-migracao-infra-roadmap.md](07-migracao-infra-roadmap.md) | Migração do Sheets, ambientes, custos verificados, LGPD, testes, roadmap, spikes, riscos | todos; Marcelo (release) |
| [08-revisao-da-versao-chatgpt.md](08-revisao-da-versao-chatgpt.md) | Avaliação afirmação por afirmação da especificação original e do diagrama | Lucas |
| [contexto/CONTEXTO-LUCAS.md](contexto/CONTEXTO-LUCAS.md) | Quais arquivos são do Lucas, quais não são e quando avisar antes de mexer | Lucas |
| [contexto/CONTEXTO-KOBNER.md](contexto/CONTEXTO-KOBNER.md) | Idem para o Kobner **e o Marcelo** (o Marcelo trabalha junto do Kobner) | Kobner, Marcelo |
| [contexto/CONTEXTO-GORAN.md](contexto/CONTEXTO-GORAN.md) | Idem para o Goran | Goran |
| [sql/001_alm2_delta.sql](sql/001_alm2_delta.sql) | Migration delta sobre o DDL da v1 (sintaxe validada) | Kobner |
| [sql/validate-sql.mjs](sql/validate-sql.mjs) | Validador de sintaxe SQL com o parser real do Postgres | Marcelo (CI) |

## Legenda de evidência

| Marca | Significado |
|---|---|
| `[CÓDIGO]` | Verificado lendo o repositório (arquivo:linha quando cabível) |
| `[TESTE]` | Verificado executando algo (`npm test`, parser SQL) |
| `[DOC-OFICIAL]` | Conferido na documentação oficial do fornecedor em 06/10/2026 (URLs no fim de cada parte) |
| `[DOC-ALM]` | Vem de documento do projeto (handoffs, `ARQUITETURA_TECNICA_ALM.md`) |
| `[PROPOSTA]` | Recomendação desta revisão |
| `[A VERIFICAR]` | Não consegui confirmar; vira spike com critério de aceite (parte 07) |
| `[DECISÃO]` | Depende da equipe ou da empresa |

Quando uma marca não aparece, a frase é raciocínio desta revisão, não fato verificado.

## Precedência entre documentos

1. **Como é hoje:** vale o código.
2. **Como será**, nos temas que estes documentos cobrem: vale esta pasta `docs/alm2/`.
3. **Todo o resto** (DDL base, busca, backup de arquivos, migração de arquivos, riscos, checklist de produção): vale o `ARQUITETURA_TECNICA_ALM.md` v1.0, que **não é duplicado aqui de propósito**, para existir uma única fonte da verdade.
4. Handoffs: contexto histórico.
5. A especificação original do ChatGPT: só histórico; ver a parte 08.

Sugestão: depois da aprovação, colocar um aviso no topo do `ARQUITETURA_TECNICA_ALM.md` apontando para esta pasta. Não alterei esse arquivo.

## O que foi validado e como

- `npm test` na branch: **90/90 passando** `[TESTE]`.
- DDL da v1 (8 blocos `sql` do documento) e o delta: **parse sem erro** no parser real do Postgres (`libpg-query`, gramática PG 18) `[TESTE]`. Isso valida **sintaxe**, não semântica nem comportamento. Nenhum SQL foi executado contra um banco, porque não há Postgres nem Docker nesta máquina.
- Merge de `main` na branch: `git merge-tree` não acusou conflito `[TESTE]`. Nenhum merge foi feito.
- Limites, preços e comportamentos de Supabase, Vercel e Google: lidos nas páginas oficiais em 06/10/2026. Confirme os preços antes de aprovar orçamento.
- **Não** foi validado: nada na Vercel (Preview/Production), nada contra APIs reais do Google, nenhum teste em dispositivo físico.

## Como revisar por partes

Para cada parte: o dono lê, anota discordâncias direto no arquivo (ou em issue), e a equipe só passa para a próxima quando as decisões `[DECISÃO]` daquela parte tiverem resposta. A tabela de decisões na parte 01 é o placar: cada linha vai de **Recomendada** para **Aprovada** ou **Alterada**.
