-- =============================================================================
-- ALM 2.0 - migration DELTA sobre o DDL de ARQUITETURA_TECNICA_ALM.md, secao 3 (v1.0)
-- =============================================================================
-- STATUS: RASCUNHO PARA REVISAO. Sintaxe validada com o parser real do Postgres
-- (libpg-query, gramatica PG 18). NAO foi executado contra um banco: aplicar
-- primeiro em `supabase start` / `supabase db reset` (local) e rodar os testes
-- de banco descritos em docs/alm2/07-migracao-infra-roadmap.md antes de usar
-- em staging.
--
-- Pre-requisito: DDL v1 aplicado (schema alm, funcoes alm.*, roles alm_api e
-- alm_job, triggers de auditoria e de finalizacao).
--
-- Decisoes relacionadas (docs/alm2/01-resumo-e-decisoes.md):
--   D03/D04 credenciais e sessoes | D05 papeis | D06 codigo legado
--   D07 exclusao logica           | D08 auditoria | D09 arquivos (quarentena)
--   D10/D11 espelho Sheets e outbox | D14 filtros | D15 Portaria
--
-- Convencoes herdadas da v1: nomes em portugues, timestamptz com
-- clock_timestamp(), sem DELETE para a role da API (exclusao logica),
-- toda mutacao auditada define exatamente um ator via app.usuario_id ou
-- app.ator_sistema (SET LOCAL / set_config(..., true)).
-- =============================================================================

BEGIN;

SELECT set_config('app.ator_sistema', 'migration:002_alm2_delta', true);

-- -----------------------------------------------------------------------------
-- 1. Papeis (D05). A MATRIZ papel -> permissoes fica em codigo (backend/auth),
--    versionada e testada; o banco guarda so os codigos e quem tem qual papel.
-- -----------------------------------------------------------------------------
CREATE TABLE alm.papeis (
    codigo      varchar(30) PRIMARY KEY CHECK (codigo ~ '^[A-Z_]{3,30}$'),
    nome        text NOT NULL CHECK (btrim(nome) <> ''),
    tipo        varchar(10) NOT NULL CHECK (tipo IN ('FUNCIONAL', 'SUPERIOR')),
    ativo       boolean NOT NULL DEFAULT true,
    ordem       smallint NOT NULL DEFAULT 0,
    criado_em   timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_papeis_codigo_tipo UNIQUE (codigo, tipo)
);

CREATE TRIGGER trg_papel_timestamp BEFORE UPDATE ON alm.papeis
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_timestamp_catalogo();
CREATE TRIGGER trg_auditar_papeis
AFTER INSERT OR UPDATE OR DELETE ON alm.papeis
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();

INSERT INTO alm.papeis (codigo, nome, tipo, ordem) VALUES
    ('ADMINISTRADOR', 'Administrador', 'FUNCIONAL', 10),
    ('ALMOXARIFADO',  'Almoxarifado',  'FUNCIONAL', 20),
    ('SUPRIMENTOS',   'Suprimentos',   'FUNCIONAL', 30),
    ('CONSULTA',      'Consulta',      'FUNCIONAL', 40),
    ('PORTARIA',      'Portaria',      'FUNCIONAL', 50),
    ('ENCARREGADO',   'Encarregado',   'SUPERIOR', 110),
    ('SUPERVISOR',    'Supervisor',    'SUPERIOR', 120),
    ('GERENTE',       'Gerente',       'SUPERIOR', 130);

-- -----------------------------------------------------------------------------
-- 2. usuarios: identidade por matricula (D03). oidc_* continua existindo, mas
--    opcional, caso um dia haja SSO corporativo.
--    ultimo_login_em SAI desta tabela: cada login geraria UPDATE, bump de
--    versao e uma linha em historico_alteracoes. O contador vai para
--    credenciais_pin (tabela nao auditada pelo trigger generico).
-- -----------------------------------------------------------------------------
ALTER TABLE alm.usuarios
    ALTER COLUMN oidc_issuer  DROP NOT NULL,
    ALTER COLUMN oidc_subject DROP NOT NULL,
    ALTER COLUMN email        DROP NOT NULL,
    ADD COLUMN matricula text,
    ADD COLUMN cargo     text,
    ADD COLUMN setor     text,
    ADD COLUMN legado    boolean NOT NULL DEFAULT false;

