# ALM — checklist de handoff e PR consolidado do banco

**Data de conferência:** 15/10/2026.
**Destino autorizado para revisão:** `main`. **Não fazer merge automático**.
**Branch de origem:** `audit/alm-pin-login-pg17-20261015`.
**Pull Request aberto:** [#2 — entrega consolidada do banco](https://github.com/shoitzsx/ALLM/pull/2), base `main`, sujeito à revisão da equipe.
**Commit testado e apresentado na abertura do PR:** `8b92ba57330984160c4deff51b5055a3903c404e` (`8b92ba5`). A atualização deste checklist gera commit **posterior, apenas de documentação**, sem refazer o teste; portanto, não tratar os 137 testes como executados novamente nesse commit posterior.
Este documento não aplica migrations nem altera dados.

## 1. Decisões confirmadas pela equipe

- PR **único** reunindo integralmente a base `supabase-kobner-clean`
  e a auditoria posterior, sujeito a revisão dos arquivos/testes.
- Workflow `.github/workflows/alm-database-ci.yml` pode acompanhar
  a entrega; é **manual** (`workflow_dispatch`), não executado
  com sucesso pelo GitHub Actions devido a bloqueio por faturamento.
- Não modificar backend/frontend, Vercel nem deploy.
- **Supabase/PostgreSQL é a fonte principal**; Drive contém bytes dos
  arquivos; Sheets legado fica documentado, **sem remoção neste PR**.
- Preservar UUIDs, integridade de itens e bloqueio de edição funcional
  de recebimentos finalizados; rascunhos precisam de contrato próprio.
- PIN: políticas de tamanho, tentativas, bloqueio, recuperação e
  bootstrap do primeiro administrador são **pendências de negócio**.
- Backend local pode começar validando Session pooler :5432;
  testar driver/carga antes de decisão definitiva.
- Preview da Vercel criado automaticamente pela integração GitHub/Vercel
  após o PR: **não** é validação do backend, autenticação ou banco e
  **não** muda a decisão de desenvolver e validar localmente.

## 2. Conferência do GitHub e PR aberto

| Comparação | Resultado observado |
|---|---|
| `main...` branch de auditoria no commit `8b92ba5` | 78 commits à frente e 0 atrás na conferência de 15/10 |
| `supabase-kobner-clean...` auditoria | A branch consolidada contém integralmente a base anterior; conferência antes dos contratos adicionais mostrou 19 commits à frente e 0 atrás |
| Arquivos do diff no commit `8b92ba5` | 30 arquivos; somente `supabase/`, exceto `.github/workflows/alm-database-ci.yml` (autorizado) |
| Pull Request | [#2](https://github.com/shoitzsx/ALLM/pull/2), aberto para revisão, `audit/alm-pin-login-pg17-20261015` → `main`; **sem merge** |

A comparação e os testes acima se referem ao commit `8b92ba5`.
A alteração posterior deste próprio checklist não muda migrations,
backend ou testes, mas altera o HEAD da branch; confirmar o diff do
PR novamente antes do merge.

## 3. Migrations instaladas no staging (12 entradas confirmadas)

**11 migrations de domínio, nesta ordem em `supabase/migrations/`:**

1. `20261007160000_alm_v1_base.sql`
2. `20261007160100_alm2_delta.sql`
3. `20261007160200_alm_integridade.sql`
4. `20261015010000_alm_chg_rec_atomico.sql`
5. `20261015012000_alm_function_search_path_hardening.sql`
6. `20261015013000_alm_extensions_schema_hardening.sql`
7. `20261015014500_alm_mvp_fk_indexes.sql`
8. `20261015021500_alm_mvp_fk_indexes_round2.sql`
9. `20261015023000_alm_bloquear_restauracao_purgado.sql`
10. `20261015024500_alm_extensions_role_usage.sql`
11. `20261015030000_alm_seguranca_auth.sql`

**1 migration de infraestrutura, já registrada no staging:**
`20261015045033_alm_runtime_logins_bootstrap`
(com SQL histórico em `supabase/infrastructure/`, **não** na
pasta de migrations de domínio).

O histórico remoto do Supabase `Almoxarifado ALM`,
ID `uxfstabcpvmujvzijyqw`, contém essas 12 versões.
A comparação de versões/nomes foi verificada por consulta ao
histórico remoto. Os detalhes de reconciliação antiga já aplicada,
evidências e limites estão em `supabase/migrations/REVISAO_BANCO.md`.

**Não reexecutar migrations, reconciliar histórico, resetar schema ou
recriar logins por causa do merge do PR.** O backend que usar esse
staging deve partir do estado já aplicado. A instalação em novo
ambiente precisa de plano de bootstrap e credenciais próprias.

## 4. Teste final registrado e evidências anteriores

- **137 testes SQL PostgreSQL 17 local** aprovados anteriormente.
- **114 testes SQL no staging** aprovados anteriormente.
- Instalação limpa PostgreSQL 17, controle de lock de numeração
  concorrente, permissões/RLS e teste de logins locais realizados.
- **28 tabelas**, RLS ativada em todas e 28 policies técnicas registradas
  na auditoria anterior; Security Advisor sem alertas na última revisão
  documentada.
- API e JOB autenticaram via Supavisor Session :5432 e Transaction
  :6543; testes confirmaram `SET LOCAL ROLE`, identidades de conexão,
  grants e negação de acesso a colunas sensíveis pelo JOB.
- Testes de aplicação com matrícula+PIN real, autorização por perfis
  humanos, driver sob carga e migração Sheets → PG **não executados**.
- CI GitHub Actions **bloqueado por faturamento**; workflow manual
  não foi aprovado por execução no GitHub.

**RETESTE CONCLUÍDO em 15/10/2026, commit `8b92ba5`, pelo operador
no Git Bash (saída enviada à equipe):**

- `git status --short`: saída vazia, antes do fast-forward.
- `git pull --ff-only`: atualização até `8b92ba5`, sem conflitos.
- `git log -1 --oneline`: confirma `8b92ba5` na branch local e remota.
- `git diff --check main...HEAD`: nenhuma mensagem de erro.
- `bash supabase/tests/testar-banco.sh`: **11 migrations de domínio OK**
  em **PGlite 0.5.10 / PostgreSQL 18.6 (WASM)**; usuário v1
  preservado, **137 testes SQL aprovados**, execução concluída com sucesso.
- Aviso **não fatal**: referência opcional
  `docs/alm2/sql/001_alm2_delta.sql` ausente na branch; comparação
  adicional do delta foi ignorada.
- **Limite desse reteste:** PGlite usa uma conexão; concorrência real,
  instalação limpa em PostgreSQL 17 e teste E2E de backend **não**
  foram repetidos neste commit. Permanecem evidências **anteriores**
  distintas (PG17 local, 114 testes no staging, pooler).

Este checklist foi atualizado após a abertura do PR, em commit
**exclusivamente documental**. Não declarar o novo HEAD como tendo
sido retestado até que exista saída real de novo teste.

## 5. Comandos para o operador executar localmente (Git Bash)

```bash
git branch --show-current
git status --short
git pull --ff-only
git log -1 --format="%H"
git diff --check main...HEAD
bash supabase/tests/testar-banco.sh
```

O teste `testar-banco.sh` roda localmente com PGlite, a partir das
migrations versionadas, sem acessar staging e sem exigir segredo.
Compartilhar com a equipe apenas saída resumida, total de testes,
pass/fail e commit; **não** colar senhas nem arquivos `.env`.

Para repetir o teste completo com **PostgreSQL 17 real** incluindo
concorrência/roles, seguir `supabase/tests/README.md` em ambiente
local **descartável** configurado e aprovado. Não executar
`apply-clean.mjs` nem `test-role-login.mjs` contra staging.

## 6. Contratos para o Goran

- `supabase/tests/CONTRATO_SQL_AUTENTICACAO.md`:
  matrícula/PIN, sessão, papel técnico, grants e erros.
- `supabase/tests/CONTRATO_CHG_REC_SCANNER.md`:
  assinatura, retorno idempotente, CHG→REC na mesma transação,
  scanner e duplicidade de NF-e.
- `supabase/tests/MAPEAMENTO_LEGADO_E_RASCUNHOS.md`:
  colunas, códigos antigos, status, itens, anexos, rascunhos e importação.
- `supabase/tests/HANDOFF_BACKEND_MATRICULA_PIN.md` e
  `supabase/tests/CONTRATO_MATRICULA_PIN.md`:
  evidência de conexões e demais regras.
- `supabase/ARQUITETURA_ATUAL_2026-10-15.md`:
  decisão de Supabase principal, Sheets legado, Drive e
  desenvolvimento local sem Vercel.

**Pontos aguardando alinhamento funcional / teste de integração:**

1. Política do PIN, recuperação e criação do primeiro administrador.
2. `pedido_compra`, `tipo_recebimento_id`, `fornecedor_id`
   no mesmo commit da conversão CHG→REC, política de retry divergente
   e eventual ano do código REC se a CHG for de ano anterior.
3. Scanner: método real do decoder vencedor vs origem genérica;
   origem manual, confiança global da CHG vs confiança por campo.
4. Segunda CHG com a mesma chave NF-e: índice único atual a bloqueia;
   decidir regra para entrega parcial antes de propor flexibilização.
5. Itens incompletos em rascunho após recarregar a página; conteúdo
   histórico com quantidade 0; diferença entre `arquivado` e exclusão.
6. Plano de migração e reconciliação dos dados Sheets existentes, com
   arquivos Drive e autoria.

Nenhum item acima justifica **por si só** aplicar migration agora.
Se uma decisão demandar mudança do schema, propor migration,
impacto nos dados, teste local e rollback antes de qualquer execução.

## 7. Checklist de entrega e revisão do PR #2

- [x] Um único branch com base e auditoria; escopo de arquivos revisado
  na comparação anterior.
- [x] Aprovação da equipe para workflow e manutenção do legado.
- [x] Contratos SQL e pendências funcionais documentados.
- [x] 12 migrations registradas no staging em conferência anterior.
- [x] Reteste PGlite do commit `8b92ba5` registrado: 137 testes SQL,
  11 migrations de domínio aprovadas; limitações explicitadas acima.
- [x] `git diff --check main...HEAD` sem erros e branch limpa antes
  do fast-forward para o commit testado.
- [x] Comparação `main...8b92ba5` conferida: 78 commits à frente,
  0 atrás, apenas arquivos autorizados; não havia PR duplicado.
- [x] **PR #2 aberto** para revisão, com diff, testes reais,
  limitações do CI, migrations aplicadas e contratos.
- [ ] Revisão da equipe e aprovação de merge; **não** fazer merge
  automaticamente nem reaplicar migrations por causa do merge.
- [ ] Se houver mudanças de SQL ou código após `8b92ba5`, retestar
  no novo commit antes do merge; esta atualização apenas documental
  não equivale a novo teste.
