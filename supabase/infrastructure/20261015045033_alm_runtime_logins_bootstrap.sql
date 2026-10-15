-- Infraestrutura de acesso ALM: sem segredos, sem contas humanas, sem grants diretos.
-- Somente Almoxarifado ALM staging, sob autorizacao explicita de 15/10/2026.
BEGIN;
DO $guards$
BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('server_version_num')::int < 170000
     OR current_setting('server_version_num')::int >= 180000
  THEN
    RAISE EXCEPTION 'Banco ou versao PostgreSQL inesperada';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('alm_runtime_api','alm_runtime_job')) THEN
    RAISE EXCEPTION 'Login runtime ja existe: nenhuma alteracao aplicada';
  END IF;
  IF (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('alm_api','alm_job')
        AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper) <> 2 THEN
    RAISE EXCEPTION 'Roles de permissao ALM estao divergentes';
  END IF;
  IF (SELECT count(*) FROM pg_auth_members am
      JOIN pg_roles r ON r.oid=am.roleid
      JOIN pg_roles m ON m.oid=am.member
      WHERE r.rolname IN ('alm_api','alm_job') AND m.rolname='postgres'
        AND am.admin_option) <> 2 THEN
    RAISE EXCEPTION 'postgres nao possui ADMIN OPTION esperado sobre alm_api e alm_job';
  END IF;
END
$guards$;

-- PASSWORD NULL impede autenticacao por senha ate configuracao privada posterior.
CREATE ROLE alm_runtime_api LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 5 PASSWORD NULL;

CREATE ROLE alm_runtime_job LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 2 PASSWORD NULL;

GRANT alm_api TO alm_runtime_api
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT alm_job TO alm_runtime_job
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
COMMIT;