ALTER TABLE alm.usuarios DROP COLUMN ultimo_login_em;

ALTER TABLE alm.usuarios
    DROP CONSTRAINT usuarios_perfil_check,
    ADD CONSTRAINT ck_usuarios_perfil CHECK (
        perfil IN ('ADMINISTRADOR', 'ALMOXARIFADO', 'SUPRIMENTOS', 'CONSULTA', 'PORTARIA')
    ),
    ADD CONSTRAINT fk_usuarios_perfil FOREIGN KEY (perfil)
        REFERENCES alm.papeis (codigo) ON DELETE RESTRICT,
    ADD CONSTRAINT ck_usuarios_matricula CHECK (
        matricula IS NULL OR matricula ~ '^[0-9A-Z]{3,20}$'
    ),
    ADD CONSTRAINT ck_usuarios_matricula_obrigatoria CHECK (legado OR matricula IS NOT NULL);

-- Formato real da matricula e decisao em aberto (Q2): ajustar o CHECK acima
-- antes do primeiro import. Zeros a esquerda sao significativos: sempre text.
CREATE UNIQUE INDEX uq_usuarios_matricula
    ON alm.usuarios (matricula)
    WHERE matricula IS NOT NULL;

-- Papeis SUPERIORES sao aditivos ao perfil funcional (D05). Sem DELETE:
-- revogar = preencher revogado_em/revogado_por (mesma filosofia da v1).
CREATE TABLE alm.usuario_papeis (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id    uuid NOT NULL REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    papel_codigo  varchar(30) NOT NULL,
    papel_tipo    varchar(10) NOT NULL DEFAULT 'SUPERIOR' CHECK (papel_tipo = 'SUPERIOR'),
    concedido_em  timestamptz NOT NULL DEFAULT clock_timestamp(),
    concedido_por uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    revogado_em   timestamptz,
    revogado_por  uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    CONSTRAINT fk_usuario_papeis_papel FOREIGN KEY (papel_codigo, papel_tipo)
        REFERENCES alm.papeis (codigo, tipo) ON DELETE RESTRICT,
    CONSTRAINT ck_usuario_papeis_revogacao CHECK ((revogado_em IS NULL) = (revogado_por IS NULL))
);

CREATE UNIQUE INDEX uq_usuario_papeis_ativo
    ON alm.usuario_papeis (usuario_id, papel_codigo)
    WHERE revogado_em IS NULL;

CREATE TRIGGER trg_auditar_usuario_papeis
AFTER INSERT OR UPDATE OR DELETE ON alm.usuario_papeis
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();

-- -----------------------------------------------------------------------------
-- 3. Credenciais, sessoes e eventos de autenticacao (D03/D04)
--    ATENCAO: NAO anexar alm.auditar_mutacao() a credenciais_pin nem a sessoes.
--    O trigger generico copia a linha inteira (to_jsonb) para
--    historico_alteracoes e vazaria pin_hash / token_hash para a auditoria.
-- -----------------------------------------------------------------------------
CREATE TABLE alm.credenciais_pin (
    usuario_id          uuid PRIMARY KEY REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    pin_hash            text NOT NULL,
    algoritmo           varchar(20) NOT NULL CHECK (algoritmo IN ('argon2id', 'scrypt')),
    pepper_versao       smallint NOT NULL DEFAULT 1 CHECK (pepper_versao > 0),
    temporario          boolean NOT NULL DEFAULT true,
    expira_em           timestamptz,
    definido_em         timestamptz NOT NULL DEFAULT clock_timestamp(),
    definido_por        uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    falhas_consecutivas smallint NOT NULL DEFAULT 0 CHECK (falhas_consecutivas >= 0),
    ultima_falha_em     timestamptz,
    -- bloqueio temporario: bloqueado_ate no futuro.
    -- bloqueio manual/permanente: bloqueado_em preenchido e bloqueado_ate nulo
    -- (so um usuario com usuarios.block desfaz).
    bloqueado_ate       timestamptz,
    bloqueado_em        timestamptz,
    motivo_bloqueio     text,
    ultimo_login_em     timestamptz
);

