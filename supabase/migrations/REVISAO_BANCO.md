# Revisão das migrations ALM — status consolidado 15/10/2026

## Hardening de segurança validado localmente (15/10/2026)

Foi criada a
11ª migration `20261015030000_alm_seguranca_auth.sql`, após as 10 já
reconciliadas no staging. O ajuste revoga `EXECUTE PUBLIC` de uma função de
trigger, exige token de sessão SHA-256 com **32 bytes** e amplia a auditoria
só de campos sensíveis de PIN e bloqueio, sem copiar o hash ou o texto do
motivo. A suíte SQL de regressão foi ampliada na mesma branch.

**Validação completa aprovada em 15/10/2026:**
- PGlite: **11/11 migrations instaladas do zero**, **137 testes SQL aprovados**.
- PostgreSQL **17.11 real**, instância **isolada** em `127.0.0.1:55433`:
  banco novo `alm_ci_clean`, **11/11 migrations instaladas do zero** via
  `apply-clean.mjs`; **28 tabelas, RLS em 28, roles e usuário legado v1**
  preservados. `run-database.mjs --local` aprovou **137 testes SQL** e
  **concorrência real entre duas conexões**, com espera de lock e códigos
  distintos; extensões `pg_trgm`, `pgcrypto` e `unaccent` em `extensions`.
- Também foi aprovada a aplicação **incremental** da 11ª migration sobre o
  banco local descartável anteriormente preparado.

**Implantação no Supabase staging concluída em 15/10/2026** (projeto
`Almoxarifado ALM`, ID `uxfstabcpvmujvzijyqw`, PostgreSQL 17.11):
- Aplicada exclusivamente a migration `20261015030000_alm_seguranca_auth.sql`
  com a ferramenta de migrations. O histórico gerado automaticamente recebeu
  versão distinta; foi corrigido **somente o registro novo**, com validações
  transacionais. Agora há **11/11 versões e nomes correspondentes ao GitHub**.
- Backup **pontual pré-migration** (função original de auditoria, ACL de trigger,
  contagens e histórico) e roteiro de rollback preservados fora do repositório.
  Não constitui cópia `pg_dump` integral do banco.
- Pré-validação: nenhuma sessão ou credencial PIN existente; 28 tabelas com RLS.
- Pós-validação: **114 testes SQL aprovados no staging**, executados em
  transação com `ROLLBACK`; os **23 testes restantes de role** foram
  aprovados no PostgreSQL 17.11 local (total da suíte: **137**).
- Concorrência real (duas conexões) aprovada anteriormente no staging e na
  instalação limpa PostgreSQL 17.11 local.
- Integridade: as **10 migrations anteriores intactas**, por versão e MD5
  do SQL registrado; 11ª migration conferida por versão, nome e MD5;
  28/28 tabelas com RLS; nenhuma sessão, PIN ou fixture de teste persistida;
  `ck_sessoes_token_hash_32` validada; permissão `EXECUTE PUBLIC` revogada.
- Security Advisor pós-migration: **0 alertas**.

**Escopo restante:** integração real do backend, regras definitivas de PIN e
sessão com a equipe e automação do GitHub Actions (ainda bloqueada).

## Estado atual

Esta seção substitui o status operacional das rodadas históricas abaixo.

- Branch atual: `supabase-kobner-clean`.
- Staging real Supabase: `Almoxarifado ALM` (`uxfstabcpvmujvzijyqw`), PostgreSQL 17.11.
- 28 tabelas em `alm`; 28 com RLS ativa; 28 policies técnicas.
- Security Advisor: **0 alertas**.
- Todas as funções do schema `alm` têm `search_path` fixado.
- `pgcrypto`, `pg_trgm` e `unaccent` estão no schema `extensions`.
- Fluxo CHG -> REC atômico/idempotente aplicado, com unicidade CHG↔REC.
- Suíte real de staging: **114 testes SQL aprovados** após a 11ª migration (96 no marco anterior).
- Concorrência real do numerador REC: **aprovada com duas conexões PostgreSQL**, com espera de lock e códigos distintos.
- Índices prioritários do MVP adicionados em duas rodadas; os avisos restantes de FKs sem índice são informativos e devem ser tratados conforme uso real.
- No staging, o usuário do Session pooler não pode assumir `alm_api`/`alm_job`; **o teste prático de ambas as roles foi aprovado no PostgreSQL 17.11 local**, usando `SET LOCAL ROLE`.

