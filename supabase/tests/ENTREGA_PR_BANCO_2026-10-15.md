# ALM — checklist de handoff e PR consolidado do banco

**Data de conferência:** 15/10/2026.
**Destino autorizado para revisão:** `main`. **Não fazer merge automático**.
**Branch de origem:** `audit/alm-pin-login-pg17-20261015`.
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

## 2. Conferência do GitHub (registrada antes do PR)

| Comparação | Resultado observado |
|---|---|
| `main...` branch de auditoria | Branch de auditoria 71 commits à frente e 0 atrás na conferência de 15/10, **antes destes novos documentos** |
| `supabase-kobner-clean...` auditoria | Auditoria 19 commits à frente e 0 atrás **antes destes novos documentos** |
| Arquivos diff `main...` auditoria | Todos `supabase/`, com exceção apenas de `.github/workflows/alm-database-ci.yml` |
| Pull Requests abertos ao conferir | Nenhum naquele instante |

Os números mudam após commits de documentação; **refazer a comparação
no SHA final**, não copiar as contagens antigas para a descrição final.

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

## 4. Resultados anteriores verificados — não confundir com reteste final

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

**PENDENTE:** repetir a suíte local no commit final do PR e registrar
saída exata. Adições de documentação não executam automaticamente
qualquer teste. **Não marcar como concluído sem saída real.**

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

## 7. Checklist de liberação para criar o PR

- [x] Um único branch com base e auditoria; escopo de arquivos revisado
  na comparação anterior.
- [x] Aprovação da equipe para workflow e manutenção do legado.
- [x] Contratos SQL e pendências funcionais documentados.
- [x] 12 migrations registradas no staging em conferência anterior.
- [ ] Retestar commit final localmente e guardar saída.
- [ ] Confirmar `git diff --check main...HEAD` e branch limpa no commit
  final, sem arquivos adicionais fora do escopo.
- [ ] Confirmar nova comparação `main...` branch, HEAD e inexistência
  de PR duplicado.
- [ ] Abrir **um único PR para revisão**, anexando diff, testes reais,
  limitações do CI, migrations aplicadas, pendências e contrato.
- [ ] Aguardar revisão/merge autorizado pela equipe; **nunca**
  fazer push direto na `main`, nem aplicar migrations por merge.
