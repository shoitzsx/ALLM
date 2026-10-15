# Testes de banco ALM

Requisitos: Node 24 e dependências `libpg-query`, `@electric-sql/pglite`, `pg`.
Podem ser instaladas em uma pasta temporária, sem mudar os packages da aplicação:

```powershell
# Use uma pasta temporaria existente.
npm.cmd install --prefix "C:\Users\kobne\AppData\Local\Temp\opencode" libpg-query @electric-sql/pglite pg
$env:ALM_DB_TEST_DEPS = 'C:\Users\kobne\AppData\Local\Temp\opencode'
node supabase/tests/run-database.mjs
```

O modo padrão cria PostgreSQL PGlite em memória, aplica todas as migrations em ordem, insere um usuário v1 entre base e delta e verifica sua preservação.
Compara também a base com os quatro blocos SQL da seção 3 e as cópias do delta.
Executa `database.sql`, cuja transação termina em ROLLBACK. Os testes não
executam serviços externos: nomes de tipos de evento/estado são dados SQL.

## Comando unico recomendado (Git Bash)

Para validar **todas as migrations do zero no PGlite** e executar a suite SQL,
sem Docker, sem senha e sem acessar o Supabase:

```bash
bash supabase/tests/testar-banco.sh
```

O script reutiliza as dependencias temporarias de
`$LOCALAPPDATA/Temp/opencode` quando presentes; se faltarem, instala as
dependencias **fora do repositorio**. Falhas retornam codigo diferente de zero.
Pode ser executado antes de um commit ou de integrar a branch.

Este comando valida banco em memoria e **nao substitui**:
- concorrencia real em duas conexoes (ja testada separadamente no staging);
- instalacao limpa em PostgreSQL 17 real;
- a revisao do historico de migrations do staging.

O GitHub Actions automatico foi pausado enquanto a conta proprietaria
apresenta bloqueio de faturamento. O arquivo
`.github/workflows/alm-database-ci.yml` continua disponivel para execucao
manual **somente quando o GitHub Actions for desbloqueado**. Checks antigos
podem permanecer vermelhos, e esse ajuste nao os torna aprovados.

## Supabase local

Com Docker Desktop em execução, na raiz do repositório:

```powershell
npm.cmd exec --yes --package=supabase -- supabase --version
npm.cmd exec --yes --package=supabase -- supabase start
npm.cmd exec --yes --package=supabase -- supabase db reset --local
$env:ALM_DB_TEST_DEPS = 'C:\Users\kobne\AppData\Local\Temp\opencode'
node supabase/tests/run-database.mjs --local
```

A conexão padrão é `127.0.0.1:54322`, database `postgres`, usuário/senha
`postgres` para o ambiente local. `ALM_LOCAL_DATABASE_URL` permite mudar
porta/credenciais locais; o runner rejeita hosts não loopback.
O runner não aplica migrations no modo `--local`: isso é feito pelo reset.
Use a instância local descartável, com migrations aplicadas do zero.

Além dos testes SQL, o modo `--local` usa duas conexões para disputar o
numerador do ano reservado 9997. Verifica espera de lock e códigos distintos.
Essa fixture é confirmada para permitir a disputa e removida ao final; o
runner exige que o ano esteja vazio antes do teste. As demais fixtures SQL
são revertidas. Sequences/identities podem avançar mesmo após ROLLBACK.


## Supabase staging

Para testar o projeto real `Almoxarifado ALM` sem expor a senha no histórico
do terminal, use o modo `--staging`. O runner aceita somente hosts oficiais `*.pooler.supabase.com`, usa a identidade fixa do projeto `uxfstabcpvmujvzijyqw` e o database `postgres`. O host correto deve ser copiado da opção **Session pooler** do painel Supabase.

No Git Bash:

```bash
npm.cmd install --prefix "$LOCALAPPDATA/Temp/opencode" libpg-query @electric-sql/pglite pg
export ALM_DB_TEST_DEPS="$LOCALAPPDATA/Temp/opencode"
export ALM_STAGING_DB_HOST="aws-1-sa-east-1.pooler.supabase.com"
read -s -p "Senha do banco Supabase: " ALM_STAGING_DB_PASSWORD
echo
export ALM_STAGING_DB_PASSWORD
node supabase/tests/run-database.mjs --staging
unset ALM_STAGING_DB_PASSWORD
unset ALM_STAGING_DB_HOST
```

A senha e digitada de forma oculta e nao deve ser enviada para o chat, salva no
repositorio ou escrita diretamente na linha de comando. O modo staging nao
aplica migrations. Ele roda a suite SQL dentro de transacao com ROLLBACK e,
depois, abre duas conexoes PostgreSQL reais para disputar o numerador reservado
`9997`. O runner exige que esse ano esteja vazio e remove a fixture ao final.