CREATE OR REPLACE FUNCTION alm.auditar_credencial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, alm
AS $$
DECLARE
    v_usuario_txt text := nullif(current_setting('app.usuario_id', true), '');
    v_sistema_txt text := nullif(current_setting('app.ator_sistema', true), '');
BEGIN
    -- Contadores de falha e ultimo login mudam sem troca de PIN: nao auditar aqui.
    IF TG_OP = 'UPDATE' AND NEW.pin_hash IS NOT DISTINCT FROM OLD.pin_hash THEN
        RETURN NEW;
    END IF;

    IF (v_usuario_txt IS NULL) = (v_sistema_txt IS NULL) THEN
        RAISE EXCEPTION 'Defina exatamente um ator: app.usuario_id ou app.ator_sistema';
    END IF;

    INSERT INTO alm.historico_alteracoes (
        recebimento_id, entidade, entidade_id, acao, usuario_id,
        ator_tipo, ator_identificador, request_id, ip, user_agent,
        dados_antes, dados_depois, campos_alterados
    ) VALUES (
        NULL,
        'alm.credenciais_pin',
        NEW.usuario_id::text,
        CASE WHEN TG_OP = 'INSERT' THEN 'INSERCAO' ELSE 'ALTERACAO' END,
        nullif(v_usuario_txt, '')::uuid,
        CASE WHEN v_usuario_txt IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END,
        coalesce(v_usuario_txt, v_sistema_txt),
        nullif(current_setting('app.request_id', true), '')::uuid,
        nullif(current_setting('app.ip', true), '')::inet,
        nullif(current_setting('app.user_agent', true), ''),
        NULL,
        jsonb_build_object(
            'temporario', NEW.temporario,
            'definido_em', NEW.definido_em,
            'algoritmo', NEW.algoritmo
        ),
        ARRAY['pin_hash']
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auditar_credenciais
AFTER INSERT OR UPDATE ON alm.credenciais_pin
FOR EACH ROW EXECUTE FUNCTION alm.auditar_credencial();

CREATE TABLE alm.sessoes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id          uuid NOT NULL REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    -- SHA-256 do token opaco (32 bytes aleatorios) entregue no cookie.
    token_hash          bytea NOT NULL,
    criada_em           timestamptz NOT NULL DEFAULT clock_timestamp(),
    ultimo_uso_em       timestamptz NOT NULL DEFAULT clock_timestamp(),
    ocioso_max_segundos integer NOT NULL CHECK (ocioso_max_segundos BETWEEN 60 AND 86400),
    expira_em           timestamptz NOT NULL,
    revogada_em         timestamptz,
    motivo_revogacao    varchar(30),
    ip                  inet,
    user_agent          text,
    terminal            text,
    CONSTRAINT uq_sessoes_token UNIQUE (token_hash),
    CONSTRAINT ck_sessoes_expiracao CHECK (expira_em > criada_em)
);

CREATE INDEX ix_sessoes_usuario_ativa
    ON alm.sessoes (usuario_id)
    WHERE revogada_em IS NULL;

CREATE TABLE alm.eventos_autenticacao (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ocorreu_em          timestamptz NOT NULL DEFAULT clock_timestamp(),
    tipo                varchar(30) NOT NULL CHECK (tipo IN (
        'LOGIN_SUCESSO', 'LOGIN_FALHA', 'LOGIN_BLOQUEADO', 'LOGOUT',
        'SESSAO_EXPIRADA', 'SESSAO_REVOGADA', 'PIN_TROCADO', 'PIN_REDEFINIDO',
        'USUARIO_BLOQUEADO', 'USUARIO_DESBLOQUEADO'
    )),
    usuario_id          uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    ator_usuario_id     uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    -- Como foi digitada (normalizada). NUNCA gravar o PIN, nem parcial.
    matricula_informada text,
    sucesso             boolean NOT NULL,
    motivo              varchar(40),
    ip                  inet,
    user_agent          text,
    request_id          uuid
);