### Migrations atuais

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
11. `20261015030000_alm_seguranca_auth.sql` — aplicada e verificada no staging

### Auditoria de instalação limpa (15/10/2026)

- Detectado no staging que `alm_api` e `alm_job` não tinham `USAGE`
  no schema `extensions` após mover a extensão `unaccent`.
  Isso afetaria funções normalizadoras `SECURITY INVOKER`.
- Criada e aplicada a migration
  `20261015024500_alm_extensions_role_usage.sql`, com
  `GRANT USAGE ON SCHEMA extensions TO alm_api, alm_job`.
  Catálogo do PostgreSQL confirmou o acesso de ambas as roles.
- Suíte transacional de staging ampliada: **96 testes SQL aprovados**
  (exclui blocos `SET ROLE` indisponíveis ao usuário do pooler).
- Preparado instalador isolado `supabase/tests/apply-clean.mjs` e workflow
  `.github/workflows/alm-database-ci.yml` usando PostgreSQL 17
  descartável, testes reais de `SET ROLE` e disputa de numerador.
- **Instalação limpa com PGlite comprovada em 15/10/2026:** usuário executou
  `node supabase/tests/run-database.mjs` após atualizar a branch.
  As **10 migrations foram aplicadas em ordem, do zero**, usuário v1 foi
  preservado sem alteração de matrícula/versão, e **119 testes SQL passaram**,
  incluindo os blocos `SET LOCAL ROLE` no emulador PGlite 0.5.10
  (PostgreSQL 18.6 WASM). Extensões observadas no PGlite: `pg_trgm` e
  `unaccent` em `extensions`, `pgcrypto` em `public` — diferença
  ambiental do staging, onde as três estão em `extensions`.
- **Instalação limpa com PostgreSQL 17.11 real APROVADA (Windows x86-64):**
  banco local descartável `alm_ci_clean`; execução de
  `node supabase/tests/apply-clean.mjs` aplicou **10/10 migrations** sem erros,
  confirmou **28 tabelas com RLS**, preservação do usuário v1 e acesso
  das roles ao schema `extensions`.
  Depois, `node supabase/tests/run-database.mjs --local` aprovou
  **119 testes SQL**, inclusive os blocos reais de `SET LOCAL ROLE alm_api`
  e `alm_job`, e a **concorrência real com duas conexões**, incluindo espera
  por lock e códigos REC distintos. Versão confirmada:
  `PostgreSQL 17.11 on x86_64-windows`; `pg_trgm`, `pgcrypto` e
  `unaccent` observadas em `extensions`.
  O GitHub Actions permanece bloqueado por faturamento, mas isso **não impede**
  considerar o teste local real aprovado.
- **Histórico de migrations reconciliado no staging em 15/10/2026:**
  9 identificadores de versão foram alinhados aos arquivos locais;
  `alm_integridade` já coincidia e foi preservada. As 10 versões,
  nomes e checksums do SQL registrado foram conferidos após a transação.
  Não houve reaplicação de migrations nem alteração do schema de negócio.

### Validacao manual simplificada (15/10/2026)

- Adicionado `supabase/tests/testar-banco.sh`. O comando
  `bash supabase/tests/testar-banco.sh` executa a suite completa no PGlite
  e instala, se necessario, as dependencias em pasta temporaria fora do repo.
- O disparo automatico por `push` foi removido do workflow
  `.github/workflows/alm-database-ci.yml` enquanto a conta proprietaria
  estiver bloqueada para GitHub Actions por faturamento.
  `workflow_dispatch` permanece, mas tambem depende do desbloqueio.
- Isso evita novas falhas automaticas em `push`, sem alterar os checks
  antigos ou simular aprovacao da CI. A instalação limpa com PostgreSQL 17
  real foi **aprovada manualmente**, conforme evidência acima.
- Processo provisório: executar testes manuais antes de integrar
  alteracoes de banco e registrar os resultados. A **reconciliação do
  histórico no staging foi concluída**; a instalação limpa no PostgreSQL 17
  local também está aprovada. A CI segue indisponível por faturamento.

### Reconciliação do histórico do Supabase staging (15/10/2026)

- Projeto **exclusivo**: `Almoxarifado ALM` (`uxfstabcpvmujvzijyqw`),
  PostgreSQL 17.11. Nenhum outro projeto foi alterado.
