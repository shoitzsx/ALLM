-- Bootstrap controlado do primeiro administrador.
-- Nao contem usuario, PIN, codigo de ativacao ou qualquer outro secret.
BEGIN;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alm_provisioner') THEN
    CREATE ROLE alm_provisioner NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'alm_provisioner'
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Role alm_provisioner existente possui atributos inseguros';
  END IF;
END
$role$;

-- O modelo de bootstrap e singleton. Se ja houver mais de um administrador,
-- a criacao do indice aborta toda a migration sem alterar parcialmente o banco.
CREATE UNIQUE INDEX uq_usuarios_administrador_unico
  ON alm.usuarios ((perfil)) WHERE perfil = 'ADMINISTRADOR';

CREATE FUNCTION alm.provisionar_primeiro_administrador(
  p_matricula text, p_nome text, p_pin_hash text, p_codigo_hash bytea,
  p_aprovacao text, p_request_id uuid, p_expira_em timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, alm
AS $function$
DECLARE
  v_usuario_id uuid;
  v_aprovacao text := btrim(p_aprovacao);
BEGIN
  IF p_matricula IS NULL OR p_matricula !~ '^[0-9A-Z]{3,20}$'
     OR p_nome IS NULL OR btrim(p_nome) = '' OR length(p_nome) > 200
     OR p_pin_hash IS NULL
        OR p_pin_hash !~ '^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$'
     OR p_codigo_hash IS NULL OR octet_length(p_codigo_hash) <> 32
     OR v_aprovacao IS NULL OR v_aprovacao !~ '^[A-Za-z0-9][A-Za-z0-9._:/ -]{2,117}[A-Za-z0-9]$'
     OR p_request_id IS NULL OR p_expira_em IS NULL
     OR p_expira_em <= clock_timestamp()
     OR p_expira_em > clock_timestamp() + interval '72 hours'
  THEN
    RAISE EXCEPTION 'Parametros de provisionamento invalidos' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('alm:first-administrator', 0));
  IF EXISTS (SELECT 1 FROM alm.usuarios WHERE perfil = 'ADMINISTRADOR') THEN
    RAISE EXCEPTION 'Primeiro administrador ja provisionado' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.usuario_id', '', true);
  PERFORM set_config('app.ator_sistema', 'provision-first-admin:' || v_aprovacao, true);
  PERFORM set_config('app.request_id', p_request_id::text, true);

  INSERT INTO alm.usuarios (matricula, nome, perfil, legado)
  VALUES (p_matricula, btrim(p_nome), 'ADMINISTRADOR', false)
  RETURNING id INTO v_usuario_id;
  INSERT INTO alm.credenciais_pin
    (usuario_id, pin_hash, algoritmo, pepper_versao, temporario, expira_em)
  VALUES (v_usuario_id, p_pin_hash, 'scrypt', 1, true, p_expira_em);
  INSERT INTO alm.autorizacoes_webauthn
    (usuario_id, finalidade, codigo_hash, autorizacao_externa, expira_em, request_id)
  VALUES (v_usuario_id, 'ATIVACAO', p_codigo_hash,
    'provisionamento-aprovado:' || v_aprovacao, p_expira_em, p_request_id);
  RETURN v_usuario_id;
END
$function$;

REVOKE ALL ON FUNCTION alm.provisionar_primeiro_administrador(
  text,text,text,bytea,text,uuid,timestamptz) FROM PUBLIC, alm_api, alm_job;
REVOKE ALL ON SCHEMA alm FROM alm_provisioner;
GRANT USAGE ON SCHEMA alm TO alm_provisioner;
GRANT EXECUTE ON FUNCTION alm.provisionar_primeiro_administrador(
  text,text,text,bytea,text,uuid,timestamptz) TO alm_provisioner;
COMMIT;