CREATE INDEX ix_eventos_auth_ip ON alm.eventos_autenticacao (ip, ocorreu_em DESC);
CREATE INDEX ix_eventos_auth_usuario ON alm.eventos_autenticacao (usuario_id, ocorreu_em DESC);

CREATE TRIGGER trg_eventos_auth_imutavel
BEFORE UPDATE OR DELETE ON alm.eventos_autenticacao
FOR EACH ROW EXECUTE FUNCTION alm.impedir_mutacao_historico();
CREATE TRIGGER trg_eventos_auth_sem_truncate
BEFORE TRUNCATE ON alm.eventos_autenticacao
FOR EACH STATEMENT EXECUTE FUNCTION alm.impedir_mutacao_historico();

-- -----------------------------------------------------------------------------
-- 4. recebimentos: chave NF-e e codigo legado (D06)
-- -----------------------------------------------------------------------------
ALTER TABLE alm.recebimentos
    ADD COLUMN nfe_chave_acesso char(44),
    ADD COLUMN codigo_legado    text,
    ADD CONSTRAINT ck_recebimentos_chave_nfe CHECK (
        nfe_chave_acesso IS NULL OR nfe_chave_acesso ~ '^[0-9]{44}$'
    ),
    ADD CONSTRAINT uq_recebimentos_codigo_legado UNIQUE (codigo_legado);

-- Duplicidade de chave em recebimentos e ALERTA no app, nao constraint (Q6):
-- uma mesma NF pode, em casos raros, ser recebida em mais de uma entrega.
CREATE INDEX ix_recebimentos_chave_nfe
    ON alm.recebimentos (nfe_chave_acesso)
    WHERE nfe_chave_acesso IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Portaria (D15)
-- -----------------------------------------------------------------------------
CREATE SEQUENCE alm.seq_chegada;

CREATE TABLE alm.chegadas_portaria (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                   varchar(20) NOT NULL
                             DEFAULT ('CHG-' || lpad(nextval('alm.seq_chegada')::text, 8, '0')),
    nfe_chave_acesso         char(44),
    numero_nf                text,
    serie_nf                 text,
    cnpj_emitente            char(14),
    fornecedor_id            uuid REFERENCES alm.fornecedores (id) ON DELETE RESTRICT,
    fornecedor_nome_snapshot text,
    metodo_leitura           varchar(20) NOT NULL CHECK (metodo_leitura IN (
        'PDF_TEXTO', 'ZBAR', 'ZXING', 'NATIVO', 'OCR', 'MANUAL'
    )),
    confianca                varchar(10) CHECK (confianca IN ('ALTA', 'MEDIA', 'BAIXA', 'MANUAL')),
    status                   varchar(20) NOT NULL DEFAULT 'REGISTRADA' CHECK (status IN (
        'REGISTRADA', 'VINCULADA', 'CANCELADA'
    )),
    recebimento_id           uuid REFERENCES alm.recebimentos (id) ON DELETE RESTRICT,
    vinculada_em             timestamptz,
    vinculada_por            uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    observacoes              text,
    criado_em                timestamptz NOT NULL DEFAULT clock_timestamp(),
    criado_por               uuid NOT NULL REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    alterado_em              timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por             uuid NOT NULL REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    versao                   bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    excluido_em              timestamptz,
    excluido_por             uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    motivo_exclusao          text,
    CONSTRAINT uq_chegadas_codigo UNIQUE (codigo),
    CONSTRAINT ck_chegadas_chave CHECK (
        nfe_chave_acesso IS NULL OR nfe_chave_acesso ~ '^[0-9]{44}$'
    ),
    CONSTRAINT ck_chegadas_cnpj CHECK (
        cnpj_emitente IS NULL OR cnpj_emitente ~ '^[0-9]{14}$'
    ),
    CONSTRAINT ck_chegadas_identificacao CHECK (
        nfe_chave_acesso IS NOT NULL
        OR (numero_nf IS NOT NULL AND cnpj_emitente IS NOT NULL)
    ),
    CONSTRAINT ck_chegadas_vinculo CHECK ((status = 'VINCULADA') = (recebimento_id IS NOT NULL)),
    CONSTRAINT ck_chegadas_vinculo_autor CHECK ((status = 'VINCULADA') = (vinculada_em IS NOT NULL)),
    CONSTRAINT ck_chegadas_exclusao CHECK (
        (excluido_em IS NULL AND excluido_por IS NULL AND motivo_exclusao IS NULL)
        OR (excluido_em IS NOT NULL AND excluido_por IS NOT NULL AND btrim(coalesce(motivo_exclusao, '')) <> '')
    )
);

