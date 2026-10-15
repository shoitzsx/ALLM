-- Funcoes SQL e triggers de alm usam extensions.unaccent como INVOKER.
-- As roles tecnicas precisam de USAGE no schema para executar essas chamadas.
-- Nao concede criacao de objetos nem acesso adicional a tabelas alm.
BEGIN;

GRANT USAGE ON SCHEMA extensions TO alm_api, alm_job;

COMMIT;
