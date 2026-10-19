-- ALM N-2 / WebAuthn. Dependencia: PR #2 @ da2ef653beda429f627323c86ae888c65977319a
-- Incremental; nao altera migrations existentes. NUNCA aplicar automaticamente em staging.
-- REVISAO REQUERIDA: todos os consumidores devem autenticar/autorizar no backend.
BEGIN;

-- Credenciais publicas. COSE_Key binaria validada por @simplewebauthn/server.
CREATE TABLE alm.credenciais_webauthn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
  credential_id bytea NOT NULL UNIQUE CHECK (octet_length(credential_id) BETWEEN 1 AND 1024),
  chave_publica_cose bytea NOT NULL CHECK (octet_length(chave_publica_cose) BETWEEN 1 AND 8192),
  algoritmo_cose integer NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  aaguid uuid,
  transports text[] NOT NULL DEFAULT '{}'::text[],
  backup_eligible boolean NOT NULL,
  backup_state boolean NOT NULL,
  nome_exibicao text NOT NULL DEFAULT 'Autenticador' CHECK (btrim(nome_exibicao) <> ''),
  metodo_cadastro varchar(20) NOT NULL CHECK (metodo_cadastro IN ('ATIVACAO','AUTENTICADA','RECUPERACAO')),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultimo_uso_em timestamptz,
  revogado_em timestamptz,
  revogado_por uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
  motivo_revogacao text,
  CONSTRAINT uq_webauthn_id_usuario UNIQUE (id,usuario_id),
  CONSTRAINT ck_webauthn_backup CHECK (NOT backup_state OR backup_eligible),
  CONSTRAINT ck_webauthn_revogacao CHECK (
    (revogado_em IS NULL AND revogado_por IS NULL AND motivo_revogacao IS NULL)
    OR (revogado_em IS NOT NULL AND revogado_por IS NOT NULL
        AND motivo_revogacao IS NOT NULL AND btrim(motivo_revogacao) <> '')
  )
);
CREATE INDEX ix_webauthn_usuario_ativo ON alm.credenciais_webauthn(usuario_id,id)
  WHERE revogado_em IS NULL;

CREATE TABLE alm.autorizacoes_webauthn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
  finalidade varchar(20) NOT NULL CHECK (finalidade IN ('ATIVACAO','RECUPERACAO')),
  codigo_hash bytea NOT NULL UNIQUE CHECK (octet_length(codigo_hash)=32),
  autorizado_por uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
  autorizacao_externa text,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  consumido_em timestamptz,
  revogado_em timestamptz,
  revogado_por uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
  request_id uuid,
  CONSTRAINT uq_webautorizacao_id_usuario_hash UNIQUE(id,usuario_id,codigo_hash),
  CONSTRAINT ck_webautorizacao_validade CHECK (expira_em>criado_em),
  CONSTRAINT ck_webautorizacao_responsavel CHECK
    (autorizado_por IS NOT NULL OR (autorizacao_externa IS NOT NULL AND btrim(autorizacao_externa) <> '')),
  CONSTRAINT ck_webautorizacao_fim CHECK (consumido_em IS NULL OR revogado_em IS NULL),
  CONSTRAINT ck_webautorizacao_revogacao CHECK
    ((revogado_em IS NULL AND revogado_por IS NULL) OR
     (revogado_em IS NOT NULL AND revogado_por IS NOT NULL))
);
CREATE INDEX ix_webautorizacao_aberta ON alm.autorizacoes_webauthn(usuario_id,expira_em)
  WHERE consumido_em IS NULL AND revogado_em IS NULL;

-- Nunca e sessao de negocio. Cookie de pre-MFA: somente SHA-256 no banco.
CREATE TABLE alm.fluxos_auth_parcial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  consumido_em timestamptz,
  cancelado_em timestamptz,
  request_id uuid,
  CONSTRAINT uq_fluxo_parcial_id_usuario_hash UNIQUE(id,usuario_id,token_hash),
  CONSTRAINT ck_fluxo_parcial_validade CHECK(expira_em>criado_em),
  CONSTRAINT ck_fluxo_parcial_fim CHECK(consumido_em IS NULL OR cancelado_em IS NULL)
);
CREATE INDEX ix_fluxo_parcial_pendente ON alm.fluxos_auth_parcial(usuario_id,expira_em)
  WHERE consumido_em IS NULL AND cancelado_em IS NULL;

