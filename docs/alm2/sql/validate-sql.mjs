// Valida a SINTAXE de arquivos .sql com o parser real do PostgreSQL (libpg-query).
// Nao executa nada e nao substitui testar em um banco: pega erro de gramatica,
// incluindo o corpo PL/pgSQL de funcoes e blocos DO.
//
// Uso (fora do projeto, para nao poluir package.json). O Node resolve `import`
// a partir da pasta DO SCRIPT, nao da pasta atual: copie o script para o mesmo
// diretorio onde instalou a dependencia.
//   mkdir /tmp/sqlcheck && cd /tmp/sqlcheck && npm init -y && npm i libpg-query
//   cp <repo>/docs/alm2/sql/validate-sql.mjs .
//   node validate-sql.mjs <repo>/docs/alm2/sql/001_alm2_delta.sql
import fs from 'node:fs'
import * as pg from 'libpg-query'

const file = process.argv[2]
if (!file) { console.error('uso: node validate-sql.mjs <arquivo.sql>'); process.exit(2) }
const sql = fs.readFileSync(file, 'utf8')
if (pg.loadModule) await pg.loadModule()

let tree
try {
  tree = await pg.parse(sql)
} catch (e) {
  const pos = e.cursorPosition
  console.log('FALHA DE SINTAXE:', e.message, pos ? `(posicao ${pos})` : '')
  if (pos) console.log('trecho:', JSON.stringify(sql.slice(Math.max(0, pos - 80), pos + 80)))
  process.exit(1)
}
console.log('parse OK -', tree.stmts.length, 'statements')

let bad = 0
for (const s of tree.stmts) {
  const fn = s.stmt.CreateFunctionStmt
  const doStmt = s.stmt.DoStmt
  try {
    if (fn) {
      const lang = (fn.options || []).find((o) => o.DefElem?.defname === 'language')?.DefElem.arg.String.sval
      if (lang !== 'plpgsql') continue
      const start = s.stmt_location || 0
      await pg.parsePlPgSQL(sql.slice(start, start + (s.stmt_len || sql.length)))
    } else if (doStmt) {
      const body = doStmt.args.find((a) => a.DefElem.defname === 'as').DefElem.arg.String.sval
      await pg.parsePlPgSQL(`CREATE FUNCTION _t() RETURNS void LANGUAGE plpgsql AS $x$${body}$x$`)
    }
  } catch (e) {
    bad++
    console.log('FALHA em corpo plpgsql:', e.message)
  }
}
console.log(bad ? `RESUMO: ${bad} falha(s)` : 'RESUMO: tudo valido')
process.exit(bad ? 1 : 0)
