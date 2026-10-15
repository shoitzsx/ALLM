# Revisão das migrations ALM — status consolidado 15/10/2026

## Estado atual

Esta seção substitui o status operacional das rodadas históricas abaixo.

- Branch atual: `supabase-kobner-clean`.
- Staging real Supabase: `Almoxarifado ALM` (`uxfstabcpvmujvzijyqw`), PostgreSQL 17.11.
- 28 tabelas em `alm`; 28 com RLS ativa; 28 policies técnicas.
- Security Advisor: **0 alertas**.
- Todas as funções do schema `alm` têm `search_path` fixado.
- `pgcrypto`, `pg_trgm` e `unaccent` estão no schema `extensions`.
- Fluxo CHG -> REC atômico/idempotente aplicado, com unicidade CHG↔REC.
- Suíte real de staging: **96 testes SQL aprovados**.
- Concorrência real do numerador REC: **aprovada com duas conexões PostgreSQL**, com espera de lock e códigos distintos.
- Índices prioritários do MVP adicionados em duas rodadas; os avisos restantes de FKs sem índice são informativos e devem ser tratados conforme uso real.
- `SET ROLE alm_api/alm_job` não pode ser exercitado pelo usuário do Session pooler; grants continuam verificados por catálogo e o teste prático permanece reservado ao ambiente local/administrativo compatível.

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
- **Instalação limpa com PostgreSQL 17 real e troca de role nesse ambiente
  ainda não comprovadas**:
  a execução GitHub Actions falhou antes de registrar qualquer etapa,
  sem log disponível; não confundir configuração criada com teste aprovado.
- O histórico de versões Supabase no staging não corresponde a todos os
  prefixos temporais dos arquivos locais. Não executar `supabase db push`
  no staging até reconciliar explicitamente esse histórico.

### Pendências para fechamento do MVP

1. **Decidido e testado:** recebimento finalizado deve ser reaberto antes de exclusão/restauração lógica, sem exceção para perfis superiores; anexos de recebimento finalizado também são protegidos.
2. **Decidido e implementado:** arquivo em `PURGADO` não pode voltar ao estado físico anterior ou ser restaurado logicamente como ativo. Um novo upload deve criar um novo registro.
3. Validar `alm_api` e `alm_job` com `SET ROLE` em ambiente que permita role switching.
4. Antes da produção, aplicar as migrations do zero em banco limpo e conferir o histórico de migrations do ambiente alvo.
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
