-- ALM v1 - migration base extraída de ARQUITETURA_TECNICA_ALM.md, seção 3

-- Revisão Kobner: extração mecânica, sem alterar regras da v1.

-- PENDENTE antes de executar no Supabase real: confirmar schema da extensão unaccent.



BEGIN;

CREATE SCHEMA IF NOT EXISTS alm;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE alm.usuarios (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_issuer         text NOT NULL,
    oidc_subject        text NOT NULL,
    email               text NOT NULL,
    nome                text NOT NULL CHECK (btrim(nome) <> ''),
    nome_busca          text NOT NULL DEFAULT '',
    perfil              varchar(20) NOT NULL CHECK (
        perfil IN ('ADMINISTRADOR', 'ALMOXARIFADO', 'SUPRIMENTOS', 'CONSULTA')
    ),
    ativo               boolean NOT NULL DEFAULT true,
    ultimo_login_em     timestamptz,
    criado_em           timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em         timestamptz NOT NULL DEFAULT clock_timestamp(),
    versao              bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    CONSTRAINT uq_usuarios_oidc UNIQUE (oidc_issuer, oidc_subject),
    CONSTRAINT uq_usuarios_email UNIQUE (email),
    CONSTRAINT ck_usuarios_email_canonico CHECK (email = lower(btrim(email)))
);

CREATE TABLE alm.unidades_medida (
    codigo              varchar(12) PRIMARY KEY,
    descricao           text NOT NULL CHECK (btrim(descricao) <> ''),
    casas_decimais      smallint NOT NULL DEFAULT 3
                        CHECK (casas_decimais BETWEEN 0 AND 6),
    ativo               boolean NOT NULL DEFAULT true,
    ordem               smallint NOT NULL DEFAULT 0,
    criado_em           timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em         timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (codigo ~ '^[A-Z0-9._/-]{1,12}$')
);

CREATE TABLE alm.tipos_recebimento (
    id                  smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo              varchar(40) NOT NULL UNIQUE,
    nome                text NOT NULL CHECK (btrim(nome) <> ''),
    ativo               boolean NOT NULL DEFAULT true,
    ordem               smallint NOT NULL DEFAULT 0,
    criado_em           timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em         timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (codigo ~ '^[A-Z0-9_]{2,40}$')
);

CREATE TABLE alm.tipos_arquivo (
    codigo              varchar(30) PRIMARY KEY,
    nome                text NOT NULL CHECK (btrim(nome) <> ''),
    ativo               boolean NOT NULL DEFAULT true,
    ordem               smallint NOT NULL DEFAULT 0,
    criado_em           timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em         timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (codigo ~ '^[A-Z0-9_]{2,30}$')
);

CREATE TABLE alm.tipos_divergencia (
    codigo              varchar(40) PRIMARY KEY,
    nome                text NOT NULL CHECK (btrim(nome) <> ''),
    ativo               boolean NOT NULL DEFAULT true,
    ordem               smallint NOT NULL DEFAULT 0,
    criado_em           timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em         timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (codigo ~ '^[A-Z0-9_]{2,40}$')
);

CREATE TABLE alm.fornecedores (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cnpj                char(14),
    razao_social        text NOT NULL CHECK (btrim(razao_social) <> ''),
    nome_fantasia       text,
    nome_busca          text NOT NULL DEFAULT '',
    ativo               boolean NOT NULL DEFAULT true,
    criado_em           timestamptz NOT NULL DEFAULT clock_timestamp(),
    criado_por          uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    alterado_em         timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por        uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    versao              bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    CONSTRAINT ck_fornecedores_cnpj CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$')
);

CREATE UNIQUE INDEX uq_fornecedores_cnpj
    ON alm.fornecedores (cnpj)
    WHERE cnpj IS NOT NULL;