- Antes da intervenção: histórico com **10 registros**; **9 versões**
  divergiam dos nomes versionados dos arquivos GitHub. O SQL armazenado
  nesses nove registros era **exatamente igual** ao SQL versionado.
- Backup externo **JSON e CSV dos 10 registros**, incluindo `statements`,
  salvo e conferido por SHA-256 antes da alteração; manifesto e plano
  de reversão mantidos fora do repositório.
- `alm_integridade` já usava a versão `20261007160200`. Seu campo
  `statements` contém uma anotação da aplicação manual; os objetos de
  integridade relevantes foram verificados no catálogo, sem reaplicar SQL.
- A intervenção **excepcional**, com autorização expressa, atualizou
  **somente `version`** em 9 linhas da tabela interna
  `supabase_migrations.schema_migrations`, dentro de transação,
  com verificação prévia de contagem, nome e MD5 do SQL e validação posterior.
  Não adotar alteração direta nessa tabela como fluxo regular de deploy.
- Resultado remoto após COMMIT: **10/10 versões, nomes e MD5 conferidos;
  zero divergências**, **28 tabelas** no schema `alm`, **28 com RLS**.
  `statements` e `created_by` mantidos; nenhuma migration reaplicada.
- A partir daqui, novas migrations devem seguir o fluxo versionado e o
  histórico remoto deve ser conferido antes de qualquer `db push`.

### Pendências para fechamento do MVP

1. **Decidido e testado:** recebimento finalizado deve ser reaberto antes de exclusão/restauração lógica, sem exceção para perfis superiores; anexos de recebimento finalizado também são protegidos.
2. **Decidido e implementado:** arquivo em `PURGADO` não pode voltar ao estado físico anterior ou ser restaurado logicamente como ativo. Um novo upload deve criar um novo registro.
3. **Concluído:** `alm_api` e `alm_job` validadas com `SET LOCAL ROLE` no PostgreSQL 17.11 local.
4. **Concluído:** 10 migrations instaladas do zero no PostgreSQL 17 local e 10/10 versões reconciliadas no Supabase staging. Antes de futuros `db push`, conferir o vínculo e o histórico do ambiente destino; esta validação não autoriza push em outros ambientes.
5. Revisar novamente os índices após carga/uso real; não criar todos os índices sugeridos pelo linter sem evidência de consulta.

---

# Revisão das migrations ALM — 07/10/2026

**Estado atual (rodada 2):** os seis achados abaixo foram corrigidos na
`20261007160200_alm_integridade.sql`. A suíte versionada passou em **102 testes
SQL + 5 verificações do runner**, em PostgreSQL PGlite efêmero. Supabase local
foi tentado e está **bloqueado pela ausência de Docker/Podman**. Ver detalhes
na seção "Rodada 2" ao final. As seções anteriores preservam o registro da
primeira revisão; seus achados não devem ser interpretados como ainda abertos.

Base da revisão: branch `fix/vercel-api-routing`, HEAD
`ed0d2f3962c525cb32b39029e696af16ea15c1d3`.

## Arquivos e ordem

1. `20261007160000_alm_v1_base.sql`: concatenação dos **quatro blocos SQL
   da seção 3** de `ARQUITETURA_TECNICA_ALM.md`, na ordem original, com
   comentários de origem no cabeçalho. Nenhuma regra SQL da base foi alterada.
2. `20261007160100_alm2_delta.sql`: cópia idêntica do delta revisado em
   `docs/alm2/sql/001_alm2_delta.sql`.

Cada arquivo contém seu próprio `BEGIN`/`COMMIT`. A base cria tabelas,
funções, triggers, catálogos e roles `alm_api`/`alm_job` antes do delta.
O delta depende das funções de controle, auditoria, bloqueio e histórico da
base; os objetos referenciados existem na ordem correta. As funções
redefinidas mantêm as assinaturas dos triggers existentes. O seed de papéis
define ator de sistema antes de disparar a auditoria.

A base é destinada à criação inicial: não é idempotente e não deve ser
reaplicada a um schema v1 existente sem reconciliar o histórico de migrations.
Nenhuma reconciliação/aplicação em Supabase foi realizada nesta revisão.

## Correções solicitadas

- `usuarios.legado` é adicionado com `DEFAULT true` para preservar as linhas
  v1 sem matrícula, e imediatamente passa a `DEFAULT false` para novos
  inserts. Isso evita UPDATE de backfill e disparo de versão/auditoria.