## Sintaxe

O validador do projeto é `docs/alm2/sql/validate-sql.mjs`. Ele exige
`libpg-query` resolvível a partir da pasta do script. Conforme o seu cabeçalho,
pode ser copiado para a pasta temporária das dependências e executado de lá
com o caminho absoluto de cada SQL. Validar todas as migrations e
`supabase/tests/database.sql`.

## Limites

PGlite tem uma conexão e não substitui Supabase/Docker nem o teste concorrente.
O usuário v1 é validado no modo em memória; a suíte SQL local assume o schema
final, após reset. RLS é verificada tanto no catálogo quanto com uma role sem
policy, criada apenas dentro da transação de teste. Os grants são exercitados
com `SET LOCAL ROLE alm_api/alm_job`.

## Instalação limpa em PostgreSQL 17 (CI)

O workflow `.github/workflows/alm-database-ci.yml` foi preparado para usar
um container **PostgreSQL 17 novo**, isolado do Supabase de staging. Ele:

1. Instala dependências Node em pasta temporária.
2. Executa `supabase/tests/apply-clean.mjs`, que exige conexão **loopback**
   com o banco dedicado **`alm_ci_clean`**, sem schema `alm` e sem roles
   técnicas preexistentes. O script cria o schema `extensions` e a extensão
   `pgcrypto` para reproduzir as pré-condições do Supabase.
3. Aplica **todas** as migrations em ordem, preservando fixture v1 entre a
   base e o delta, e verifica integridade/RLS/membership de extensões.
4. Executa `run-database.mjs --local` com PostgreSQL real, incluindo
   `SET LOCAL ROLE alm_api` e `alm_job`, RLS e concorrência em duas conexões.

Esse fluxo **não acessa nem reseta o projeto Supabase**. A instalação
limpa em PostgreSQL 17 só pode ser considerada aprovada após uma execução
bem-sucedida em ambiente descartável, seja no workflow (quando desbloqueado),
seja em PostgreSQL local descartável. Até lá, o resultado continua **pendente**.

Para reproduzir em um PostgreSQL local descartável, crie previamente um
database vazio chamado `alm_ci_clean` e configure:

```bash
export ALM_DB_TEST_DEPS="$LOCALAPPDATA/Temp/opencode"
export ALM_LOCAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/alm_ci_clean"
node supabase/tests/apply-clean.mjs
node supabase/tests/run-database.mjs --local
unset ALM_LOCAL_DATABASE_URL
```

Não rode `apply-clean.mjs` em banco com dados: o script recusa hostname
não local, nome de banco diferente e schema/roles já existentes.

### Histórico do staging e revisão de segurança (15/10/2026)

A reconciliação das 10 versões anteriores com `supabase_migrations.schema_migrations`
no Supabase staging **já foi concluída** e verificada (10/10, checksums intactos).
A **11ª migration** `20261015030000_alm_seguranca_auth.sql` está na branch
`audit/alm-seguranca-auth-20261015` e **não foi aplicada no staging**.
Em 15/10/2026, passou na instalação limpa **PGlite (11/11 migrations)** e
**137 testes SQL**. No PostgreSQL 17.11 local descartável, a migration nova
foi aplicada **incrementalmente** sobre a instalação anterior, e novamente
**137 testes SQL mais concorrência real** foram aprovados. Falta apenas,
como validação complementar, a instalação limpa das 11 migrations em um
PostgreSQL 17 real vazio. Os 119 testes anteriores correspondiam às 10
migrations originais.

A revisão adiciona regressões para:
- `token_hash` de sessão com comprimento SHA-256 (32 bytes);
- função de trigger sem `EXECUTE` por `PUBLIC`;
- auditoria de PIN/algoritmo, expiração e bloqueio sem copiar hashes nem motivo;
- alterações operacionais (contadores/login) sem gerar auditoria duplicada;
- proibição de alterar metadados sensíveis sem ator transacional.

**Para rodar os testes da branch de revisão no seu computador:**

```bash
git fetch origin
git switch --track origin/audit/alm-seguranca-auth-20261015
bash supabase/tests/testar-banco.sh
```

Depois do teste em PGlite, ainda é necessário aprovar uma instalação limpa
**real PostgreSQL 17** em banco local descartável `alm_ci_clean`, com os
scripts `apply-clean.mjs` e `run-database.mjs --local` documentados acima.
O instalador recusa um banco que já tenha schema `alm`. Não executar
`apply-clean.mjs` em bancos reais, em outras bases nem no Supabase staging.
Não executar `supabase db push` até conclusão e aprovação da revisão.