-- Sessao final: colunas opcionais para compatibilidade com sessao legada.
-- Middleware N-2 rejeita toda sessao sem MFA completo. O CHECK protege
-- consistencia de linhas MFA; nao inserir pre-MFA em alm.sessoes.
ALTER TABLE alm.sessoes
  ADD COLUMN mfa_metodo varchar(20),
  ADD COLUMN mfa_verificado_em timestamptz,
  ADD COLUMN credencial_webauthn_id uuid,
  ADD CONSTRAINT uq_sessoes_id_usuario_hash UNIQUE(id,usuario_id,token_hash),
  ADD CONSTRAINT ck_sessoes_mfa_conjunto CHECK (
     (mfa_metodo IS NULL AND mfa_verificado_em IS NULL AND credencial_webauthn_id IS NULL)
     OR (mfa_metodo='WEBAUTHN' AND mfa_verificado_em IS NOT NULL AND credencial_webauthn_id IS NOT NULL)
  ),
  ADD CONSTRAINT fk_sessoes_webcred_titular FOREIGN KEY(credencial_webauthn_id,usuario_id)
    REFERENCES alm.credenciais_webauthn(id,usuario_id) ON DELETE RESTRICT;
CREATE INDEX ix_sessoes_webcred_ativa ON alm.sessoes(credencial_webauthn_id)
  WHERE revogada_em IS NULL AND credencial_webauthn_id IS NOT NULL;

-- Vínculo triplo protege todas as cerimonias:
-- AUTENTICACAO usa SHA-256 do cookie pre-MFA; REGISTRO autenticado usa
-- SHA-256 do cookie de sessao; ATIVACAO usa SHA-256 do token administrativo.
-- A API ainda deve exigir sessão MFA recente ou autorizacao ativa.
CREATE TABLE alm.desafios_webauthn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
  cerimonia varchar(20) NOT NULL CHECK(cerimonia IN ('AUTENTICACAO','REGISTRO')),
  challenge_hash bytea NOT NULL UNIQUE CHECK(octet_length(challenge_hash)=32),
  vinculo_fluxo_hash bytea NOT NULL CHECK(octet_length(vinculo_fluxo_hash)=32),
  fluxo_parcial_id uuid,
  sessao_id uuid,
  autorizacao_id uuid,
  rp_id text NOT NULL CHECK(btrim(rp_id)<>''),
  origem_esperada text NOT NULL CHECK(btrim(origem_esperada)<>''),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  consumido_em timestamptz,
  request_id uuid,
  CONSTRAINT fk_webdesafio_fluxo_titular_hash
    FOREIGN KEY(fluxo_parcial_id,usuario_id,vinculo_fluxo_hash)
    REFERENCES alm.fluxos_auth_parcial(id,usuario_id,token_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_webdesafio_sessao_titular_hash
    FOREIGN KEY(sessao_id,usuario_id,vinculo_fluxo_hash)
    REFERENCES alm.sessoes(id,usuario_id,token_hash) ON DELETE RESTRICT,
  CONSTRAINT fk_webdesafio_autorizacao_titular_hash
    FOREIGN KEY(autorizacao_id,usuario_id,vinculo_fluxo_hash)
    REFERENCES alm.autorizacoes_webauthn(id,usuario_id,codigo_hash) ON DELETE RESTRICT,
  CONSTRAINT ck_webdesafio_validade CHECK(expira_em>criado_em),
  CONSTRAINT ck_webdesafio_contexto CHECK(
    (cerimonia='AUTENTICACAO' AND fluxo_parcial_id IS NOT NULL
     AND sessao_id IS NULL AND autorizacao_id IS NULL)
    OR (cerimonia='REGISTRO' AND fluxo_parcial_id IS NULL
        AND ((sessao_id IS NOT NULL) <> (autorizacao_id IS NOT NULL)))
  )
);
CREATE INDEX ix_webdesafio_vinculo_pendente ON alm.desafios_webauthn(vinculo_fluxo_hash,expira_em)
  WHERE consumido_em IS NULL;
CREATE INDEX ix_webdesafio_expiracao ON alm.desafios_webauthn(expira_em);

