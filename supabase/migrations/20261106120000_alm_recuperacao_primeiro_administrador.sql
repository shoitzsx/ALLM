-- Recuperacao excepcional do primeiro administrador. Nunca reutilizar o bootstrap.
BEGIN;

ALTER TABLE alm.credenciais_webauthn ADD COLUMN revogado_ator_sistema text;
ALTER TABLE alm.credenciais_webauthn DROP CONSTRAINT ck_webauthn_revogacao;
ALTER TABLE alm.credenciais_webauthn ADD CONSTRAINT ck_webauthn_revogacao CHECK (
  (revogado_em IS NULL AND revogado_por IS NULL AND revogado_ator_sistema IS NULL AND motivo_revogacao IS NULL)
  OR (revogado_em IS NOT NULL AND (revogado_por IS NOT NULL) <> (revogado_ator_sistema IS NOT NULL)
      AND motivo_revogacao IS NOT NULL AND btrim(motivo_revogacao) <> '')
);
ALTER TABLE alm.autorizacoes_webauthn ADD COLUMN revogado_ator_sistema text;
ALTER TABLE alm.autorizacoes_webauthn DROP CONSTRAINT ck_webautorizacao_revogacao;
ALTER TABLE alm.autorizacoes_webauthn ADD CONSTRAINT ck_webautorizacao_revogacao CHECK (
  (revogado_em IS NULL AND revogado_por IS NULL AND revogado_ator_sistema IS NULL)
  OR (revogado_em IS NOT NULL AND (revogado_por IS NOT NULL) <> (revogado_ator_sistema IS NOT NULL))
);

CREATE OR REPLACE FUNCTION alm.validar_credencial_webauthn_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,alm AS $f$
BEGIN
  IF (NEW.usuario_id,NEW.credential_id,NEW.chave_publica_cose,NEW.algoritmo_cose,
      NEW.aaguid,NEW.transports,NEW.backup_eligible,NEW.metodo_cadastro,NEW.criado_em)
     IS DISTINCT FROM
     (OLD.usuario_id,OLD.credential_id,OLD.chave_publica_cose,OLD.algoritmo_cose,
      OLD.aaguid,OLD.transports,OLD.backup_eligible,OLD.metodo_cadastro,OLD.criado_em) THEN
    RAISE EXCEPTION 'Identidade e chave WebAuthn imutaveis';
  END IF;
  IF NEW.sign_count < OLD.sign_count THEN RAISE EXCEPTION 'Contador WebAuthn regressivo'; END IF;
  IF OLD.revogado_em IS NOT NULL AND
      (NEW.revogado_em,NEW.revogado_por,NEW.revogado_ator_sistema,NEW.motivo_revogacao) IS DISTINCT FROM
      (OLD.revogado_em,OLD.revogado_por,OLD.revogado_ator_sistema,OLD.motivo_revogacao) THEN
    RAISE EXCEPTION 'Revogacao WebAuthn irreversivel';
  END IF;
  IF OLD.revogado_em IS NULL AND NEW.revogado_em IS NOT NULL THEN
    IF NEW.revogado_por IS NOT NULL THEN
      IF nullif(current_setting('app.usuario_id',true),'') IS DISTINCT FROM NEW.revogado_por::text
         OR nullif(current_setting('app.ator_sistema',true),'') IS NOT NULL THEN
        RAISE EXCEPTION 'Revogacao exige ator humano correspondente';
      END IF;
    ELSIF nullif(current_setting('app.ator_sistema',true),'') IS DISTINCT FROM NEW.revogado_ator_sistema
      OR nullif(current_setting('app.usuario_id',true),'') IS NOT NULL
      OR nullif(current_setting('app.request_id',true),'') IS NULL THEN
      RAISE EXCEPTION 'Revogacao de sistema exige ator e request_id';
    END IF;
  END IF;
  RETURN NEW;
END;$f$;