-- Mesma chave ativa duas vezes = quase certamente leitura duplicada (Q6).
CREATE UNIQUE INDEX uq_chegadas_chave_ativa
    ON alm.chegadas_portaria (nfe_chave_acesso)
    WHERE nfe_chave_acesso IS NOT NULL AND status <> 'CANCELADA' AND excluido_em IS NULL;

CREATE INDEX ix_chegadas_nf_cnpj
    ON alm.chegadas_portaria (cnpj_emitente, numero_nf)
    WHERE excluido_em IS NULL;
CREATE INDEX ix_chegadas_pendentes
    ON alm.chegadas_portaria (criado_em DESC)
    WHERE status = 'REGISTRADA' AND excluido_em IS NULL;

CREATE TRIGGER trg_chegada_controle BEFORE UPDATE ON alm.chegadas_portaria
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_linha();
CREATE TRIGGER trg_auditar_chegadas
AFTER INSERT OR UPDATE OR DELETE ON alm.chegadas_portaria
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();

-- -----------------------------------------------------------------------------
-- 6. arquivos: estado FISICO separado da exclusao LOGICA (D07/D09)
--    excluido_em (v1) = decisao de negocio, imediata e reversivel.
--    armazenamento_estado = onde o byte esta de fato; muda por job.
--    Quarentena = pasta propria no Drive, NUNCA a lixeira do Drive (a lixeira
--    apaga sozinha em 30 dias, menos que qualquer retencao razoavel).
-- -----------------------------------------------------------------------------
ALTER TABLE alm.arquivos
    ADD COLUMN armazenamento_estado varchar(20) NOT NULL DEFAULT 'ATIVO'
        CHECK (armazenamento_estado IN (
            'ATIVO', 'QUARENTENA_PENDENTE', 'EM_QUARENTENA',
            'PURGA_PENDENTE', 'PURGADO', 'AUSENTE'
        )),
    ADD COLUMN quarentena_em     timestamptz,
    ADD COLUMN purga_prevista_em timestamptz,
    ADD COLUMN purgado_em        timestamptz,
    ADD COLUMN purgado_por       uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT;

CREATE INDEX ix_arquivos_estado_fisico
    ON alm.arquivos (armazenamento_estado)
    WHERE armazenamento_estado <> 'ATIVO';

-- A v1 bloqueia QUALQUER mutacao de filho de recebimento finalizado, exceto o
-- reconciliador (ator SISTEMA) tocando uma lista fixa de colunas tecnicas. Sem
-- estender essa lista, o job de quarentena/purga falharia em recebimentos
-- finalizados. Corpo identico ao da v1, com as colunas novas na lista.
CREATE OR REPLACE FUNCTION alm.bloquear_mutacao_filho_finalizado()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_recebimento_id uuid;
    v_status varchar(40);
    v_sistema text := nullif(current_setting('app.ator_sistema', true), '');
    v_antes_funcional jsonb;
    v_depois_funcional jsonb;
    v_tecnicas constant text[] := ARRAY[
        'status_upload', 'integridade_verificada_em', 'storage_etag',
        'storage_version_id', 'provider_metadata', 'alterado_em',
        'alterado_por', 'versao',
        'armazenamento_estado', 'quarentena_em', 'purga_prevista_em',
        'purgado_em', 'purgado_por'
    ];