-- Mudancas de estado sao monotônicas; hash, chave e titular sao imutaveis.
CREATE FUNCTION alm.validar_credencial_webauthn_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,alm AS $f$
BEGIN
  IF (NEW.usuario_id,NEW.credential_id,NEW.chave_publica_cose,NEW.algoritmo_cose,
      NEW.aaguid,NEW.transports,NEW.backup_eligible,NEW.metodo_cadastro,NEW.criado_em)
     IS DISTINCT FROM
     (OLD.usuario_id,OLD.credential_id,OLD.chave_publica_cose,OLD.algoritmo_cose,
      OLD.aaguid,OLD.transports,OLD.backup_eligible,OLD.metodo_cadastro,OLD.criado_em) THEN
    RAISE EXCEPTION 'Identidade e chave WebAuthn imutaveis';
  END IF;
  IF NEW.sign_count < OLD.sign_count THEN
    RAISE EXCEPTION 'Contador WebAuthn regressivo';
  END IF;
  IF OLD.revogado_em IS NOT NULL AND
      (NEW.revogado_em,NEW.revogado_por,NEW.motivo_revogacao) IS DISTINCT FROM
      (OLD.revogado_em,OLD.revogado_por,OLD.motivo_revogacao) THEN
    RAISE EXCEPTION 'Revogacao WebAuthn irreversivel';
  END IF;
  IF OLD.revogado_em IS NULL AND NEW.revogado_em IS NOT NULL THEN
    IF nullif(current_setting('app.usuario_id',true),'') IS DISTINCT FROM NEW.revogado_por::text THEN
      RAISE EXCEPTION 'Revogacao exige ator humano autenticado correspondente';
    END IF;
  END IF;
  RETURN NEW;
END;$f$;
CREATE TRIGGER trg_webcred_integridade BEFORE UPDATE ON alm.credenciais_webauthn
FOR EACH ROW EXECUTE FUNCTION alm.validar_credencial_webauthn_update();

-- Se sessao possui MFA, trava a credencial antes de INSERT, de modo que
-- revogacao concorrente jamais deixe uma sessao MFA nova ativa apos COMMIT.
-- Sessao legada sem MFA continua permitida pelo schema para manter os 137
-- testes existentes; o backend N-2 DEVE recusar essas sessoes nas rotas reais.
CREATE FUNCTION alm.validar_sessao_mfa() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,alm AS $f$
DECLARE v_revogada timestamptz;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.mfa_metodo='WEBAUTHN' THEN
      -- FOR SHARE conflita com UPDATE de revogacao da mesma credencial.
      SELECT revogado_em INTO v_revogada FROM alm.credenciais_webauthn
        WHERE id=NEW.credencial_webauthn_id AND usuario_id=NEW.usuario_id FOR SHARE;
      IF NOT FOUND OR v_revogada IS NOT NULL THEN
        RAISE EXCEPTION 'Credencial WebAuthn ausente ou revogada';
      END IF;
    END IF;
  ELSE
    IF (NEW.mfa_metodo,NEW.mfa_verificado_em,NEW.credencial_webauthn_id)
       IS DISTINCT FROM (OLD.mfa_metodo,OLD.mfa_verificado_em,OLD.credencial_webauthn_id)
       OR (OLD.revogada_em IS NOT NULL AND NEW.revogada_em IS NULL) THEN
      RAISE EXCEPTION 'MFA e revogacao da sessao imutaveis';
    END IF;
  END IF;
  RETURN NEW;
END;$f$;
CREATE TRIGGER trg_sessoes_validar_mfa BEFORE INSERT OR UPDATE ON alm.sessoes
FOR EACH ROW EXECUTE FUNCTION alm.validar_sessao_mfa();

-- Protecao independente do backend: UPDATE da credencial revoga suas sessoes
-- finais na MESMA transacao. Rollback de um lado reverte o outro.
CREATE FUNCTION alm.revogar_sessoes_da_credencial() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,alm AS $f$
BEGIN
  IF OLD.revogado_em IS NULL AND NEW.revogado_em IS NOT NULL THEN
    UPDATE alm.sessoes SET revogada_em=clock_timestamp(),
      motivo_revogacao='WEBAUTHN_REVOGADA'
     WHERE credencial_webauthn_id=NEW.id AND revogada_em IS NULL;
  END IF;
  RETURN NEW;
END;$f$;
CREATE TRIGGER trg_webcred_revogar_sessoes AFTER UPDATE OF revogado_em
ON alm.credenciais_webauthn FOR EACH ROW EXECUTE FUNCTION alm.revogar_sessoes_da_credencial();

