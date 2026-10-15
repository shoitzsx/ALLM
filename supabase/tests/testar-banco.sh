#!/usr/bin/env bash
# ALM: testes SQL em memoria (PGlite), sem Docker, credenciais ou staging.
# Execute na raiz do repo: bash supabase/tests/testar-banco.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: Node.js nao encontrado. Instale Node 24 e tente novamente." >&2
  exit 1
fi

# Reutiliza deps ja instaladas fora do repo; nunca altera packages da aplicacao.
if [[ -z "${ALM_DB_TEST_DEPS:-}" ]]; then
  if [[ -n "${LOCALAPPDATA:-}" ]]; then
    ALM_DB_TEST_DEPS="$LOCALAPPDATA/Temp/opencode"
  else
    ALM_DB_TEST_DEPS="${TMPDIR:-/tmp}/alm-db-deps"
  fi
  export ALM_DB_TEST_DEPS
fi

if ! node -e '
  const path=require("node:path");
  const {createRequire}=require("node:module");
  const req=createRequire(path.join(process.env.ALM_DB_TEST_DEPS,"package.json"));
  for (const name of ["@electric-sql/pglite","pg","libpg-query"]) req.resolve(name);
' >/dev/null 2>&1; then
  if command -v npm.cmd >/dev/null 2>&1; then
    NPM=npm.cmd
  elif command -v npm >/dev/null 2>&1; then
    NPM=npm
  else
    echo "ERRO: npm nao encontrado. Instale Node.js/npm." >&2
    exit 1
  fi
  echo "Instalando dependencias de testes na pasta temporaria (fora do repositorio)..."
  "$NPM" install --prefix "$ALM_DB_TEST_DEPS" --no-audit --no-fund \
    @electric-sql/pglite@0.5.10 pg libpg-query
fi

echo "ALM: testando migrations do zero e regras SQL no PGlite..."
node supabase/tests/run-database.mjs

echo "ALM: testes em memoria concluidos com sucesso."
echo "OBS: esta execucao nao substitui a instalacao limpa no PostgreSQL 17 real."