- OIDC opcional, com CHECK que exige issuer e subject ambos NULL ou ambos
  não NULL. A unicidade existente do par é preservada.
- Portaria exige recebimento, data e autor juntos exclusivamente para
  `VINCULADA`. NF vazia ou composta só de espaços não identifica uma chegada;
  a identificação alternativa por chave NF-e continua válida.
- O job perde SELECT de credenciais e eventos de autenticação. Em sessões,
  pode ler apenas `id`, `ultimo_uso_em`, `ocioso_max_segundos`, `expira_em` e
  `revogada_em`, mantendo DELETE para limpeza. Não recebe `token_hash`,
  identidade do usuário, IP ou user-agent.
- A API recebe somente INSERT das colunas do evento na outbox (`tipo`,
  `entidade`, `entidade_id`, `recebimento_id`, `chave_idempotencia`, `payload`).
  Estado inicial e campos de processamento usam defaults; o job lê e altera
  a fila. A API não recebe privilégios sobre `espelho_sheets`.
  `ON CONFLICT DO NOTHING` funciona; `RETURNING` ou consulta à fila exigiriam
  leitura que deliberadamente não foi concedida.

## Validação realizada

- Validador existente: `docs/alm2/sql/validate-sql.mjs`, com `libpg-query`
  18.1.5 instalado fora do repositório. Parser PostgreSQL 18:
  **base: 107 statements; delta: 62 statements; SQL e PL/pgSQL válidos**.
- Comparação automática: base fiel aos quatro blocos da seção 3, delta
  idêntico à fonte revisada.
- Execução adicional inteiramente local em PostgreSQL 18.3, PGlite 0.5.8,
  WASM em memória, com `pgcrypto`, `unaccent` e `pg_trgm`. Nenhuma conexão
  de rede com banco, nenhum projeto Supabase, nenhum dado persistente real.
- Base executada; usuário v1 criado sem matrícula; delta executado; usuário
  preservado com `legado = true`, matrícula NULL e versão inalterada.
  Novo usuário matriculado criado com `legado = false`.
- **49 verificações transacionais aprovadas**: matrícula obrigatória para
  novos usuários por default; combinações de OIDC; todas as 24 combinações
  de status da Portaria e presença dos três campos de vínculo; NF NULL,
  vazia e espaços; identificação por chave; leituras proibidas do job;
  leitura/DELETE de sessões para limpeza; INSERT da API na outbox e proibição
  de SELECT/UPDATE/DELETE e de escolher estado inicial; processamento pelo
  job; acesso ao espelho restrito ao job.
- `git diff --check` aprovado. Dependências e scripts de teste temporários
  ficaram fora do repositório, em `C:\Users\kobne\AppData\Local\Temp\opencode`.

Isso valida sintaxe e a sequência em um PostgreSQL efêmero. Não confirma
versão, privilégios do executor, ACLs/default privileges, memberships das roles,
extensões ou configurações do Supabase real. O baseline documentado é PG 16+;
esta rodada usou o parser e runtime PG 18, não uma instância PG 16.

## Pendência explícita: `public.unaccent(...)`

As **seis chamadas** da seção 3 foram preservadas sem substituição:

| Função | Ocorrências | Linhas na arquitetura | Linhas na migration base |
|---|---:|---|---|
| `alm.normalizar_texto(text)` | 1 | 1075 | 658 |
| `alm.normalizar_identificador(text)` | 1 | 1091 | 674 |
| `alm.preparar_recebimento()` | 2 | 1179–1180 | 762–763 |
| `alm.preparar_item()` | 2 | 1192–1193 | 775–776 |

Elas aparecem também na migration base extraída; o delta não acrescenta
chamadas. A instalação local de teste colocou a extensão em `public`, apenas
para esse runtime efêmero. **O schema no Supabase real segue não confirmado.**

Consulta somente de leitura para uma futura confirmação autorizada
(não executada contra Supabase nesta revisão):

```sql
SELECT e.extname, n.nspname AS schema_extensao
FROM pg_catalog.pg_extension e
JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'unaccent';
```

Não assumir `extensions.unaccent(...)`. `CREATE EXTENSION IF NOT EXISTS`
não muda o schema de uma extensão previamente instalada.

## Outros achados — registro histórico da rodada 1

