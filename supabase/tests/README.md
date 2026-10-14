# Testes de banco ALM

Requisitos: Node 24 e dependências `libpg-query`, `@electric-sql/pglite`, `pg`.
Podem ser instaladas em uma pasta temporária, sem mudar os packages da aplicação:

```powershell
# Use uma pasta temporaria existente.
npm.cmd install --prefix "C:\Users\kobne\AppData\Local\Temp\opencode" libpg-query @electric-sql/pglite pg
$env:ALM_DB_TEST_DEPS = 'C:\Users\kobne\AppData\Local\Temp\opencode'
node supabase/tests/run-database.mjs
```

O modo padrão cria PostgreSQL PGlite em memória, aplica base → delta →
integridade, insere um usuário v1 entre base e delta e verifica sua preservação.
Compara também a base com os quatro blocos SQL da seção 3 e as cópias do delta.
Executa `database.sql`, cuja transação termina em ROLLBACK. Os testes não
executam serviços externos: nomes de tipos de evento/estado são dados SQL.

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

## Sintaxe

O validador do projeto é `docs/alm2/sql/validate-sql.mjs`. Ele exige
`libpg-query` resolvível a partir da pasta do script. Conforme o seu cabeçalho,
pode ser copiado para a pasta temporária das dependências e executado de lá
com o caminho absoluto de cada SQL. Validar as três migrations e
`supabase/tests/database.sql`.

## Limites

PGlite tem uma conexão e não substitui Supabase/Docker nem o teste concorrente.
O usuário v1 é validado no modo em memória; a suíte SQL local assume o schema
final, após reset. RLS é verificada tanto no catálogo quanto com uma role sem
policy, criada apenas dentro da transação de teste. Os grants são exercitados
com `SET LOCAL ROLE alm_api/alm_job`.