BEGIN
    v_recebimento_id := CASE
        WHEN TG_OP = 'DELETE' THEN OLD.recebimento_id
        ELSE NEW.recebimento_id
    END;

    SELECT status INTO v_status
      FROM alm.recebimentos
     WHERE id = v_recebimento_id
     FOR UPDATE;

    IF v_status <> 'CONFERIDO_FINALIZADO' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'arquivos' AND TG_OP = 'UPDATE' AND v_sistema IS NOT NULL THEN
        v_antes_funcional := to_jsonb(OLD) - v_tecnicas;
        v_depois_funcional := to_jsonb(NEW) - v_tecnicas;
        IF v_antes_funcional = v_depois_funcional
           AND OLD.status_upload = 'DISPONIVEL'
           AND NEW.status_upload IN ('DISPONIVEL', 'INCONSISTENTE') THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Reabra o recebimento antes de alterar itens, arquivos ou divergencias';
END;
$$;

-- -----------------------------------------------------------------------------
-- 6b. Auditoria sem colunas derivadas (D08)
--    A v1 grava to_jsonb(OLD/NEW) inteiro; isso inclui busca_fts (tsvector) e
--    as colunas *_busca, que sao derivadas por trigger e inflam a auditoria sem
--    informacao nova. Corpo identico ao da v1, com a remocao dessas chaves.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION alm.auditar_mutacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, alm
AS $$
DECLARE
    v_antes             jsonb;
    v_depois            jsonb;
    v_recebimento_txt   text;
    v_entidade_id       text;
    v_usuario_txt       text;
    v_sistema_txt       text;
    v_acao              text;
    v_campos            text[];
    v_derivadas constant text[] := ARRAY[
        'busca_fts', 'nome_busca', 'numero_nf_busca', 'pedido_busca',
        'fornecedor_busca', 'codigo_produto_busca', 'descricao_busca'
    ];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_depois := to_jsonb(NEW);
        v_acao := 'INSERCAO';
    ELSIF TG_OP = 'UPDATE' THEN
        v_antes := to_jsonb(OLD);
        v_depois := to_jsonb(NEW);
        IF v_antes ->> 'excluido_em' IS NULL
           AND v_depois ->> 'excluido_em' IS NOT NULL THEN
            v_acao := 'EXCLUSAO_LOGICA';
        ELSE
            v_acao := 'ALTERACAO';
        END IF;
    ELSE
        v_antes := to_jsonb(OLD);
        v_acao := 'EXCLUSAO_FISICA';
    END IF;

    v_antes := v_antes - v_derivadas;
    v_depois := v_depois - v_derivadas;

    v_entidade_id := coalesce(
        v_depois ->> 'id', v_antes ->> 'id',
        v_depois ->> 'codigo', v_antes ->> 'codigo',
        'SEM_ID'
    );

    IF TG_TABLE_NAME = 'recebimentos' THEN
        v_recebimento_txt := coalesce(v_depois ->> 'id', v_antes ->> 'id');
    ELSE
        v_recebimento_txt := coalesce(
            v_depois ->> 'recebimento_id', v_antes ->> 'recebimento_id'
        );
    END IF;

    SELECT array_agg(k ORDER BY k)
      INTO v_campos
      FROM (
          SELECT jsonb_object_keys(coalesce(v_antes, '{}'::jsonb)) AS k
          UNION
          SELECT jsonb_object_keys(coalesce(v_depois, '{}'::jsonb)) AS k
      ) chaves
     WHERE (v_antes -> k) IS DISTINCT FROM (v_depois -> k);

    v_usuario_txt := nullif(current_setting('app.usuario_id', true), '');
    v_sistema_txt := nullif(current_setting('app.ator_sistema', true), '');

    IF (v_usuario_txt IS NULL) = (v_sistema_txt IS NULL) THEN
        RAISE EXCEPTION 'Defina exatamente um ator: app.usuario_id ou app.ator_sistema';
    END IF;

    INSERT INTO alm.historico_alteracoes (
        recebimento_id, entidade, entidade_id, acao, usuario_id,
        ator_tipo, ator_identificador, request_id, ip, user_agent,
        dados_antes, dados_depois, campos_alterados
    ) VALUES (
        nullif(v_recebimento_txt, '')::uuid,
        TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
        v_entidade_id,
        v_acao,
        nullif(v_usuario_txt, '')::uuid,
        CASE WHEN v_usuario_txt IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END,
        coalesce(v_usuario_txt, v_sistema_txt),
        nullif(current_setting('app.request_id', true), '')::uuid,
        nullif(current_setting('app.ip', true), '')::inet,
        nullif(current_setting('app.user_agent', true), ''),
        v_antes,
        v_depois,
        v_campos
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Outbox e estado do espelho Sheets (D10/D11)
--    Escrita na MESMA transacao da mudanca de negocio. O indice unico parcial
--    permite coalescer: varias mudancas enquanto ha um evento pendente do mesmo
--    tipo/chave viram um unico evento (ON CONFLICT DO NOTHING).
-- -----------------------------------------------------------------------------
CREATE TABLE alm.outbox (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    criado_em            timestamptz NOT NULL DEFAULT clock_timestamp(),
    tipo                 varchar(30) NOT NULL CHECK (tipo IN (
        'SHEETS_ESPELHO', 'DRIVE_QUARENTENA', 'DRIVE_RESTAURAR', 'DRIVE_PURGA'
    )),
    entidade             varchar(40) NOT NULL,
    entidade_id          text NOT NULL,
    recebimento_id       uuid REFERENCES alm.recebimentos (id) ON DELETE RESTRICT,
    chave_idempotencia   text NOT NULL,
    payload              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    status               varchar(15) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN (
        'PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHOU', 'MORTO'
    )),
    tentativas           smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
    proxima_tentativa_em timestamptz NOT NULL DEFAULT clock_timestamp(),
    travado_ate          timestamptz,
    processado_em        timestamptz,
    ultimo_erro          text
);