CREATE TABLE alm.recebimento_numeradores (
    ano                 smallint PRIMARY KEY CHECK (ano BETWEEN 1900 AND 9999),
    ultimo_numero       integer NOT NULL CHECK (ultimo_numero BETWEEN 1 AND 999999),
    alterado_em         timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION alm.proximo_codigo_recebimento(p_ano smallint)
RETURNS varchar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, alm
AS $$
DECLARE
    v_numero integer;
BEGIN
    IF p_ano IS NULL OR p_ano NOT BETWEEN 1900 AND 9999 THEN
        RAISE EXCEPTION 'Ano invalido para codigo de recebimento: %', p_ano;
    END IF;

    INSERT INTO alm.recebimento_numeradores (ano, ultimo_numero)
    VALUES (p_ano, 1)
    ON CONFLICT (ano) DO UPDATE
       SET ultimo_numero = alm.recebimento_numeradores.ultimo_numero + 1,
           alterado_em = clock_timestamp()
     WHERE alm.recebimento_numeradores.ultimo_numero < 999999
    RETURNING ultimo_numero INTO v_numero;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Limite anual de codigos excedido para %', p_ano;
    END IF;

    RETURN format('REC-%s-%s', p_ano, lpad(v_numero::text, 6, '0'));
END;
$$;

REVOKE ALL ON FUNCTION alm.proximo_codigo_recebimento(smallint) FROM PUBLIC;

CREATE TABLE alm.recebimentos (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                      varchar(20) NOT NULL,
    origem                      varchar(15) NOT NULL DEFAULT 'OPERACIONAL' CHECK (
        origem IN ('OPERACIONAL', 'MIGRACAO')
    ),
    qualidade_dados             varchar(25) NOT NULL CHECK (
        qualidade_dados IN ('CONFERIDO', 'NAO_CONFERIDO', 'PENDENTE_CONFERENCIA')
    ),
    numero_nf                   text,
    serie_nf                    text,
    numero_nf_busca             text NOT NULL DEFAULT '',
    pedido_compra               text,
    pedido_busca                text NOT NULL DEFAULT '',
    fornecedor_id               uuid REFERENCES alm.fornecedores(id) ON DELETE RESTRICT,
    fornecedor_nome_snapshot    text,
    fornecedor_cnpj_snapshot    char(14),
    fornecedor_busca            text NOT NULL DEFAULT '',
    recebido_em                 timestamptz,
    ano_referencia              smallint CHECK (ano_referencia BETWEEN 1900 AND 9999),
    mes_referencia              smallint CHECK (mes_referencia BETWEEN 1 AND 12),
    responsavel_id              uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    tipo_recebimento_id         smallint REFERENCES alm.tipos_recebimento(id)
                                ON DELETE RESTRICT,
    status                      varchar(40) CHECK (
        status IS NULL OR status IN (
            'EM_DIGITACAO',
            'AGUARDANDO_DOCUMENTACAO',
            'EM_CONFERENCIA',
            'DIVERGENCIA_IDENTIFICADA',
            'CONFERIDO_FINALIZADO'
        )
    ),
    observacoes                 text,
    dados_origem                jsonb NOT NULL DEFAULT '{}'::jsonb,
    busca_fts                   tsvector NOT NULL DEFAULT ''::tsvector,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    criado_por                  uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    alterado_em                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por                uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    versao                      bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    excluido_em                 timestamptz,
    excluido_por                uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    motivo_exclusao             text,
    conferido_em                timestamptz,
    conferido_por               uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,

    CONSTRAINT uq_recebimentos_codigo UNIQUE (codigo),
    CONSTRAINT ck_recebimentos_codigo CHECK (
        codigo ~ '^REC-[0-9]{4}-[0-9]{6}$'
    ),
    CONSTRAINT ck_recebimentos_cnpj_snapshot CHECK (
        fornecedor_cnpj_snapshot IS NULL
        OR fornecedor_cnpj_snapshot ~ '^[0-9]{14}$'
    ),
    CONSTRAINT ck_recebimentos_historico_conferido CHECK (
        origem <> 'MIGRACAO'
        OR qualidade_dados <> 'CONFERIDO'
        OR (conferido_em IS NOT NULL AND conferido_por IS NOT NULL)
    ),
    CONSTRAINT ck_recebimentos_conferencia_par CHECK (
        (conferido_em IS NULL AND conferido_por IS NULL)
        OR
        (conferido_em IS NOT NULL AND conferido_por IS NOT NULL)
    ),
    CONSTRAINT ck_recebimentos_status_operacional CHECK (
        (origem = 'OPERACIONAL' AND status IS NOT NULL)
        OR
        (origem = 'MIGRACAO' AND status IS NULL)
    ),
    CONSTRAINT ck_recebimentos_responsavel_operacional CHECK (
        origem = 'MIGRACAO' OR responsavel_id IS NOT NULL
    ),
    CONSTRAINT ck_recebimentos_campos_fluxo CHECK (
        origem = 'MIGRACAO'
        OR status = 'EM_DIGITACAO'
        OR (
            nullif(btrim(pedido_compra), '') IS NOT NULL
            AND fornecedor_id IS NOT NULL
            AND nullif(btrim(fornecedor_nome_snapshot), '') IS NOT NULL
            AND recebido_em IS NOT NULL
            AND responsavel_id IS NOT NULL
            AND tipo_recebimento_id IS NOT NULL
        )
    ),
    CONSTRAINT ck_recebimentos_final_nf CHECK (
        status <> 'CONFERIDO_FINALIZADO'
        OR nullif(btrim(numero_nf), '') IS NOT NULL
    ),
    CONSTRAINT ck_recebimentos_final_qualidade CHECK (
        status <> 'CONFERIDO_FINALIZADO'
        OR qualidade_dados = 'CONFERIDO'
    ),
    CONSTRAINT ck_recebimentos_qualidade_operacional CHECK (
        origem <> 'OPERACIONAL'
        OR (status = 'CONFERIDO_FINALIZADO' AND qualidade_dados = 'CONFERIDO')
        OR (status <> 'CONFERIDO_FINALIZADO'
            AND qualidade_dados = 'PENDENTE_CONFERENCIA')
    ),
    CONSTRAINT ck_recebimentos_dados_origem CHECK (
        jsonb_typeof(dados_origem) = 'object'
    ),
    CONSTRAINT ck_recebimentos_competencia CHECK (
        (ano_referencia IS NULL AND mes_referencia IS NULL)
        OR
        (ano_referencia IS NOT NULL AND mes_referencia IS NOT NULL)
    ),
    CONSTRAINT ck_recebimentos_exclusao CHECK (
        (excluido_em IS NULL AND excluido_por IS NULL AND motivo_exclusao IS NULL)
        OR
        (excluido_em IS NOT NULL AND excluido_por IS NOT NULL
         AND nullif(btrim(motivo_exclusao), '') IS NOT NULL)
    )
);

CREATE TABLE alm.recebimento_itens (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recebimento_id              uuid NOT NULL REFERENCES alm.recebimentos(id)
                                ON DELETE RESTRICT,
    numero_item                 integer NOT NULL CHECK (numero_item > 0),
    codigo_produto              text,
    descricao                   text NOT NULL CHECK (btrim(descricao) <> ''),
    quantidade_solicitada       numeric(18,6) CHECK (
        quantidade_solicitada IS NULL OR quantidade_solicitada >= 0
    ),
    quantidade_recebida         numeric(18,6) NOT NULL CHECK (
        quantidade_recebida > 0
    ),
    unidade_codigo              varchar(12) NOT NULL REFERENCES alm.unidades_medida(codigo)
                                ON DELETE RESTRICT,
    observacoes                 text,
    codigo_produto_busca        text NOT NULL DEFAULT '',
    descricao_busca             text NOT NULL DEFAULT '',
    busca_fts                   tsvector NOT NULL DEFAULT ''::tsvector,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    criado_por                  uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    alterado_em                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por                uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    versao                      bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    excluido_em                 timestamptz,
    excluido_por                uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    motivo_exclusao             text,
    CONSTRAINT uq_itens_id_recebimento UNIQUE (id, recebimento_id),
    CONSTRAINT ck_itens_exclusao CHECK (
        (excluido_em IS NULL AND excluido_por IS NULL AND motivo_exclusao IS NULL)
        OR
        (excluido_em IS NOT NULL AND excluido_por IS NOT NULL
         AND nullif(btrim(motivo_exclusao), '') IS NOT NULL)
    )
);

CREATE TABLE alm.storage_containers (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recebimento_id              uuid REFERENCES alm.recebimentos(id) ON DELETE RESTRICT,
    parent_id                   uuid,
    storage_provider            varchar(30) NOT NULL DEFAULT 'GOOGLE_DRIVE',
    storage_namespace           text NOT NULL,
    logical_key                 text NOT NULL,
    storage_object_id           text,
    finalidade                  varchar(30) NOT NULL CHECK (
        finalidade IN ('ROOT', 'ANO', 'MES', 'RECEBIMENTO', 'CATEGORIA', 'QUARENTENA')
    ),
    tipo_arquivo_codigo         varchar(30) REFERENCES alm.tipos_arquivo(codigo)
                                ON DELETE RESTRICT,
    status                      varchar(20) NOT NULL DEFAULT 'PENDENTE' CHECK (
        status IN ('PENDENTE', 'DISPONIVEL', 'FALHOU', 'INCONSISTENTE')
    ),
    nome_administrativo         text NOT NULL CHECK (btrim(nome_administrativo) <> ''),
    provider_metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    criado_por                  uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    alterado_em                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por                uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    versao                      bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    CONSTRAINT uq_storage_container_logical
        UNIQUE (storage_provider, storage_namespace, logical_key),
    CONSTRAINT uq_storage_container_object
        UNIQUE (storage_provider, storage_namespace, storage_object_id),
    CONSTRAINT uq_storage_container_id_provider_namespace
        UNIQUE (id, storage_provider, storage_namespace),
    CONSTRAINT uq_storage_container_vinculo_arquivo
        UNIQUE (
            id, recebimento_id, storage_provider,
            storage_namespace, tipo_arquivo_codigo
        ),
    CONSTRAINT fk_storage_container_parent_mesmo_namespace
        FOREIGN KEY (parent_id, storage_provider, storage_namespace)
        REFERENCES alm.storage_containers(id, storage_provider, storage_namespace)
        ON DELETE RESTRICT,
    CONSTRAINT ck_storage_provider CHECK (
        storage_provider ~ '^[A-Z][A-Z0-9_]{1,29}$'
    ),
    CONSTRAINT ck_storage_namespace CHECK (btrim(storage_namespace) <> ''),
    CONSTRAINT ck_storage_container_disponivel CHECK (
        status <> 'DISPONIVEL' OR nullif(btrim(storage_object_id), '') IS NOT NULL
    ),
    CONSTRAINT ck_storage_container_categoria CHECK (
        (finalidade = 'CATEGORIA' AND tipo_arquivo_codigo IS NOT NULL)
        OR
        (finalidade <> 'CATEGORIA' AND tipo_arquivo_codigo IS NULL)
    ),
    CONSTRAINT ck_storage_container_recebimento CHECK (
        (finalidade IN ('RECEBIMENTO', 'CATEGORIA') AND recebimento_id IS NOT NULL)
        OR
        (finalidade NOT IN ('RECEBIMENTO', 'CATEGORIA') AND recebimento_id IS NULL)
    ),
    CONSTRAINT ck_storage_container_parent CHECK (
        (finalidade = 'ROOT' AND parent_id IS NULL)
        OR
        (finalidade <> 'ROOT' AND parent_id IS NOT NULL)
    ),
    CONSTRAINT ck_storage_container_metadata CHECK (
        jsonb_typeof(provider_metadata) = 'object'
    )
);

CREATE TABLE alm.arquivos (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recebimento_id              uuid NOT NULL REFERENCES alm.recebimentos(id)
                                ON DELETE RESTRICT,
    item_id                     uuid,
    tipo_arquivo_codigo         varchar(30) NOT NULL REFERENCES alm.tipos_arquivo(codigo)
                                ON DELETE RESTRICT,
    storage_provider            varchar(30) NOT NULL DEFAULT 'GOOGLE_DRIVE',
    storage_namespace           text NOT NULL,
    storage_object_id           text,
    storage_version_id          text,
    storage_etag                text,
    storage_container_id        uuid NOT NULL,
    nome_original               text NOT NULL CHECK (btrim(nome_original) <> ''),
    nome_storage                text NOT NULL CHECK (btrim(nome_storage) <> ''),
    mime_type_declarado         text,
    mime_type_detectado         text NOT NULL CHECK (btrim(mime_type_detectado) <> ''),
    tamanho_bytes               bigint NOT NULL CHECK (tamanho_bytes > 0),
    checksum_algoritmo          varchar(12) NOT NULL DEFAULT 'SHA-256' CHECK (
        checksum_algoritmo = 'SHA-256'
    ),
    checksum_sha256             char(64) NOT NULL CHECK (
        checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
    idempotency_key             uuid NOT NULL,
    status_upload               varchar(25) NOT NULL DEFAULT 'PENDENTE' CHECK (
        status_upload IN (
            'PENDENTE', 'ENVIANDO', 'DISPONIVEL', 'FALHOU',
            'INCONSISTENTE'
        )
    ),
    provider_metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
    integridade_verificada_em   timestamptz,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    criado_por                  uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    alterado_em                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por                uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    versao                      bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    excluido_em                 timestamptz,
    excluido_por                uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    motivo_exclusao             text,
    CONSTRAINT uq_arquivos_id_recebimento UNIQUE (id, recebimento_id),
    CONSTRAINT uq_arquivos_idempotencia UNIQUE (recebimento_id, idempotency_key),
    CONSTRAINT fk_arquivos_item_mesmo_recebimento
        FOREIGN KEY (item_id, recebimento_id)
        REFERENCES alm.recebimento_itens(id, recebimento_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_arquivos_container_mesmo_recebimento_provider
        FOREIGN KEY (
            storage_container_id, recebimento_id, storage_provider,
            storage_namespace, tipo_arquivo_codigo
        )
        REFERENCES alm.storage_containers(
            id, recebimento_id, storage_provider,
            storage_namespace, tipo_arquivo_codigo
        )
        ON DELETE RESTRICT,
    CONSTRAINT ck_arquivos_provider CHECK (
        storage_provider ~ '^[A-Z][A-Z0-9_]{1,29}$'
    ),
    CONSTRAINT ck_arquivos_namespace CHECK (btrim(storage_namespace) <> ''),
    CONSTRAINT ck_arquivos_disponivel CHECK (
        status_upload <> 'DISPONIVEL'
        OR nullif(btrim(storage_object_id), '') IS NOT NULL
    ),
    CONSTRAINT ck_arquivos_metadata CHECK (
        jsonb_typeof(provider_metadata) = 'object'
    ),
    CONSTRAINT ck_arquivos_exclusao CHECK (
        (excluido_em IS NULL AND excluido_por IS NULL AND motivo_exclusao IS NULL)
        OR
        (excluido_em IS NOT NULL AND excluido_por IS NOT NULL
         AND nullif(btrim(motivo_exclusao), '') IS NOT NULL)
    )
);

CREATE TABLE alm.arquivo_acessos (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    arquivo_id                  uuid NOT NULL,
    recebimento_id              uuid NOT NULL,
    usuario_id                  uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    acao                        varchar(10) NOT NULL CHECK (
        acao IN ('PREVIEW', 'DOWNLOAD')
    ),
    resultado                   varchar(20) NOT NULL CHECK (
        resultado IN ('SUCESSO', 'NEGADO', 'FALHA_STORAGE', 'INTERROMPIDO')
    ),
    request_id                  uuid NOT NULL,
    ip                          inet,
    user_agent                  text,
    bytes_transmitidos          bigint CHECK (
        bytes_transmitidos IS NULL OR bytes_transmitidos >= 0
    ),
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_acessos_arquivo_recebimento
        FOREIGN KEY (arquivo_id, recebimento_id)
        REFERENCES alm.arquivos(id, recebimento_id)
        ON DELETE RESTRICT
);

CREATE TABLE alm.arquivo_backups (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    arquivo_id                  uuid NOT NULL,
    recebimento_id              uuid NOT NULL,
    backup_provider             varchar(30) NOT NULL,
    backup_namespace            text NOT NULL,
    backup_object_id            text,
    backup_version_id           text,
    checksum_sha256             char(64) NOT NULL CHECK (
        checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
    status                      varchar(20) NOT NULL DEFAULT 'PENDENTE' CHECK (
        status IN ('PENDENTE', 'COPIANDO', 'DISPONIVEL', 'FALHOU', 'INCONSISTENTE')
    ),
    copiado_em                  timestamptz,
    verificado_em               timestamptz,
    erro_codigo                 text,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_backups_arquivo_recebimento
        FOREIGN KEY (arquivo_id, recebimento_id)
        REFERENCES alm.arquivos(id, recebimento_id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_backup_arquivo_provider_namespace
        UNIQUE (arquivo_id, backup_provider, backup_namespace),
    CONSTRAINT ck_backup_provider CHECK (
        backup_provider ~ '^[A-Z][A-Z0-9_]{1,29}$'
    ),
    CONSTRAINT ck_backup_namespace CHECK (btrim(backup_namespace) <> ''),
    CONSTRAINT ck_backup_disponivel CHECK (
        status <> 'DISPONIVEL'
        OR (
            nullif(btrim(backup_object_id), '') IS NOT NULL
            AND copiado_em IS NOT NULL
        )
    )
);

CREATE TABLE alm.divergencias (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recebimento_id              uuid NOT NULL REFERENCES alm.recebimentos(id)
                                ON DELETE RESTRICT,
    item_id                     uuid,
    tipo_divergencia_codigo     varchar(40) NOT NULL REFERENCES alm.tipos_divergencia(codigo)
                                ON DELETE RESTRICT,
    severidade                  varchar(10) NOT NULL DEFAULT 'MEDIA' CHECK (
        severidade IN ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')
    ),
    descricao                   text NOT NULL CHECK (btrim(descricao) <> ''),
    status                      varchar(20) NOT NULL DEFAULT 'ABERTA' CHECK (
        status IN ('ABERTA', 'EM_TRATAMENTO', 'RESOLVIDA', 'CANCELADA')
    ),
    responsavel_tratamento_id   uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    resolucao                   text,
    resolvida_em                timestamptz,
    resolvida_por               uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    criado_por                  uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    alterado_em                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por                uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    versao                      bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
    excluido_em                 timestamptz,
    excluido_por                uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    motivo_exclusao             text,
    CONSTRAINT fk_divergencias_item_mesmo_recebimento
        FOREIGN KEY (item_id, recebimento_id)
        REFERENCES alm.recebimento_itens(id, recebimento_id)
        ON DELETE RESTRICT,
    CONSTRAINT ck_divergencias_resolucao CHECK (
        status <> 'RESOLVIDA'
        OR (
            nullif(btrim(resolucao), '') IS NOT NULL
            AND resolvida_em IS NOT NULL
            AND resolvida_por IS NOT NULL
        )
    ),
    CONSTRAINT ck_divergencias_exclusao CHECK (
        (excluido_em IS NULL AND excluido_por IS NULL AND motivo_exclusao IS NULL)
        OR
        (excluido_em IS NOT NULL AND excluido_por IS NOT NULL
         AND nullif(btrim(motivo_exclusao), '') IS NOT NULL)
    )
);

CREATE TABLE alm.recebimento_status_historico (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recebimento_id              uuid NOT NULL REFERENCES alm.recebimentos(id)
                                ON DELETE RESTRICT,
    status_anterior             varchar(40) CHECK (
        status_anterior IS NULL OR status_anterior IN (
            'EM_DIGITACAO', 'AGUARDANDO_DOCUMENTACAO', 'EM_CONFERENCIA',
            'DIVERGENCIA_IDENTIFICADA', 'CONFERIDO_FINALIZADO'
        )
    ),
    status_novo                 varchar(40) NOT NULL CHECK (
        status_novo IN (
            'EM_DIGITACAO', 'AGUARDANDO_DOCUMENTACAO', 'EM_CONFERENCIA',
            'DIVERGENCIA_IDENTIFICADA', 'CONFERIDO_FINALIZADO'
        )
    ),
    observacao                  text,
    alterado_em                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_por                uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    ator_tipo                   varchar(10) NOT NULL CHECK (
        ator_tipo IN ('USUARIO', 'SISTEMA')
    ),
    ator_identificador          text NOT NULL,
    CHECK (status_anterior IS DISTINCT FROM status_novo),
    CHECK (
        (ator_tipo = 'USUARIO' AND alterado_por IS NOT NULL)
        OR
        (ator_tipo = 'SISTEMA' AND alterado_por IS NULL)
    )
);

CREATE TABLE alm.historico_alteracoes (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recebimento_id              uuid REFERENCES alm.recebimentos(id) ON DELETE RESTRICT,
    entidade                    varchar(60) NOT NULL,
    entidade_id                 text NOT NULL,
    acao                        varchar(30) NOT NULL CHECK (
        acao IN ('INSERCAO', 'ALTERACAO', 'EXCLUSAO_LOGICA', 'EXCLUSAO_FISICA')
    ),
    usuario_id                  uuid REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    ator_tipo                   varchar(10) NOT NULL DEFAULT 'USUARIO' CHECK (
        ator_tipo IN ('USUARIO', 'SISTEMA')
    ),
    ator_identificador          text NOT NULL,
    request_id                  uuid,
    ip                          inet,
    user_agent                  text,
    dados_antes                 jsonb,
    dados_depois               jsonb,
    campos_alterados            text[],
    detalhes                    text,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (dados_antes IS NULL OR jsonb_typeof(dados_antes) = 'object'),
    CHECK (dados_depois IS NULL OR jsonb_typeof(dados_depois) = 'object'),
    CHECK (
        (ator_tipo = 'USUARIO' AND usuario_id IS NOT NULL)
        OR
        (ator_tipo = 'SISTEMA' AND usuario_id IS NULL)
    )
);

CREATE TABLE alm.lotes_migracao (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                      text NOT NULL UNIQUE,
    raiz_origem                 text NOT NULL,
    status                      varchar(30) NOT NULL DEFAULT 'CRIADO' CHECK (
        status IN (
            'CRIADO', 'INVENTARIANDO', 'DRY_RUN', 'IMPORTANDO',
            'CONCLUIDO', 'CONCLUIDO_COM_ERROS', 'ROLLBACK_EM_ANDAMENTO',
            'REVERTIDO', 'FALHOU'
        )
    ),
    configuracao                jsonb NOT NULL DEFAULT '{}'::jsonb,
    total_arquivos              bigint NOT NULL DEFAULT 0,
    total_bytes                 bigint NOT NULL DEFAULT 0,
    total_importados            bigint NOT NULL DEFAULT 0,
    total_duplicados            bigint NOT NULL DEFAULT 0,
    total_erros                 bigint NOT NULL DEFAULT 0,
    versao_importador           text NOT NULL,
    iniciado_em                 timestamptz,
    concluido_em                timestamptz,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    criado_por                  uuid NOT NULL REFERENCES alm.usuarios(id) ON DELETE RESTRICT,
    CHECK (jsonb_typeof(configuracao) = 'object')
);

CREATE TABLE alm.itens_migracao (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lote_id                     uuid NOT NULL REFERENCES alm.lotes_migracao(id)
                                ON DELETE RESTRICT,
    chave_origem                text NOT NULL,
    caminho_relativo            text NOT NULL,
    nome_arquivo                text NOT NULL,
    tamanho_bytes               bigint NOT NULL CHECK (tamanho_bytes >= 0),
    modificado_em_origem        timestamptz,
    checksum_sha256             char(64) CHECK (
        checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
    metadados_extraidos         jsonb NOT NULL DEFAULT '{}'::jsonb,
    confianca_extracao          numeric(5,4) CHECK (
        confianca_extracao IS NULL OR confianca_extracao BETWEEN 0 AND 1
    ),
    status                      varchar(25) NOT NULL DEFAULT 'DESCOBERTO' CHECK (
        status IN (
            'DESCOBERTO', 'ANALISADO', 'DUPLICADO', 'COPIADO',
            'VINCULADO', 'ERRO', 'VALIDADO', 'REVERTIDO'
        )
    ),
    recebimento_id              uuid REFERENCES alm.recebimentos(id) ON DELETE RESTRICT,
    arquivo_id                  uuid REFERENCES alm.arquivos(id) ON DELETE RESTRICT,
    tentativas                  smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
    erro_codigo                 text,
    erro_detalhe                text,
    criado_em                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    alterado_em                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_itens_migracao_origem UNIQUE (lote_id, chave_origem),
    CHECK (jsonb_typeof(metadados_extraidos) = 'object')
);

CREATE OR REPLACE FUNCTION alm.normalizar_texto(p_texto text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT btrim(
        regexp_replace(
            lower(public.unaccent(coalesce(p_texto, ''))),
            '[^a-z0-9]+',
            ' ',
            'g'
        )
    );
$$;

CREATE OR REPLACE FUNCTION alm.normalizar_identificador(p_texto text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT upper(
        regexp_replace(
            public.unaccent(coalesce(p_texto, '')),
            '[^A-Za-z0-9]',
            '',
            'g'
        )
    );
$$;

CREATE OR REPLACE FUNCTION alm.preparar_usuario()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.email := lower(btrim(NEW.email));
    NEW.nome_busca := alm.normalizar_texto(NEW.nome);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION alm.preparar_fornecedor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.nome_busca := alm.normalizar_texto(
        concat_ws(' ', NEW.razao_social, NEW.nome_fantasia, NEW.cnpj)
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION alm.preparar_recebimento()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_ano smallint;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.origem = 'MIGRACAO' THEN
            NEW.qualidade_dados := coalesce(NEW.qualidade_dados, 'NAO_CONFERIDO');
            NEW.status := NULL;
        ELSE
            NEW.qualidade_dados := coalesce(NEW.qualidade_dados, 'PENDENTE_CONFERENCIA');
            NEW.status := coalesce(NEW.status, 'EM_DIGITACAO');
        END IF;
    ELSIF NEW.origem IS DISTINCT FROM OLD.origem THEN
        RAISE EXCEPTION 'origem do recebimento e imutavel';
    ELSIF OLD.status = 'CONFERIDO_FINALIZADO'
          AND NEW.status IS DISTINCT FROM 'CONFERIDO_FINALIZADO' THEN
        NEW.qualidade_dados := 'PENDENTE_CONFERENCIA';
    END IF;

    IF NEW.status = 'CONFERIDO_FINALIZADO' THEN
        NEW.qualidade_dados := 'CONFERIDO';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.codigo IS NOT NULL THEN
            RAISE EXCEPTION 'codigo e gerado exclusivamente pelo banco';
        END IF;
        v_ano := coalesce(
            extract(year FROM NEW.recebido_em AT TIME ZONE 'America/Sao_Paulo')::smallint,
            NEW.ano_referencia,
            extract(year FROM clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::smallint
        );
        NEW.codigo := alm.proximo_codigo_recebimento(v_ano);
    ELSIF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
        RAISE EXCEPTION 'codigo do recebimento e imutavel';
    END IF;

    IF NEW.fornecedor_id IS NOT NULL
       AND (
           TG_OP = 'INSERT'
           OR NEW.fornecedor_id IS DISTINCT FROM OLD.fornecedor_id
           OR nullif(btrim(NEW.fornecedor_nome_snapshot), '') IS NULL
       ) THEN
        SELECT coalesce(f.nome_fantasia, f.razao_social), f.cnpj
          INTO NEW.fornecedor_nome_snapshot, NEW.fornecedor_cnpj_snapshot
          FROM alm.fornecedores f
         WHERE f.id = NEW.fornecedor_id;
    ELSIF NEW.origem = 'OPERACIONAL' AND NEW.fornecedor_id IS NULL THEN
        NEW.fornecedor_nome_snapshot := NULL;
        NEW.fornecedor_cnpj_snapshot := NULL;
    END IF;

    NEW.numero_nf_busca := alm.normalizar_identificador(NEW.numero_nf);
    NEW.pedido_busca := alm.normalizar_identificador(NEW.pedido_compra);
    NEW.fornecedor_busca := alm.normalizar_texto(
        concat_ws(' ', NEW.fornecedor_nome_snapshot, NEW.fornecedor_cnpj_snapshot)
    );
    NEW.busca_fts :=
          setweight(to_tsvector('simple', NEW.numero_nf_busca), 'A')
        || setweight(to_tsvector('simple', NEW.pedido_busca), 'A')
        || setweight(to_tsvector('portuguese', public.unaccent(coalesce(NEW.fornecedor_nome_snapshot, ''))), 'B')
        || setweight(to_tsvector('portuguese', public.unaccent(coalesce(NEW.observacoes, ''))), 'D');
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION alm.preparar_item()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.codigo_produto_busca := alm.normalizar_identificador(NEW.codigo_produto);
    NEW.descricao_busca := alm.normalizar_texto(NEW.descricao);
    NEW.busca_fts :=
          setweight(to_tsvector('simple', NEW.codigo_produto_busca), 'A')
        || setweight(to_tsvector('portuguese', public.unaccent(NEW.descricao)), 'B')
        || setweight(to_tsvector('portuguese', public.unaccent(coalesce(NEW.observacoes, ''))), 'C');
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_usuario_preparar
BEFORE INSERT OR UPDATE OF email, nome ON alm.usuarios
FOR EACH ROW EXECUTE FUNCTION alm.preparar_usuario();

CREATE TRIGGER trg_fornecedor_preparar
BEFORE INSERT OR UPDATE OF razao_social, nome_fantasia, cnpj ON alm.fornecedores
FOR EACH ROW EXECUTE FUNCTION alm.preparar_fornecedor();

CREATE TRIGGER trg_recebimento_preparar
BEFORE INSERT OR UPDATE OF codigo, numero_nf, pedido_compra, fornecedor_id,
    fornecedor_nome_snapshot, fornecedor_cnpj_snapshot, observacoes, status,
    qualidade_dados, origem
ON alm.recebimentos
FOR EACH ROW EXECUTE FUNCTION alm.preparar_recebimento();

CREATE TRIGGER trg_item_preparar
BEFORE INSERT OR UPDATE OF codigo_produto, descricao, observacoes
ON alm.recebimento_itens
FOR EACH ROW EXECUTE FUNCTION alm.preparar_item();

CREATE OR REPLACE FUNCTION alm.validar_hierarquia_container()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_parent_finalidade varchar(30);
    v_parent_recebimento uuid;
BEGIN
    IF NEW.finalidade = 'ROOT' THEN
        RETURN NEW;
    END IF;

    SELECT finalidade, recebimento_id
      INTO v_parent_finalidade, v_parent_recebimento
      FROM alm.storage_containers
     WHERE id = NEW.parent_id
       AND storage_provider = NEW.storage_provider
       AND storage_namespace = NEW.storage_namespace;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Container pai inexistente no mesmo provider/namespace';
    END IF;

    IF (NEW.finalidade = 'ANO' AND v_parent_finalidade <> 'ROOT')
       OR (NEW.finalidade = 'MES' AND v_parent_finalidade <> 'ANO')
       OR (NEW.finalidade = 'RECEBIMENTO' AND v_parent_finalidade <> 'MES')
       OR (
            NEW.finalidade = 'CATEGORIA'
            AND (
                v_parent_finalidade <> 'RECEBIMENTO'
                OR v_parent_recebimento IS DISTINCT FROM NEW.recebimento_id
            )
       )
       OR (NEW.finalidade = 'QUARENTENA' AND v_parent_finalidade <> 'ROOT') THEN
        RAISE EXCEPTION 'Hierarquia de containers invalida para %', NEW.finalidade;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_container_validar_hierarquia
BEFORE INSERT OR UPDATE OF parent_id, finalidade, recebimento_id,
    storage_provider, storage_namespace
ON alm.storage_containers
FOR EACH ROW EXECUTE FUNCTION alm.validar_hierarquia_container();

CREATE OR REPLACE FUNCTION alm.validar_arquivo_container()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_container_status varchar(20);
BEGIN
    IF NEW.status_upload = 'DISPONIVEL' THEN
        SELECT status
          INTO v_container_status
          FROM alm.storage_containers
         WHERE id = NEW.storage_container_id
           AND recebimento_id = NEW.recebimento_id
           AND storage_provider = NEW.storage_provider
           AND storage_namespace = NEW.storage_namespace
           AND tipo_arquivo_codigo = NEW.tipo_arquivo_codigo;

        IF v_container_status IS DISTINCT FROM 'DISPONIVEL' THEN
            RAISE EXCEPTION 'Arquivo nao pode ficar disponivel sem container disponivel';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_arquivo_validar_container
BEFORE INSERT OR UPDATE OF status_upload, storage_container_id,
    recebimento_id, storage_provider, storage_namespace, tipo_arquivo_codigo
ON alm.arquivos
FOR EACH ROW EXECUTE FUNCTION alm.validar_arquivo_container();

CREATE OR REPLACE FUNCTION alm.atualizar_controle_linha()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_usuario uuid;
BEGIN
    v_usuario := nullif(current_setting('app.usuario_id', true), '')::uuid;
    NEW.alterado_em := clock_timestamp();
    NEW.versao := OLD.versao + 1;
    IF v_usuario IS NOT NULL THEN
        NEW.alterado_por := v_usuario;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION alm.atualizar_controle_usuario()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.alterado_em := clock_timestamp();
    NEW.versao := OLD.versao + 1;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION alm.atualizar_timestamp_catalogo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.alterado_em := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_usuario_controle BEFORE UPDATE ON alm.usuarios
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_usuario();

CREATE TRIGGER trg_unidade_timestamp BEFORE UPDATE ON alm.unidades_medida
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_timestamp_catalogo();
CREATE TRIGGER trg_tipo_recebimento_timestamp BEFORE UPDATE ON alm.tipos_recebimento
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_timestamp_catalogo();
CREATE TRIGGER trg_tipo_arquivo_timestamp BEFORE UPDATE ON alm.tipos_arquivo
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_timestamp_catalogo();
CREATE TRIGGER trg_tipo_divergencia_timestamp BEFORE UPDATE ON alm.tipos_divergencia
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_timestamp_catalogo();
CREATE TRIGGER trg_backup_timestamp BEFORE UPDATE ON alm.arquivo_backups
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_timestamp_catalogo();

CREATE TRIGGER trg_fornecedor_controle BEFORE UPDATE ON alm.fornecedores
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_linha();
CREATE TRIGGER trg_recebimento_controle BEFORE UPDATE ON alm.recebimentos
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_linha();
CREATE TRIGGER trg_item_controle BEFORE UPDATE ON alm.recebimento_itens
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_linha();
CREATE TRIGGER trg_container_controle BEFORE UPDATE ON alm.storage_containers
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_linha();
CREATE TRIGGER trg_arquivo_controle BEFORE UPDATE ON alm.arquivos
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_linha();
CREATE TRIGGER trg_divergencia_controle BEFORE UPDATE ON alm.divergencias
FOR EACH ROW EXECUTE FUNCTION alm.atualizar_controle_linha();

CREATE OR REPLACE FUNCTION alm.bloquear_mutacao_filho_finalizado()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_recebimento_id uuid;
    v_status varchar(40);
    v_sistema text := nullif(current_setting('app.ator_sistema', true), '');
    v_antes_funcional jsonb;
    v_depois_funcional jsonb;
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

    -- O reconciliador pode apenas atualizar campos tecnicos de um arquivo finalizado.
    IF TG_TABLE_NAME = 'arquivos' AND TG_OP = 'UPDATE' AND v_sistema IS NOT NULL THEN
        v_antes_funcional := to_jsonb(OLD) - ARRAY[
            'status_upload', 'integridade_verificada_em', 'storage_etag',
            'storage_version_id', 'provider_metadata', 'alterado_em',
            'alterado_por', 'versao'
        ];
        v_depois_funcional := to_jsonb(NEW) - ARRAY[
            'status_upload', 'integridade_verificada_em', 'storage_etag',
            'storage_version_id', 'provider_metadata', 'alterado_em',
            'alterado_por', 'versao'
        ];
        IF v_antes_funcional = v_depois_funcional
           AND OLD.status_upload = 'DISPONIVEL'
           AND NEW.status_upload IN ('DISPONIVEL', 'INCONSISTENTE') THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Reabra o recebimento antes de alterar itens, arquivos ou divergencias';
END;
$$;

CREATE TRIGGER trg_item_bloquear_finalizado
BEFORE INSERT OR UPDATE OR DELETE ON alm.recebimento_itens
FOR EACH ROW EXECUTE FUNCTION alm.bloquear_mutacao_filho_finalizado();
CREATE TRIGGER trg_arquivo_bloquear_finalizado
BEFORE INSERT OR UPDATE OR DELETE ON alm.arquivos
FOR EACH ROW EXECUTE FUNCTION alm.bloquear_mutacao_filho_finalizado();
CREATE TRIGGER trg_divergencia_bloquear_finalizado
BEFORE INSERT OR UPDATE OR DELETE ON alm.divergencias
FOR EACH ROW EXECUTE FUNCTION alm.bloquear_mutacao_filho_finalizado();

CREATE OR REPLACE FUNCTION alm.incrementar_versao_agregado()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_recebimento_id uuid;
    v_usuario uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
BEGIN
    v_recebimento_id := CASE
        WHEN TG_OP = 'DELETE' THEN OLD.recebimento_id
        ELSE NEW.recebimento_id
    END;

    UPDATE alm.recebimentos
       SET alterado_por = coalesce(v_usuario, alterado_por)
     WHERE id = v_recebimento_id;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_item_incrementar_agregado
AFTER INSERT OR UPDATE OR DELETE ON alm.recebimento_itens
FOR EACH ROW EXECUTE FUNCTION alm.incrementar_versao_agregado();
CREATE TRIGGER trg_arquivo_incrementar_agregado
AFTER INSERT OR UPDATE OR DELETE ON alm.arquivos
FOR EACH ROW EXECUTE FUNCTION alm.incrementar_versao_agregado();
CREATE TRIGGER trg_divergencia_incrementar_agregado
AFTER INSERT OR UPDATE OR DELETE ON alm.divergencias
FOR EACH ROW EXECUTE FUNCTION alm.incrementar_versao_agregado();

CREATE OR REPLACE FUNCTION alm.validar_finalizacao_recebimento()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'CONFERIDO_FINALIZADO'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN

        IF NEW.origem <> 'OPERACIONAL' OR NEW.excluido_em IS NOT NULL THEN
            RAISE EXCEPTION 'Registro historico/excluido nao pode ser finalizado pelo fluxo';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM alm.recebimento_itens i
             WHERE i.recebimento_id = NEW.id AND i.excluido_em IS NULL
        ) THEN
            RAISE EXCEPTION 'Inclua ao menos um item antes de finalizar';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM alm.arquivos a
             WHERE a.recebimento_id = NEW.id
               AND a.tipo_arquivo_codigo = 'NOTA_FISCAL'
               AND a.status_upload = 'DISPONIVEL'
               AND a.excluido_em IS NULL
        ) THEN
            RAISE EXCEPTION 'Anexe a Nota Fiscal antes de finalizar';
        END IF;

        IF EXISTS (
            SELECT 1 FROM alm.arquivos a
             WHERE a.recebimento_id = NEW.id
               AND a.excluido_em IS NULL
               AND a.status_upload <> 'DISPONIVEL'
        ) THEN
            RAISE EXCEPTION 'Resolva todos os uploads antes de finalizar';
        END IF;

        IF EXISTS (
            SELECT 1 FROM alm.divergencias d
             WHERE d.recebimento_id = NEW.id
               AND d.excluido_em IS NULL
               AND d.status IN ('ABERTA', 'EM_TRATAMENTO')
        ) THEN
            RAISE EXCEPTION 'Resolva todas as divergencias antes de finalizar';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM alm.recebimento_itens i
             WHERE i.recebimento_id = NEW.id
               AND i.excluido_em IS NULL
               AND i.quantidade_solicitada IS NOT NULL
               AND i.quantidade_solicitada <> i.quantidade_recebida
               AND NOT EXISTS (
                    SELECT 1 FROM alm.divergencias d
                     WHERE d.recebimento_id = NEW.id
                       AND d.item_id = i.id
                       AND d.tipo_divergencia_codigo = 'QUANTIDADE_INCORRETA'
                       AND d.status = 'RESOLVIDA'
                       AND d.excluido_em IS NULL
               )
        ) THEN
            RAISE EXCEPTION 'Diferenca de quantidade exige divergencia tratada';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recebimento_validar_finalizacao
BEFORE INSERT OR UPDATE OF status ON alm.recebimentos
FOR EACH ROW EXECUTE FUNCTION alm.validar_finalizacao_recebimento();

CREATE OR REPLACE FUNCTION alm.registrar_status_recebimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, alm
AS $$
DECLARE
    v_usuario text := nullif(current_setting('app.usuario_id', true), '');
    v_sistema text := nullif(current_setting('app.ator_sistema', true), '');
BEGIN
    IF NEW.status IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN
        RETURN NEW;
    END IF;

    IF (v_usuario IS NULL) = (v_sistema IS NULL) THEN
        RAISE EXCEPTION 'Defina exatamente um ator: app.usuario_id ou app.ator_sistema';
    END IF;

    INSERT INTO alm.recebimento_status_historico (
        recebimento_id, status_anterior, status_novo, observacao,
        alterado_por, ator_tipo, ator_identificador
    ) VALUES (
        NEW.id,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
        NEW.status,
        nullif(current_setting('app.status_observacao', true), ''),
        v_usuario::uuid,
        CASE WHEN v_usuario IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END,
        coalesce(v_usuario, v_sistema)
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recebimento_status_historico
AFTER INSERT OR UPDATE OF status ON alm.recebimentos
FOR EACH ROW EXECUTE FUNCTION alm.registrar_status_recebimento();

CREATE OR REPLACE FUNCTION alm.impedir_mutacao_historico()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Historico append-only: alteracao ou exclusao proibida';
END;
$$;

CREATE TRIGGER trg_status_historico_imutavel
BEFORE UPDATE OR DELETE ON alm.recebimento_status_historico
FOR EACH ROW EXECUTE FUNCTION alm.impedir_mutacao_historico();

CREATE TRIGGER trg_status_historico_sem_truncate
BEFORE TRUNCATE ON alm.recebimento_status_historico
FOR EACH STATEMENT EXECUTE FUNCTION alm.impedir_mutacao_historico();

CREATE TRIGGER trg_auditoria_imutavel
BEFORE UPDATE OR DELETE ON alm.historico_alteracoes
FOR EACH ROW EXECUTE FUNCTION alm.impedir_mutacao_historico();

CREATE TRIGGER trg_auditoria_sem_truncate
BEFORE TRUNCATE ON alm.historico_alteracoes
FOR EACH STATEMENT EXECUTE FUNCTION alm.impedir_mutacao_historico();

CREATE TRIGGER trg_acessos_imutavel
BEFORE UPDATE OR DELETE ON alm.arquivo_acessos
FOR EACH ROW EXECUTE FUNCTION alm.impedir_mutacao_historico();

CREATE TRIGGER trg_acessos_sem_truncate
BEFORE TRUNCATE ON alm.arquivo_acessos
FOR EACH STATEMENT EXECUTE FUNCTION alm.impedir_mutacao_historico();

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
    v_campos             text[];
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

CREATE TRIGGER trg_auditar_usuarios
AFTER INSERT OR UPDATE OR DELETE ON alm.usuarios
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_unidades
AFTER INSERT OR UPDATE OR DELETE ON alm.unidades_medida
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_tipos_recebimento
AFTER INSERT OR UPDATE OR DELETE ON alm.tipos_recebimento
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_tipos_arquivo
AFTER INSERT OR UPDATE OR DELETE ON alm.tipos_arquivo
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_tipos_divergencia
AFTER INSERT OR UPDATE OR DELETE ON alm.tipos_divergencia
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_fornecedores
AFTER INSERT OR UPDATE OR DELETE ON alm.fornecedores
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_recebimentos
AFTER INSERT OR UPDATE OR DELETE ON alm.recebimentos
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_itens
AFTER INSERT OR UPDATE OR DELETE ON alm.recebimento_itens
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_containers
AFTER INSERT OR UPDATE OR DELETE ON alm.storage_containers
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_arquivos
AFTER INSERT OR UPDATE OR DELETE ON alm.arquivos
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();
CREATE TRIGGER trg_auditar_divergencias
AFTER INSERT OR UPDATE OR DELETE ON alm.divergencias
FOR EACH ROW EXECUTE FUNCTION alm.auditar_mutacao();

SELECT set_config('app.ator_sistema', 'migration:001_initial_schema', true);

INSERT INTO alm.unidades_medida (codigo, descricao, casas_decimais, ordem) VALUES
    ('PC', 'Peca', 0, 10),
    ('UN', 'Unidade', 0, 20),
    ('KG', 'Quilograma', 3, 30),
    ('M',  'Metro', 3, 40),
    ('L',  'Litro', 3, 50),
    ('CX', 'Caixa', 0, 60),
    ('JG', 'Jogo', 0, 70),
    ('RL', 'Rolo', 0, 80)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO alm.tipos_recebimento (codigo, nome, ordem) VALUES
    ('ESTOQUE', 'Estoque', 10),
    ('DEBITO_DIRETO', 'Debito Direto', 20),
    ('INDUSTRIALIZACAO', 'Industrializacao', 30),
    ('COMODATO', 'Comodato', 40),
    ('OUTRO', 'Outro', 99)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO alm.tipos_arquivo (codigo, nome, ordem) VALUES
    ('NOTA_FISCAL', 'Nota Fiscal', 10),
    ('DACTE', 'DACTE', 20),
    ('PEDIDO_COMPRA', 'Pedido de Compra', 30),
    ('FOTO_PRODUTO', 'Foto do produto', 40),
    ('CERTIFICADO', 'Certificado', 50),
    ('OUTRO', 'Outro documento', 99)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO alm.tipos_divergencia (codigo, nome, ordem) VALUES
    ('QUANTIDADE_INCORRETA', 'Quantidade incorreta', 10),
    ('MATERIAL_AVARIADO', 'Material avariado', 20),
    ('MATERIAL_DIFERENTE', 'Material diferente do solicitado', 30),
    ('FALTA_DOCUMENTACAO', 'Falta de documentacao', 40),
    ('PROBLEMA_EMBALAGEM', 'Problema de embalagem', 50),
    ('OUTRO', 'Outro', 99)
ON CONFLICT (codigo) DO NOTHING;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alm_api') THEN
        CREATE ROLE alm_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alm_job') THEN
        CREATE ROLE alm_job NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END;
$roles$;

REVOKE ALL ON SCHEMA alm FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alm FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA alm FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA alm FROM PUBLIC;

GRANT USAGE ON SCHEMA alm TO alm_api, alm_job;
GRANT SELECT ON ALL TABLES IN SCHEMA alm TO alm_api, alm_job;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA alm TO alm_api, alm_job;

GRANT INSERT, UPDATE ON
    alm.usuarios, alm.unidades_medida, alm.tipos_recebimento,
    alm.tipos_arquivo, alm.tipos_divergencia, alm.fornecedores,
    alm.recebimentos, alm.recebimento_itens, alm.storage_containers,
    alm.arquivos, alm.divergencias
TO alm_api;
GRANT INSERT ON alm.arquivo_acessos TO alm_api;

GRANT INSERT, UPDATE ON
    alm.fornecedores, alm.recebimentos, alm.recebimento_itens,
    alm.storage_containers, alm.arquivos, alm.divergencias,
    alm.arquivo_backups, alm.lotes_migracao, alm.itens_migracao
TO alm_job;

REVOKE ALL ON alm.recebimento_numeradores,
    alm.recebimento_status_historico, alm.historico_alteracoes
FROM alm_api, alm_job;
GRANT SELECT ON alm.recebimento_status_historico,
    alm.historico_alteracoes
TO alm_api, alm_job;

GRANT EXECUTE ON FUNCTION alm.proximo_codigo_recebimento(smallint)
TO alm_api, alm_job;
GRANT EXECUTE ON FUNCTION alm.normalizar_texto(text),
    alm.normalizar_identificador(text)
TO alm_api, alm_job;

COMMIT;