-- Auditoria dedicada: nunca serializar COSE_Key, hashes ou identificadores.
CREATE FUNCTION alm.auditar_credencial_webauthn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,alm AS $f$
DECLARE v_ator text:=nullif(current_setting('app.usuario_id',true),'');
        v_sistema text:=nullif(current_setting('app.ator_sistema',true),'');
        v_antes jsonb; v_depois jsonb;
BEGIN
  IF TG_OP='UPDATE' AND NEW.nome_exibicao IS NOT DISTINCT FROM OLD.nome_exibicao
     AND NEW.revogado_em IS NOT DISTINCT FROM OLD.revogado_em THEN RETURN NEW; END IF;
  IF (v_ator IS NULL)=(v_sistema IS NULL) THEN
    RAISE EXCEPTION 'Exatamente um ator deve ser definido';
  END IF;
  IF TG_OP='UPDATE' THEN
    v_antes:=jsonb_build_object('nome_exibicao',OLD.nome_exibicao,
      'revogado_em',OLD.revogado_em,'revogado_por',OLD.revogado_por);
  END IF;
  v_depois:=jsonb_build_object('nome_exibicao',NEW.nome_exibicao,
    'revogado_em',NEW.revogado_em,'revogado_por',NEW.revogado_por);
  INSERT INTO alm.historico_alteracoes
    (recebimento_id,entidade,entidade_id,acao,usuario_id,ator_tipo,
      ator_identificador,request_id,dados_antes,dados_depois,campos_alterados)
  VALUES (NULL,'alm.credenciais_webauthn',NEW.id::text,
    CASE WHEN TG_OP='INSERT' THEN 'INSERCAO' ELSE 'ALTERACAO' END,
    v_ator::uuid,CASE WHEN v_ator IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END,
    coalesce(v_ator,v_sistema),nullif(current_setting('app.request_id',true),'')::uuid,
    v_antes,v_depois,
    CASE WHEN TG_OP='INSERT' THEN ARRAY['cadastro_webauthn']::text[]
         ELSE ARRAY['nome_exibicao','revogado_em']::text[] END);
  RETURN NEW;
END;$f$;
CREATE TRIGGER trg_webcred_auditoria AFTER INSERT OR UPDATE ON alm.credenciais_webauthn
FOR EACH ROW EXECUTE FUNCTION alm.auditar_credencial_webauthn();

CREATE FUNCTION alm.validar_estado_autorizacao_web() RETURNS trigger
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
    (NEW.revogado_em,NEW.revogado_por) IS DISTINCT FROM (OLD.revogado_em,OLD.revogado_por) THEN
    RAISE EXCEPTION 'Revogacao de autorizacao irreversivel';
  END IF;
  RETURN NEW;
END;$f$;
CREATE TRIGGER trg_webautorizacao_estado BEFORE UPDATE ON alm.autorizacoes_webauthn
FOR EACH ROW EXECUTE FUNCTION alm.validar_estado_autorizacao_web();

CREATE FUNCTION alm.auditar_autorizacao_webauthn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,alm AS $f$
DECLARE v_ator text:=nullif(current_setting('app.usuario_id',true),'');
        v_sistema text:=nullif(current_setting('app.ator_sistema',true),'');
BEGIN
  IF (v_ator IS NULL)=(v_sistema IS NULL) THEN RAISE EXCEPTION 'Exatamente um ator exigido'; END IF;
  IF TG_OP='UPDATE' AND NEW.consumido_em IS NOT DISTINCT FROM OLD.consumido_em
    AND NEW.revogado_em IS NOT DISTINCT FROM OLD.revogado_em THEN RETURN NEW; END IF;
  INSERT INTO alm.historico_alteracoes
    (recebimento_id,entidade,entidade_id,acao,usuario_id,ator_tipo,
      ator_identificador,request_id,dados_antes,dados_depois,campos_alterados)
  VALUES(NULL,'alm.autorizacoes_webauthn',NEW.id::text,
    CASE WHEN TG_OP='INSERT' THEN 'INSERCAO' ELSE 'ALTERACAO' END,
    v_ator::uuid,CASE WHEN v_ator IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END,
    coalesce(v_ator,v_sistema),nullif(current_setting('app.request_id',true),'')::uuid,
    NULL,jsonb_build_object('finalidade',NEW.finalidade,
         'consumida',NEW.consumido_em IS NOT NULL,
         'revogada',NEW.revogado_em IS NOT NULL),
    ARRAY['estado_autorizacao']::text[]);
  RETURN NEW;