CREATE OR REPLACE FUNCTION alm.validar_estado_autorizacao_web() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,alm AS $f$
BEGIN
  IF (NEW.usuario_id,NEW.finalidade,NEW.codigo_hash,NEW.autorizado_por,
      NEW.autorizacao_externa,NEW.criado_em,NEW.expira_em) IS DISTINCT FROM
     (OLD.usuario_id,OLD.finalidade,OLD.codigo_hash,OLD.autorizado_por,
      OLD.autorizacao_externa,OLD.criado_em,OLD.expira_em) THEN
    RAISE EXCEPTION 'Autorizacao WebAuthn imutavel';
  END IF;
  IF OLD.consumido_em IS NOT NULL AND NEW.consumido_em IS DISTINCT FROM OLD.consumido_em THEN
    RAISE EXCEPTION 'Autorizacao consumida nao pode ser reaberta';
  END IF;
  IF OLD.consumido_em IS NULL AND NEW.consumido_em IS NOT NULL
     AND (OLD.revogado_em IS NOT NULL OR OLD.expira_em <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Autorizacao revogada ou expirada';
  END IF;
  IF OLD.revogado_em IS NOT NULL AND
    (NEW.revogado_em,NEW.revogado_por,NEW.revogado_ator_sistema) IS DISTINCT FROM
    (OLD.revogado_em,OLD.revogado_por,OLD.revogado_ator_sistema) THEN
    RAISE EXCEPTION 'Revogacao de autorizacao irreversivel';
  END IF;
  IF OLD.revogado_em IS NULL AND NEW.revogado_em IS NOT NULL AND NEW.revogado_ator_sistema IS NOT NULL THEN
    IF nullif(current_setting('app.ator_sistema',true),'') IS DISTINCT FROM NEW.revogado_ator_sistema
       OR nullif(current_setting('app.usuario_id',true),'') IS NOT NULL
       OR nullif(current_setting('app.request_id',true),'') IS NULL THEN
      RAISE EXCEPTION 'Revogacao de sistema exige ator e request_id';
    END IF;
  END IF;
  RETURN NEW;
END;$f$;

CREATE TABLE alm.recuperacoes_primeiro_administrador (
  request_id uuid PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
  matricula text NOT NULL,
  incidente text NOT NULL CHECK (length(btrim(incidente)) BETWEEN 4 AND 120),
  operador_externo text NOT NULL CHECK (length(btrim(operador_externo)) BETWEEN 4 AND 120),
  executada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  nova_pepper_versao smallint NOT NULL CHECK (nova_pepper_versao >= 2),
  autorizacoes_revogadas integer NOT NULL,
  credenciais_revogadas integer NOT NULL,
  sessoes_revogadas integer NOT NULL,
  fluxos_cancelados integer NOT NULL,
  desafios_invalidados integer NOT NULL
);
ALTER TABLE alm.recuperacoes_primeiro_administrador ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_recuperacoes_imutaveis BEFORE UPDATE OR DELETE
  ON alm.recuperacoes_primeiro_administrador FOR EACH ROW
  EXECUTE FUNCTION alm.impedir_mutacao_historico();
CREATE TRIGGER trg_recuperacoes_sem_truncate BEFORE TRUNCATE
  ON alm.recuperacoes_primeiro_administrador FOR EACH STATEMENT
  EXECUTE FUNCTION alm.impedir_mutacao_historico();
REVOKE ALL ON alm.recuperacoes_primeiro_administrador FROM PUBLIC,alm_api,alm_job,alm_provisioner;

CREATE FUNCTION alm.recuperar_primeiro_administrador(
  p_usuario_id uuid,p_matricula text,p_pin_hash text,p_codigo_hash bytea,
  p_pepper_versao smallint,p_expira_em timestamptz,p_incidente text,
  p_operador_externo text,p_request_id uuid
) RETURNS alm.recuperacoes_primeiro_administrador
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,alm,pg_temp AS $f$
DECLARE
  v_usuario alm.usuarios%ROWTYPE;
  v_reg alm.recuperacoes_primeiro_administrador%ROWTYPE;
  v_ator text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_usuario_id IS NULL OR p_matricula IS NULL OR p_matricula !~ '^[0-9A-Z]{3,20}$'
    OR p_pin_hash IS NULL OR p_pin_hash !~ '^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$'
    OR p_codigo_hash IS NULL OR octet_length(p_codigo_hash) <> 32
    OR p_pepper_versao IS NULL OR p_pepper_versao < 2
    OR p_expira_em IS NULL OR p_expira_em <= v_now OR p_expira_em > v_now + interval '72 hours'
    OR p_incidente IS NULL OR p_incidente !~ '^[A-Za-z0-9][A-Za-z0-9._:/ -]{2,117}[A-Za-z0-9]$'
    OR p_operador_externo IS NULL OR p_operador_externo !~ '^[A-Za-z0-9][A-Za-z0-9._:/ -]{2,117}[A-Za-z0-9]$'
    OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Parametros de recuperacao invalidos' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM alm.recuperacoes_primeiro_administrador WHERE request_id=p_request_id) THEN
    RAISE EXCEPTION 'Request_id ja aplicado; interrompa e investigue, nao repita' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_usuario FROM alm.usuarios WHERE id=p_usuario_id FOR UPDATE;
  IF NOT FOUND OR v_usuario.matricula <> p_matricula OR v_usuario.perfil <> 'ADMINISTRADOR'
     OR NOT v_usuario.ativo THEN
    RAISE EXCEPTION 'Administrador alvo nao confere' USING ERRCODE='P0001';
  END IF;
  PERFORM 1 FROM alm.credenciais_pin WHERE usuario_id=p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credencial PIN ausente' USING ERRCODE='P0001'; END IF;
  v_ator := 'recuperacao:' || p_operador_externo;
  PERFORM set_config('app.usuario_id','',true);
  PERFORM set_config('app.ator_sistema',v_ator,true);
  PERFORM set_config('app.request_id',p_request_id::text,true);

  UPDATE alm.desafios_webauthn SET consumido_em=v_now
    WHERE usuario_id=p_usuario_id AND consumido_em IS NULL AND expira_em>v_now;
  GET DIAGNOSTICS v_reg.desafios_invalidados=ROW_COUNT;
  UPDATE alm.fluxos_auth_parcial SET cancelado_em=v_now
    WHERE usuario_id=p_usuario_id AND consumido_em IS NULL AND cancelado_em IS NULL;
  GET DIAGNOSTICS v_reg.fluxos_cancelados=ROW_COUNT;
  UPDATE alm.autorizacoes_webauthn SET revogado_em=v_now,revogado_ator_sistema=v_ator
    WHERE usuario_id=p_usuario_id AND consumido_em IS NULL AND revogado_em IS NULL;
  GET DIAGNOSTICS v_reg.autorizacoes_revogadas=ROW_COUNT;
  -- A revogacao de passkey tambem revoga sessoes pelo trigger existente.
  -- Contar antes evita subestimar o total no registro do incidente.
  SELECT count(*)::int INTO v_reg.sessoes_revogadas FROM alm.sessoes
    WHERE usuario_id=p_usuario_id AND revogada_em IS NULL;
  UPDATE alm.credenciais_webauthn SET revogado_em=v_now,revogado_ator_sistema=v_ator,
    motivo_revogacao='Recuperacao administrativa: ' || p_incidente
    WHERE usuario_id=p_usuario_id AND revogado_em IS NULL;
  GET DIAGNOSTICS v_reg.credenciais_revogadas=ROW_COUNT;
  UPDATE alm.sessoes SET revogada_em=v_now,motivo_revogacao='ADMIN_RECOVERY'
    WHERE usuario_id=p_usuario_id AND revogada_em IS NULL;
  UPDATE alm.credenciais_pin SET pin_hash=p_pin_hash,algoritmo='scrypt',
    pepper_versao=p_pepper_versao,temporario=true,expira_em=p_expira_em,
    definido_em=v_now,definido_por=NULL,falhas_consecutivas=0,ultima_falha_em=NULL,
    bloqueado_ate=NULL,bloqueado_em=NULL,motivo_bloqueio=NULL
    WHERE usuario_id=p_usuario_id;
  INSERT INTO alm.autorizacoes_webauthn
    (usuario_id,finalidade,codigo_hash,autorizacao_externa,expira_em,request_id)
  VALUES (p_usuario_id,'ATIVACAO',p_codigo_hash,
    'recuperacao:' || p_incidente || ':operador:' || p_operador_externo,p_expira_em,p_request_id);
  INSERT INTO alm.eventos_autenticacao
    (tipo,usuario_id,matricula_informada,sucesso,motivo,request_id)
  VALUES ('PIN_REDEFINIDO',p_usuario_id,p_matricula,true,'ADMIN_RECOVERY',p_request_id);
  INSERT INTO alm.recuperacoes_primeiro_administrador
    (request_id,usuario_id,matricula,incidente,operador_externo,nova_pepper_versao,
     autorizacoes_revogadas,credenciais_revogadas,sessoes_revogadas,fluxos_cancelados,desafios_invalidados)
  VALUES (p_request_id,p_usuario_id,p_matricula,p_incidente,p_operador_externo,p_pepper_versao,
    v_reg.autorizacoes_revogadas,v_reg.credenciais_revogadas,v_reg.sessoes_revogadas,
    v_reg.fluxos_cancelados,v_reg.desafios_invalidados)
  RETURNING * INTO v_reg;
  RETURN v_reg;
END;$f$;
REVOKE ALL ON FUNCTION alm.recuperar_primeiro_administrador(
  uuid,text,text,bytea,smallint,timestamptz,text,text,uuid) FROM PUBLIC,alm_api,alm_job;
GRANT EXECUTE ON FUNCTION alm.recuperar_primeiro_administrador(
  uuid,text,text,bytea,smallint,timestamptz,text,text,uuid) TO alm_provisioner;

CREATE FUNCTION alm.verificar_recuperacao_primeiro_administrador(p_request_id uuid,p_usuario_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,alm,pg_temp AS $f$
DECLARE v_reg alm.recuperacoes_primeiro_administrador%ROWTYPE;
BEGIN
  SELECT * INTO v_reg FROM alm.recuperacoes_primeiro_administrador
    WHERE request_id=p_request_id AND usuario_id=p_usuario_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied',false); END IF;
  RETURN jsonb_build_object('applied',true,'safe',
    EXISTS(SELECT 1 FROM alm.usuarios WHERE id=p_usuario_id AND matricula=v_reg.matricula
      AND perfil='ADMINISTRADOR' AND ativo=true)
    AND EXISTS(SELECT 1 FROM alm.credenciais_pin WHERE usuario_id=p_usuario_id
      AND pepper_versao=v_reg.nova_pepper_versao AND temporario=true AND expira_em>clock_timestamp())
    AND (SELECT count(*)=1 FROM alm.autorizacoes_webauthn WHERE usuario_id=p_usuario_id
      AND consumido_em IS NULL AND revogado_em IS NULL)
    AND EXISTS(SELECT 1 FROM alm.autorizacoes_webauthn WHERE usuario_id=p_usuario_id
      AND consumido_em IS NULL AND revogado_em IS NULL AND request_id=p_request_id
      AND finalidade='ATIVACAO' AND expira_em>clock_timestamp())
    AND NOT EXISTS(SELECT 1 FROM alm.credenciais_webauthn WHERE usuario_id=p_usuario_id AND revogado_em IS NULL)
    AND NOT EXISTS(SELECT 1 FROM alm.sessoes WHERE usuario_id=p_usuario_id AND revogada_em IS NULL)
    AND NOT EXISTS(SELECT 1 FROM alm.fluxos_auth_parcial WHERE usuario_id=p_usuario_id
      AND consumido_em IS NULL AND cancelado_em IS NULL),
    'usuarioId',v_reg.usuario_id,'requestId',v_reg.request_id,
    'pepperVersion',v_reg.nova_pepper_versao,
    'authorizationsRevoked',v_reg.autorizacoes_revogadas,
    'credentialsRevoked',v_reg.credenciais_revogadas,
    'sessionsRevoked',v_reg.sessoes_revogadas,
    'flowsCancelled',v_reg.fluxos_cancelados,
    'challengesInvalidated',v_reg.desafios_invalidados);
END;$f$;
REVOKE ALL ON FUNCTION alm.verificar_recuperacao_primeiro_administrador(uuid,uuid)
  FROM PUBLIC,alm_api,alm_job;
GRANT EXECUTE ON FUNCTION alm.verificar_recuperacao_primeiro_administrador(uuid,uuid)
  TO alm_provisioner;
COMMIT;