CREATE UNIQUE INDEX uq_outbox_aberto
    ON alm.outbox (tipo, chave_idempotencia)
    WHERE status IN ('PENDENTE', 'PROCESSANDO', 'FALHOU');

CREATE INDEX ix_outbox_fila
    ON alm.outbox (proxima_tentativa_em)
    WHERE status IN ('PENDENTE', 'FALHOU');

CREATE TABLE alm.espelho_sheets (
    aba                     varchar(40) PRIMARY KEY,
    -- ID da planilha ESPELHO. Nunca a planilha legada antes do backup (07).
    planilha_id             text NOT NULL,
    ultima_sincronizacao_em timestamptz,
    ultimo_resultado        varchar(10) CHECK (ultimo_resultado IN ('OK', 'FALHOU')),
    linhas_escritas         integer CHECK (linhas_escritas >= 0),
    hash_conteudo           text,
    ultimo_erro             text,
    alterado_em             timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- -----------------------------------------------------------------------------
-- 8. Filtros salvos e log de exportacoes (D14)
-- -----------------------------------------------------------------------------
CREATE TABLE alm.filtros_salvos (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modulo          varchar(20) NOT NULL CHECK (modulo IN ('RECEBIMENTOS', 'PORTARIA', 'AUDITORIA')),
    nome            text NOT NULL CHECK (btrim(nome) <> ''),
    -- Definicao declarativa validada contra allowlist de campos/operadores.
    -- Nunca SQL do usuario. Formato em docs/alm2/04-dados-auditoria-busca.md.
    definicao       jsonb NOT NULL CHECK (jsonb_typeof(definicao) = 'object'),
    visibilidade    varchar(10) NOT NULL DEFAULT 'PRIVADO' CHECK (visibilidade IN ('PRIVADO', 'GLOBAL')),
    dono_id         uuid NOT NULL REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    criado_em       timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em     timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por    uuid NOT NULL REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    versao          bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    excluido_em     timestamptz,
    excluido_por    uuid REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    motivo_exclusao text
);

CREATE UNIQUE INDEX uq_filtros_nome_dono
    ON alm.filtros_salvos (dono_id, modulo, lower(nome))
    WHERE excluido_em IS NULL;

CREATE TRIGGER trg_filtro_controle BEFORE UPDATE ON alm.filtros_salvos
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_linha();
CREATE TRIGGER trg_auditar_filtros
AFTER INSERT OR UPDATE OR DELETE ON alm.filtros_salvos
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();

CREATE TABLE alm.exportacoes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitado_por  uuid NOT NULL REFERENCES alm.usuarios (id) ON DELETE RESTRICT,
    solicitado_em   timestamptz NOT NULL DEFAULT clock_timestamp(),
    formato         varchar(15) NOT NULL CHECK (formato IN ('CSV', 'GOOGLE_SHEETS')),
    filtros         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filtros) = 'object'),
    status          varchar(15) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'CONCLUIDA', 'FALHOU')),
    total_linhas    integer CHECK (total_linhas >= 0),
    -- ID interno do arquivo gerado no Drive; nunca devolvido ao cliente cru.
    destino_id      text,
    concluido_em    timestamptz,
    erro_codigo     text,
    request_id      uuid,
    ip              inet
);