END;$f$;
CREATE TRIGGER trg_webautorizacao_auditoria AFTER INSERT OR UPDATE ON alm.autorizacoes_webauthn
FOR EACH ROW EXECUTE FUNCTION alm.auditar_autorizacao_webauthn();

-- Desafios/fluxos: nao permitir que dados imutaveis sejam trocados ou
-- que timestamps de consumo sejam apagados/reescritos.
CREATE FUNCTION alm.validar_transitorio_webauthn() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,alm AS $f$
BEGIN
  IF TG_TABLE_NAME='desafios_webauthn' THEN
    IF (to_jsonb(NEW)-'consumido_em') IS DISTINCT FROM (to_jsonb(OLD)-'consumido_em') THEN
      RAISE EXCEPTION 'Dados do desafio imutaveis';
    END IF;
    IF OLD.consumido_em IS NOT NULL AND NEW.consumido_em IS DISTINCT FROM OLD.consumido_em THEN
      RAISE EXCEPTION 'Desafio ja consumido';
    END IF;
    IF OLD.consumido_em IS NULL AND NEW.consumido_em IS NOT NULL
       AND OLD.expira_em <= clock_timestamp() THEN
      RAISE EXCEPTION 'Desafio expirado';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['consumido_em','cancelado_em']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['consumido_em','cancelado_em']) THEN
      RAISE EXCEPTION 'Dados do fluxo parcial imutaveis';
    END IF;
    IF OLD.consumido_em IS NOT NULL AND NEW.consumido_em IS DISTINCT FROM OLD.consumido_em THEN
      RAISE EXCEPTION 'Fluxo ja consumido';
    END IF;
    IF OLD.cancelado_em IS NOT NULL AND NEW.cancelado_em IS DISTINCT FROM OLD.cancelado_em THEN
      RAISE EXCEPTION 'Fluxo ja cancelado';
    END IF;
    IF OLD.consumido_em IS NULL AND NEW.consumido_em IS NOT NULL
       AND (OLD.cancelado_em IS NOT NULL OR OLD.expira_em <= clock_timestamp()) THEN
      RAISE EXCEPTION 'Fluxo parcial cancelado ou expirado';
    END IF;
  END IF;
  RETURN NEW;
END;$f$;
CREATE TRIGGER trg_webdesafio_estado BEFORE UPDATE ON alm.desafios_webauthn
FOR EACH ROW EXECUTE FUNCTION alm.validar_transitorio_webauthn();
CREATE TRIGGER trg_webfluxo_estado BEFORE UPDATE ON alm.fluxos_auth_parcial
FOR EACH ROW EXECUTE FUNCTION alm.validar_transitorio_webauthn();

ALTER TABLE alm.eventos_autenticacao DROP CONSTRAINT eventos_autenticacao_tipo_check;
ALTER TABLE alm.eventos_autenticacao ADD CONSTRAINT eventos_autenticacao_tipo_check CHECK(tipo IN (
 'LOGIN_SUCESSO','LOGIN_FALHA','LOGIN_BLOQUEADO','LOGOUT','SESSAO_EXPIRADA',
 'SESSAO_REVOGADA','PIN_TROCADO','PIN_REDEFINIDO','USUARIO_BLOQUEADO',
 'USUARIO_DESBLOQUEADO','PIN_ETAPA_VALIDADA','MFA_DESAFIO_CRIADO',
 'MFA_SUCESSO','MFA_FALHA','WEBAUTHN_CADASTRO','WEBAUTHN_REVOGACAO',
 'WEBAUTHN_RECUPERACAO','MFA_DESAFIO_EXPIRADO'
));

-- Heranca do esquema PR #2: grants historicos NAO se aplicam automaticamente.
REVOKE ALL ON alm.credenciais_webauthn,alm.autorizacoes_webauthn,
  alm.fluxos_auth_parcial,alm.desafios_webauthn FROM PUBLIC,alm_api,alm_job;
GRANT SELECT(id,usuario_id,credential_id,chave_publica_cose,algoritmo_cose,sign_count,
 aaguid,transports,backup_eligible,backup_state,nome_exibicao,metodo_cadastro,
 criado_em,ultimo_uso_em,revogado_em,revogado_por) ON alm.credenciais_webauthn TO alm_api;