### Erro/bloqueio que pode quebrar a migration

- **Schema de unaccent divergente:** se `public.unaccent(text)` não existir,
  a criação das funções SQL de normalização na base falha. As funções
  PL/pgSQL de preparação também dependem dessa referência em runtime.
  Bloqueio de ambiente ainda pendente; não houve falha no runtime local.
- **Executor sem privilégios de DDL/roles/extensões:** a base precisa criar
  roles e extensões, e ambas as migrations precisam alterar os objetos.
  Esses privilégios não foram verificados no ambiente real.

Nenhum erro de sintaxe ou dependência que quebre a sequência base → delta
foi encontrado no ambiente efêmero usado.

### Riscos de segurança/integridade e defeitos funcionais

1. **Leitura de numeradores reintroduzida pelo delta.** O
   `GRANT SELECT ON ALL TABLES IN SCHEMA alm` devolve a API e job a leitura
   de `recebimento_numeradores`, que a base revoga. Não concede escrita,
   mas amplia acesso em relação à regra original. Recomenda-se revisar
   grants globais separadamente.
2. **Troca de pai contorna a proteção de finalizados.**
   `bloquear_mutacao_filho_finalizado()` consulta somente
   `NEW.recebimento_id` em UPDATE. Um filho pode sair de um pai finalizado
   para um pai aberto, se as demais FKs/constraints forem satisfeitas.
   `incrementar_versao_agregado()` também atualiza somente o novo pai.
   Recomenda-se validar/bloquear ambos e incrementar os agregados afetados.
3. **Filhos de registros históricos são bloqueados.** Para um recebimento
   `MIGRACAO`, o status é NULL. O teste
   `IF v_status <> 'CONFERIDO_FINALIZADO'` resulta em NULL e não retorna;
   a função termina levantando a exceção de recebimento finalizado.
   Isso não impede o DDL, mas impede o importador de inserir itens, arquivos
   e divergências nesses recebimentos. É defeito funcional herdado tanto
   pela base quanto pela função redefinida no delta.
4. **Recebimento finalizado não tem bloqueio geral de edição própria.**
   Os bloqueios se aplicam a filhos; `preparar_recebimento()` protege origem
   e código, e `validar_finalizacao_recebimento()` valida entrada em
   finalização, mas outros campos do próprio pai continuam alteráveis
   com status finalizado. A regra documentada de imutabilidade depende da
   aplicação nesses casos; recomenda-se discutir sua imposição no banco.
5. **Exclusão de filtros não é tudo-ou-nada.** `filtros_salvos` contém
   `excluido_em`, `excluido_por` e `motivo_exclusao`, sem o CHECK de coerência
   adotado nas tabelas de domínio. Permite autoria/motivo ausentes e estados
   parciais. Recomenda-se constraint equivalente em revisão futura.
6. **Unicidade de número de item fora da base solicitada.**
   `uq_itens_recebimento_numero_ativo` está na seção 4 da arquitetura,
   não na seção 3. Portanto, a sequência preparada permite números de item
   duplicados no mesmo recebimento. Recomenda-se migration separada para os
   índices da seção 4, incluindo essa regra de integridade.

### Melhorias opcionais

- Demais índices de busca/desempenho da seção 4 não fazem parte desta base.
  Planejar sua extração separadamente; a ausência deles não quebra o DDL.
- Preferir allowlists de leitura e sequência no delta em vez de grants
  globais, reduzindo futuras ampliações acidentais de privilégios.
- CHECKs adicionais para estados de sessão/outbox/armazenamento (ex. hash
  de sessão com 32 bytes e consistência de datas de processamento) podem
  reforçar contratos, mas exigem definição de regras operacionais.

Não houve commit, push, aplicação em banco real, restauração ou alteração
de projeto Supabase.

## Rodada 2 — integridade, soft delete e testes versionados

### Working tree e migrations

Todas as alterações locais da rodada 1 foram preservadas. Não houve troca de
branch ou descarte de arquivos. Ordem final:

1. `20261007160000_alm_v1_base.sql` — permanece fiel à seção 3;
2. `20261007160100_alm2_delta.sql` — preservado e idêntico à cópia documental;
3. `20261007160200_alm_integridade.sql` — nova migration defensiva.