CREATE INDEX ix_exportacoes_usuario ON alm.exportacoes (solicitado_por, solicitado_em DESC);

-- -----------------------------------------------------------------------------
-- 9. Privilegios, schema fora da Data API e RLS como defesa em profundidade (D02)
-- -----------------------------------------------------------------------------
-- anon/authenticated so existem no Supabase; o guard mantem a migration
-- executavel num Postgres puro (CI, testes de banco).
DO $rev$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA alm FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA alm FROM authenticated';
    END IF;
END;
$rev$;

GRANT SELECT ON ALL TABLES IN SCHEMA alm TO alm_api, alm_job;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA alm TO alm_api, alm_job;

GRANT INSERT, UPDATE ON
    alm.papeis, alm.usuario_papeis, alm.credenciais_pin, alm.sessoes,
    alm.chegadas_portaria, alm.filtros_salvos, alm.exportacoes
TO alm_api;
GRANT INSERT ON alm.eventos_autenticacao TO alm_api;

GRANT INSERT, UPDATE ON alm.outbox, alm.espelho_sheets TO alm_api, alm_job;
GRANT UPDATE ON alm.exportacoes TO alm_job;
-- Limpeza de sessoes expiradas: unico DELETE concedido (nao e dado de negocio).
GRANT DELETE ON alm.sessoes TO alm_job;

REVOKE ALL ON FUNCTION alm.auditar_credencial() FROM PUBLIC;

-- RLS ligada em TODA tabela do schema, com uma unica policy para as roles
-- tecnicas. O schema alm nao e exposto na Data API e anon/authenticated nao tem
-- grants; a RLS e um segundo muro caso alguem exponha o schema por engano.
-- Tabelas criadas depois desta migration devem repetir o padrao.
DO $rls$
DECLARE
    t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'alm' LOOP
        EXECUTE format('ALTER TABLE alm.%I ENABLE ROW LEVEL SECURITY', t.tablename);
        EXECUTE format('DROP POLICY IF EXISTS p_tecnico ON alm.%I', t.tablename);
        EXECUTE format(
            'CREATE POLICY p_tecnico ON alm.%I FOR ALL TO alm_api, alm_job USING (true) WITH CHECK (true)',
            t.tablename
        );
    END LOOP;
END;
$rls$;

COMMIT;