GRANT INSERT(usuario_id,credential_id,chave_publica_cose,algoritmo_cose,sign_count,
 aaguid,transports,backup_eligible,backup_state,nome_exibicao,metodo_cadastro)
 ON alm.credenciais_webauthn TO alm_api;
GRANT UPDATE(sign_count,ultimo_uso_em,backup_state,nome_exibicao,
 revogado_em,revogado_por,motivo_revogacao) ON alm.credenciais_webauthn TO alm_api;
GRANT SELECT(id,usuario_id,finalidade,codigo_hash,autorizado_por,autorizacao_externa,
 criado_em,expira_em,consumido_em,revogado_em,revogado_por)
 ON alm.autorizacoes_webauthn TO alm_api;
GRANT INSERT(usuario_id,finalidade,codigo_hash,autorizado_por,autorizacao_externa,
 expira_em,request_id) ON alm.autorizacoes_webauthn TO alm_api;
GRANT UPDATE(consumido_em,revogado_em,revogado_por) ON alm.autorizacoes_webauthn TO alm_api;
GRANT SELECT(id,usuario_id,token_hash,criado_em,expira_em,consumido_em,cancelado_em)
 ON alm.fluxos_auth_parcial TO alm_api;
GRANT INSERT(usuario_id,token_hash,expira_em,request_id) ON alm.fluxos_auth_parcial TO alm_api;
GRANT UPDATE(consumido_em,cancelado_em) ON alm.fluxos_auth_parcial TO alm_api;
GRANT SELECT(id,usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,
 fluxo_parcial_id,sessao_id,autorizacao_id,rp_id,origem_esperada,
 criado_em,expira_em,consumido_em) ON alm.desafios_webauthn TO alm_api;
GRANT INSERT(usuario_id,cerimonia,challenge_hash,vinculo_fluxo_hash,
 fluxo_parcial_id,sessao_id,autorizacao_id,rp_id,origem_esperada,expira_em,request_id)
 ON alm.desafios_webauthn TO alm_api;
GRANT UPDATE(consumido_em) ON alm.desafios_webauthn TO alm_api;

-- Job apenas para lixo tecnico expirado; RLS restringe alvo a expira_em vencido.
GRANT SELECT(id,expira_em) ON alm.desafios_webauthn TO alm_job;
GRANT DELETE ON alm.desafios_webauthn TO alm_job;
GRANT SELECT(id,expira_em) ON alm.fluxos_auth_parcial TO alm_job;
GRANT DELETE ON alm.fluxos_auth_parcial TO alm_job;

ALTER TABLE alm.credenciais_webauthn ENABLE ROW LEVEL SECURITY;
ALTER TABLE alm.autorizacoes_webauthn ENABLE ROW LEVEL SECURITY;
ALTER TABLE alm.fluxos_auth_parcial ENABLE ROW LEVEL SECURITY;
ALTER TABLE alm.desafios_webauthn ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_tecnico ON alm.credenciais_webauthn
  FOR ALL TO alm_api USING(true) WITH CHECK(true);
CREATE POLICY p_tecnico ON alm.autorizacoes_webauthn
  FOR ALL TO alm_api USING(true) WITH CHECK(true);
CREATE POLICY p_tecnico ON alm.fluxos_auth_parcial
  FOR ALL TO alm_api USING(true) WITH CHECK(true);
CREATE POLICY p_tecnico ON alm.desafios_webauthn
  FOR ALL TO alm_api USING(true) WITH CHECK(true);
CREATE POLICY p_webdesafios_limpeza ON alm.desafios_webauthn
  FOR DELETE TO alm_job USING(expira_em < clock_timestamp());
CREATE POLICY p_webfluxos_limpeza ON alm.fluxos_auth_parcial
  FOR DELETE TO alm_job USING(expira_em < clock_timestamp());

REVOKE EXECUTE ON FUNCTION alm.validar_credencial_webauthn_update(),
 alm.validar_sessao_mfa(),alm.revogar_sessoes_da_credencial(),
 alm.auditar_credencial_webauthn(),alm.validar_estado_autorizacao_web(),
 alm.auditar_autorizacao_webauthn(),alm.validar_transitorio_webauthn()
 FROM PUBLIC,alm_api,alm_job;
COMMIT;