A migration adicional concentra os seis ajustes, facilitando revisão e
evitando modificar a base extraída. O índice único de itens vem da seção 4:
é integridade e foi explicitamente incorporado nessa terceira migration.
Também foram adicionados índices parciais para recebimentos ativos e arquivos
ativos por recebimento. Os demais índices de performance da seção 4 continuam
fora desta rodada.

### Correção de cada achado

| Achado | Correção na terceira migration |
|---|---|
| Numerador exposto pelo grant global | REVOKE ALL da tabela para API/job, preservando EXECUTE do gerador SECURITY DEFINER |
| Troca de pai contorna finalizado | Locks e avaliação de OLD/NEW, ordenados por UUID; bloqueio se qualquer pai estiver finalizado; ambos os agregados recebem incremento quando há transferência |
| Status NULL bloqueia históricos | Comparação explícita `IS NOT DISTINCT FROM 'CONFERIDO_FINALIZADO'`: NULL não é finalizado |
| Edição do próprio finalizado | Novo guard BEFORE UPDATE, após preparação/controle/validação, exige reabertura isolada e proíbe alterações funcionais no estado finalizado |
| Exclusão parcial de filtros | CHECK com três NULL ou exclusão completa com motivo não vazio |
| Número de item duplicado | Índice único `(recebimento_id, numero_item) WHERE excluido_em IS NULL` |

A exceção técnica de arquivo não foi ampliada: permanece somente para ator
SISTEMA, UPDATE, mesma linha funcional e status de upload anteriormente
DISPONIVEL, mantendo DISPONIVEL ou passando a INCONSISTENTE. Como
`recebimento_id` não está na allowlist técnica, a exceção não transfere pai.

O guard de recebimento ignora somente controle (`alterado_em`, `alterado_por`,
`versao`) e colunas derivadas de busca. Na reabertura admite também `status`
e a mudança automática de `qualidade_dados` feita pelo trigger existente.
Quem pode reabrir continua sendo autorização da aplicação.

Os BEFORE triggers relevantes rodam por nome: controle → preparar → validar
finalização → `trg_recebimento_zz_bloquear_finalizado`. Auditoria e histórico
de status são AFTER e só persistem quando a operação inteira é aceita.

### Soft delete/restauração

Os CHECKs existentes de `recebimentos` e `arquivos` já implementavam
corretamente o padrão solicitado e foram preservados. Não foi criada função
de domínio, view ou policy de filtragem alternativa. A operação é um UPDATE
atômico, com ator definido na transação:

```sql
-- Excluir: motivo real, usuario real e id parametrizados pela aplicacao.
UPDATE alm.recebimentos
SET excluido_em = clock_timestamp(), excluido_por = $1, motivo_exclusao = $2
WHERE id = $3;

-- Restaurar: limpar os TRES campos na mesma operacao.
UPDATE alm.recebimentos
SET excluido_em = NULL, excluido_por = NULL, motivo_exclusao = NULL
WHERE id = $1;
```

O mesmo padrão vale para `alm.arquivos`. CHECKs rejeitam exclusão/restauração
parcial e motivo NULL/vazio/espaços. Exclusão de recebimento não altera seus
itens nem anexos; linhas, FKs, histórico de status e auditoria são preservados.
As roles técnicas não têm DELETE em dados de negócio. Nenhum cascade foi
introduzido.

Para arquivos, o UPDATE de exclusão pode também definir
`armazenamento_estado = 'QUARENTENA_PENDENTE'`. Não há trigger automático que
escolha estado físico ou enfileire integração. Restaurar o lógico **não**
marca automaticamente ATIVO: se o arquivo está EM_QUARENTENA, continua assim
até confirmação do job externo. O ENUM via CHECK preserva todos os estados
existentes; não foram inventadas transições nem um novo estado de restauração.

Pela proteção estrita solicitada para finalizados, exclusão/restauração
lógica também são alterações funcionais: o próprio recebimento finalizado e
seus filhos devem ser reabertos antes dessas alterações. A exceção SISTEMA
permite apenas as colunas técnicas já previstas, nunca os campos `excluido_*`.
Se a operação desejar excluir/restaurar sem reabrir, isso precisa de decisão
de negócio explícita e revisão posterior da proteção.

**Ocultação automática nas listagens normais também depende do
helper/repositório da aplicação previsto em docs/alm2/04-dados-auditoria-busca.md.**
O banco suporta `WHERE excluido_em IS NULL` com constraints e índices; não
oculta linhas automaticamente. SQL explícito continua podendo recuperar os
excluídos para administração/restauração.

### Supabase local: comandos e bloqueio

- CLI: `npm.cmd exec --yes --package=supabase -- supabase --version` →
  **2.120.0**. O executável global não estava no PATH.
- Configuração local criada em `supabase/config.toml`, project_id local,
  PostgreSQL **17 configurado**, sem serviços de API, Auth, Storage, Edge,
  Studio ou Analytics habilitados.
- `supabase start` via npm exec: **falhou** com
  `docker: command not found (podman also not found)`.
- `supabase db reset --local` via npm exec: **falhou** com
  `failed to inspect service`. Nenhuma migration foi aplicada por Supabase.
- Runner `--local`: **falhou** com `ECONNREFUSED 127.0.0.1:54322`.
- Não existe PostgreSQL Supabase local em execução neste ambiente; portanto
  **versão efetiva e schemas de extensões do Supabase local não puderam ser
  consultados**. Instalar/iniciar Docker Desktop e repetir os comandos é a
  pendência de ambiente. Nenhum comando remoto/link/push foi usado.

### Execução que foi possível e resultados

PostgreSQL **18.3 / PGlite 0.5.8**, WASM em memória, independente de Supabase:

- As três migrations executadas do zero em ordem, sem adaptação do SQL.
- `CREATE EXTENSION` e `CREATE ROLE` funcionaram nesse executor efêmero.
- Consulta a `pg_extension`: **unaccent, pg_trgm e pgcrypto em public**.
  `public.unaccent(...)` funcionou e permanece inalterado. Esse resultado
  não confirma instalação no Supabase local nem no ambiente real.
- **102 verificações SQL aprovadas** em `supabase/tests/database.sql`, com
  fixtures transacionais revertidas. Cobrem soft delete/restauração, estado
  físico preservado, consultas de ativos/excluídos, anexos e FKs preservados,
  histórico append-only, ausência de hashes e derivados na auditoria nova,
  os seis achados, OIDC, Portaria, roles/grants, outbox e RLS.
- **5 verificações adicionais do runner aprovadas:** fidelidade da base,
  identidade das cópias do delta, legado=true/matrícula NULL/versão inalterada
  para o usuário inserido entre base e delta. Total: **107**.
- RLS: todas as tabelas têm RLS/policy técnica, e uma role de teste com SELECT
  mas sem policy recebeu zero linhas. Grants exercitados com SET LOCAL ROLE.
- Geração de código exercitada sequencialmente como API e job. O runner
  implementa disputa com duas conexões para execução `--local`, mas **essa
  verificação concorrente permanece não executada por falta do serviço**.
- Parser do projeto, libpg-query 18.1.5: base **107 statements**, delta **62**,
  integridade **12**, suíte SQL **61**; SQL e PL/pgSQL aprovados.
- O validador passou a usar `process.exitCode` na saída final: encerramento
  abrupto de WASM com `process.exit()` provocava assert de handles no
  Node/Windows após reportar sintaxe válida. Correção puramente técnica;
  após o ajuste, as quatro validações encerraram normalmente.
- `git diff --check` aprovado. As duas cópias do delta permanecem iguais.

### Decisões pendentes/dependências

1. **Ambiente:** Docker/Podman para concluir start/reset/testes no Supabase
   local PG17 e executar concorrência real; não considerar PGlite substituto.
2. **Supabase real:** confirmar schema das extensões, privilégios do executor,
   default privileges/memberships/atributos das roles e exposição do schema.
3. **Goran:** filtro centralizado de excluídos, autorização, ator transacional,
   locks de pais em ordem consistente e coordenação do estado físico com
   o job externo. Nenhum backend foi alterado.
4. **Goran/Lucas:** eventual exceção de exclusão/restauração de finalizados
   sem reabertura e tratamento de restauração lógica após PURGADO. O banco
   não recupera bytes purgados nem define sozinho esses comportamentos.
5. **Fluxo externo:** confirmação física e entrega/enfileiramento do evento
   são contratos da aplicação/job. Não foi imposto um novo grafo completo
   de transições físicas sem definição desses contratos.
6. **Histórico v1:** auditorias antigas podem conter colunas derivadas; não
   foram reescritas. O teste da ausência de derivados cobre auditoria nova
   produzida após o delta, preservando o histórico append-only.

Não houve commit, push, conexão remota ou alteração fora da camada de banco.
