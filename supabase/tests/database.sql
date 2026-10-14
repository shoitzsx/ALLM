-- Executar depois das tres migrations. Fixtures e funcoes temporarias: ROLLBACK.
BEGIN;
SELECT set_config('app.ator_sistema', 'test:database', true);
SELECT set_config('app.request_id', '00000000-0000-0000-0000-000000000099', true);
CREATE TEMP TABLE resultados (nome text NOT NULL);
GRANT INSERT ON resultados TO alm_api, alm_job;
CREATE FUNCTION pg_temp.ok(nome text, condicao boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF condicao IS DISTINCT FROM true THEN RAISE EXCEPTION 'TESTE FALHOU: %', nome; END IF;
    INSERT INTO resultados VALUES (nome);
END;
$$;
CREATE FUNCTION pg_temp.rejeita(nome text, comando text, codigo text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_codigo text;
BEGIN
    BEGIN
        EXECUTE comando;
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_codigo = RETURNED_SQLSTATE;
    END;
    PERFORM pg_temp.ok(nome, v_codigo = codigo);
END;
$$;

INSERT INTO alm.usuarios (id, nome, perfil, matricula)
VALUES ('00000000-0000-0000-0000-000000000001', 'Teste banco', 'ADMINISTRADOR', 'TEST001');
INSERT INTO alm.fornecedores (id, razao_social) VALUES
('00000000-0000-0000-0000-000000000002', 'Fornecedor teste');
INSERT INTO alm.recebimentos (id, origem, criado_por, alterado_por) VALUES
('00000000-0000-0000-0000-000000000010', 'MIGRACAO', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000011', 'MIGRACAO', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO alm.recebimentos (id, numero_nf, pedido_compra, fornecedor_id, recebido_em,
responsavel_id, tipo_recebimento_id, criado_por, alterado_por)
SELECT '00000000-0000-0000-0000-000000000012', '123', 'PED1',
'00000000-0000-0000-0000-000000000002', clock_timestamp(),
'00000000-0000-0000-0000-000000000001', id,
'00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'
FROM alm.tipos_recebimento WHERE codigo = 'ESTOQUE';
INSERT INTO alm.recebimento_itens (id, recebimento_id, numero_item, descricao, quantidade_recebida,
unidade_codigo, criado_por, alterado_por)
SELECT ('00000000-0000-0000-0000-0000000000' || n)::uuid,
('00000000-0000-0000-0000-0000000000' || r)::uuid, 1, 'Material Águia', 1,
'PC', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'
FROM (VALUES ('20','10'), ('21','11'), ('22','12')) t(n,r);

INSERT INTO alm.storage_containers (id, parent_id, finalidade, recebimento_id, tipo_arquivo_codigo,
storage_namespace, logical_key, storage_object_id, status, nome_administrativo, criado_por, alterado_por)
VALUES
('00000000-0000-0000-0000-000000000030', NULL, 'ROOT', NULL, NULL, 'test', 'root', 'root', 'DISPONIVEL', 'Root', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000030', 'ANO', NULL, NULL, 'test', 'ano', 'ano', 'DISPONIVEL', 'Ano', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000031', 'MES', NULL, NULL, 'test', 'mes', 'mes', 'DISPONIVEL', 'Mes', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
INSERT INTO alm.storage_containers (id, parent_id, finalidade, recebimento_id,
storage_namespace, logical_key, storage_object_id, status, nome_administrativo, criado_por, alterado_por)
SELECT ('00000000-0000-0000-0000-0000000000' || c)::uuid,
'00000000-0000-0000-0000-000000000032', 'RECEBIMENTO',
('00000000-0000-0000-0000-0000000000' || r)::uuid,
'test', c, c, 'DISPONIVEL', c, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'
FROM (VALUES ('33','10'), ('34','12')) t(c,r);
INSERT INTO alm.storage_containers (id, parent_id, finalidade, recebimento_id, tipo_arquivo_codigo,
storage_namespace, logical_key, storage_object_id, status, nome_administrativo, criado_por, alterado_por)
SELECT ('00000000-0000-0000-0000-0000000000' || c)::uuid,
('00000000-0000-0000-0000-0000000000' || p)::uuid, 'CATEGORIA',
('00000000-0000-0000-0000-0000000000' || r)::uuid, 'NOTA_FISCAL',
'test', c, c, 'DISPONIVEL', c, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'
FROM (VALUES ('35','33','10'), ('36','34','12')) t(c,p,r);
INSERT INTO alm.arquivos (id, recebimento_id, tipo_arquivo_codigo, storage_namespace, storage_object_id,
storage_container_id, nome_original, nome_storage, mime_type_detectado, tamanho_bytes,
checksum_sha256, idempotency_key, status_upload, criado_por, alterado_por)
SELECT ('00000000-0000-0000-0000-0000000000' || a)::uuid,
('00000000-0000-0000-0000-0000000000' || r)::uuid, 'NOTA_FISCAL', 'test', a,
('00000000-0000-0000-0000-0000000000' || c)::uuid, 'nota.pdf', 'nota.pdf', 'application/pdf', 100,
repeat('a',64), gen_random_uuid(), 'DISPONIVEL',
'00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'
FROM (VALUES ('40','10','35'), ('41','12','36')) t(a,r,c);

DO $$
DECLARE
    u constant text := '00000000-0000-0000-0000-000000000001';
    h constant text := '00000000-0000-0000-0000-000000000010';
    b constant text := '00000000-0000-0000-0000-000000000011';
    f constant text := '00000000-0000-0000-0000-000000000012';
    a constant text := '00000000-0000-0000-0000-000000000040';
    t text;
    v1 bigint;
    v2 bigint;
    antes bigint;
BEGIN
    PERFORM pg_temp.ok('historico NULL aceita filhos', EXISTS(SELECT 1 FROM alm.recebimento_itens WHERE recebimento_id = h::uuid));
    FOR t IN SELECT unnest(ARRAY['recebimentos','arquivos']) LOOP
        PERFORM pg_temp.rejeita(t || ' exclusao parcial', format('UPDATE alm.%I SET excluido_em = now()', t), '23514');
        PERFORM pg_temp.rejeita(t || ' motivo vazio', format('UPDATE alm.%I SET excluido_em = now(), excluido_por = %L, motivo_exclusao = %L', t,u,'  '), '23514');
    END LOOP;
    SELECT count(*) INTO antes FROM alm.historico_alteracoes;
    UPDATE alm.recebimentos SET excluido_em = now(), excluido_por = u::uuid, motivo_exclusao = 'Teste' WHERE id = h::uuid;
    PERFORM pg_temp.rejeita('restauracao parcial recebimento', format('UPDATE alm.recebimentos SET excluido_em=NULL WHERE id=%L',h), '23514');
    PERFORM pg_temp.ok('recebimento permanece excluido', EXISTS(SELECT 1 FROM alm.recebimentos WHERE id=h::uuid AND excluido_em IS NOT NULL));
    PERFORM pg_temp.ok('anexo preservado e ativo', EXISTS(SELECT 1 FROM alm.arquivos WHERE id=a::uuid AND recebimento_id=h::uuid AND excluido_em IS NULL));
    PERFORM pg_temp.ok('consulta ativos oculta recebimento', NOT EXISTS(SELECT 1 FROM alm.recebimentos WHERE id=h::uuid AND excluido_em IS NULL));
    PERFORM pg_temp.ok('historico nao apagado', (SELECT count(*) > antes FROM alm.historico_alteracoes));
    PERFORM pg_temp.ok('auditoria exclusao recebimento', EXISTS(SELECT 1 FROM alm.historico_alteracoes WHERE entidade_id=h AND acao='EXCLUSAO_LOGICA'));
    UPDATE alm.recebimentos SET excluido_em=NULL, excluido_por=NULL, motivo_exclusao=NULL WHERE id=h::uuid;
    PERFORM pg_temp.ok('restauracao recebimento ativa', EXISTS(SELECT 1 FROM alm.recebimentos WHERE id=h::uuid AND excluido_em IS NULL));
    PERFORM pg_temp.ok('auditoria restauracao recebimento', EXISTS(SELECT 1 FROM alm.historico_alteracoes WHERE entidade_id=h AND acao='ALTERACAO' AND dados_antes->>'excluido_em' IS NOT NULL AND dados_depois->>'excluido_em' IS NULL));
    UPDATE alm.arquivos SET excluido_em=now(), excluido_por=u::uuid, motivo_exclusao='Teste', armazenamento_estado='QUARENTENA_PENDENTE' WHERE id=a::uuid;
    PERFORM pg_temp.rejeita('restauracao parcial arquivo', format('UPDATE alm.arquivos SET excluido_em=NULL WHERE id=%L',a), '23514');
    PERFORM pg_temp.ok('arquivo preservado com FK', EXISTS(SELECT 1 FROM alm.arquivos WHERE id=a::uuid AND recebimento_id=h::uuid));
    PERFORM pg_temp.ok('consulta ativos oculta arquivo', NOT EXISTS(SELECT 1 FROM alm.arquivos WHERE id=a::uuid AND excluido_em IS NULL));
    PERFORM pg_temp.ok('auditoria exclusao arquivo', EXISTS(SELECT 1 FROM alm.historico_alteracoes WHERE entidade_id=a AND acao='EXCLUSAO_LOGICA'));
    UPDATE alm.arquivos SET armazenamento_estado='EM_QUARENTENA', quarentena_em=now() WHERE id=a::uuid;
    UPDATE alm.arquivos SET excluido_em=NULL, excluido_por=NULL, motivo_exclusao=NULL WHERE id=a::uuid;
    PERFORM pg_temp.ok('restauracao logica nao inventa restauracao fisica', EXISTS(SELECT 1 FROM alm.arquivos WHERE id=a::uuid AND excluido_em IS NULL AND armazenamento_estado='EM_QUARENTENA'));
    PERFORM pg_temp.ok('auditoria restauracao arquivo', EXISTS(SELECT 1 FROM alm.historico_alteracoes WHERE entidade_id=a AND dados_antes->>'excluido_em' IS NOT NULL AND dados_depois->>'excluido_em' IS NULL));
    PERFORM pg_temp.ok('sem evento externo automatico', NOT EXISTS(SELECT 1 FROM alm.outbox));

    SELECT versao INTO v1 FROM alm.recebimentos WHERE id=h::uuid;
    SELECT versao INTO v2 FROM alm.recebimentos WHERE id=b::uuid;
    UPDATE alm.recebimento_itens SET numero_item=2, recebimento_id=b::uuid WHERE id='00000000-0000-0000-0000-000000000020';
    PERFORM pg_temp.ok('versao pai antigo', (SELECT versao=v1+1 FROM alm.recebimentos WHERE id=h::uuid));
    PERFORM pg_temp.ok('versao pai novo', (SELECT versao=v2+1 FROM alm.recebimentos WHERE id=b::uuid));
    UPDATE alm.recebimento_itens SET recebimento_id=h::uuid WHERE id='00000000-0000-0000-0000-000000000020';
    PERFORM pg_temp.rejeita('duplicidade item ativo', format('UPDATE alm.recebimento_itens SET recebimento_id=%L, numero_item=1 WHERE id=%L', b, '00000000-0000-0000-0000-000000000020'), '23505');
    -- Mesmo numero em outro pai ja foi inserido nas fixtures.
    PERFORM pg_temp.ok('mesmo numero em pais diferentes', (SELECT count(*)=2 FROM alm.recebimento_itens WHERE numero_item=1));
    UPDATE alm.recebimento_itens SET excluido_em=now(), excluido_por=u::uuid, motivo_exclusao='Teste' WHERE id='00000000-0000-0000-0000-000000000021';
    UPDATE alm.recebimento_itens SET recebimento_id=b::uuid, numero_item=1 WHERE id='00000000-0000-0000-0000-000000000020';
    PERFORM pg_temp.ok('reutilizacao numero apos soft delete', EXISTS(SELECT 1 FROM alm.recebimento_itens WHERE recebimento_id=b::uuid AND numero_item=1 AND excluido_em IS NULL));

    UPDATE alm.recebimentos SET status='CONFERIDO_FINALIZADO' WHERE id=f::uuid;
    PERFORM pg_temp.ok('historico status preservado', EXISTS(SELECT 1 FROM alm.recebimento_status_historico WHERE recebimento_id=f::uuid AND status_novo='CONFERIDO_FINALIZADO'));
    PERFORM pg_temp.rejeita('edicao finalizado', format('UPDATE alm.recebimentos SET observacoes=%L WHERE id=%L','Alterada',f), 'P0001');
    PERFORM pg_temp.rejeita('reabrir e editar', format('UPDATE alm.recebimentos SET status=%L, numero_nf=%L WHERE id=%L','EM_CONFERENCIA','456',f), 'P0001');
    PERFORM pg_temp.rejeita('filho finalizado para aberto', format('UPDATE alm.recebimento_itens SET recebimento_id=%L, numero_item=99 WHERE recebimento_id=%L',b,f), 'P0001');
    PERFORM pg_temp.rejeita('filho aberto para finalizado', format('UPDATE alm.recebimento_itens SET recebimento_id=%L, numero_item=99 WHERE recebimento_id=%L AND excluido_em IS NULL',f,b), 'P0001');
    UPDATE alm.arquivos SET integridade_verificada_em=now() WHERE recebimento_id=f::uuid;
    PERFORM pg_temp.ok('excecao tecnica sistema', EXISTS(SELECT 1 FROM alm.arquivos WHERE recebimento_id=f::uuid AND integridade_verificada_em IS NOT NULL));
    PERFORM set_config('app.ator_sistema','',true);
    PERFORM set_config('app.usuario_id',u,true);
    PERFORM pg_temp.rejeita('excecao tecnica negada para usuario', format('UPDATE alm.arquivos SET integridade_verificada_em=now() WHERE recebimento_id=%L',f), 'P0001');
    PERFORM set_config('app.usuario_id','',true);
    PERFORM set_config('app.ator_sistema','test:database',true);
    PERFORM pg_temp.rejeita('excecao nao permite funcional', format('UPDATE alm.arquivos SET nome_original=%L WHERE recebimento_id=%L','outro.pdf',f), 'P0001');
    UPDATE alm.recebimentos SET status='EM_CONFERENCIA' WHERE id=f::uuid;
    UPDATE alm.recebimentos SET observacoes='Editavel novamente' WHERE id=f::uuid;
    PERFORM pg_temp.ok('reabertura isolada e edicao posterior', EXISTS(SELECT 1 FROM alm.recebimentos WHERE id=f::uuid AND observacoes='Editavel novamente' AND qualidade_dados='PENDENTE_CONFERENCIA'));

    INSERT INTO alm.filtros_salvos (modulo,nome,definicao,dono_id,alterado_por) VALUES ('RECEBIMENTOS','Teste','{}',u::uuid,u::uuid);
    PERFORM pg_temp.rejeita('filtro parcial', 'UPDATE alm.filtros_salvos SET excluido_em=now()', '23514');
    PERFORM pg_temp.rejeita('filtro motivo vazio', format('UPDATE alm.filtros_salvos SET excluido_em=now(), excluido_por=%L, motivo_exclusao=%L',u,''), '23514');
    UPDATE alm.filtros_salvos SET excluido_em=now(), excluido_por=u::uuid, motivo_exclusao='Teste';
    PERFORM pg_temp.rejeita('restauracao parcial filtro', 'UPDATE alm.filtros_salvos SET motivo_exclusao=NULL', '23514');
    UPDATE alm.filtros_salvos SET excluido_em=NULL, excluido_por=NULL, motivo_exclusao=NULL;
    PERFORM pg_temp.ok('filtro exclui e restaura', EXISTS(SELECT 1 FROM alm.filtros_salvos WHERE nome='Teste' AND excluido_em IS NULL));

    INSERT INTO alm.credenciais_pin (usuario_id,pin_hash,algoritmo) VALUES (u::uuid,'SEGREDO_PIN_TESTE','scrypt');
    INSERT INTO alm.sessoes (usuario_id,token_hash,ocioso_max_segundos,expira_em) VALUES (u::uuid,decode(repeat('ab',32),'hex'),1800,now()+interval '8 hours');
    PERFORM pg_temp.ok('auditoria sem hashes', NOT EXISTS(SELECT 1 FROM alm.historico_alteracoes WHERE coalesce(dados_antes,'{}') ?| ARRAY['pin_hash','token_hash'] OR coalesce(dados_depois,'{}') ?| ARRAY['pin_hash','token_hash'] OR coalesce(dados_depois,'{}')::text LIKE '%SEGREDO_PIN_TESTE%'));
    PERFORM pg_temp.ok('auditoria nova sem derivados', NOT EXISTS(SELECT 1 FROM alm.historico_alteracoes WHERE request_id='00000000-0000-0000-0000-000000000099' AND coalesce(dados_depois,'{}') ?| ARRAY['busca_fts','nome_busca','numero_nf_busca','pedido_busca','fornecedor_busca','codigo_produto_busca','descricao_busca']));
    PERFORM pg_temp.ok('default usuario novo', (SELECT NOT legado FROM alm.usuarios WHERE id=u::uuid));
    PERFORM pg_temp.rejeita('novo usuario sem matricula', 'INSERT INTO alm.usuarios (nome,perfil) VALUES (''Sem matricula'',''CONSULTA'')', '23514');
    PERFORM pg_temp.rejeita('OIDC somente issuer', 'INSERT INTO alm.usuarios (nome,perfil,matricula,oidc_issuer) VALUES (''OIDC'',''CONSULTA'',''OIDC1'',''issuer'')', '23514');
    PERFORM pg_temp.rejeita('OIDC somente subject', 'INSERT INTO alm.usuarios (nome,perfil,matricula,oidc_subject) VALUES (''OIDC'',''CONSULTA'',''OIDC2'',''subject'')', '23514');
    PERFORM pg_temp.ok('RLS em todas tabelas', NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='alm' AND c.relkind='r' AND NOT c.relrowsecurity));
    PERFORM pg_temp.ok('policy tecnica em todas tabelas', NOT EXISTS(SELECT 1 FROM pg_tables t WHERE schemaname='alm' AND NOT EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname=t.schemaname AND p.tablename=t.tablename AND p.policyname='p_tecnico')));
    FOR t IN SELECT unnest(ARRAY['alm_api','alm_job']) LOOP
        PERFORM pg_temp.ok(t || ' sem numerador', NOT has_table_privilege(t,'alm.recebimento_numeradores','SELECT,INSERT,UPDATE,DELETE'));
        PERFORM pg_temp.ok(t || ' executa gerador', has_function_privilege(t,'alm.proximo_codigo_recebimento(smallint)','EXECUTE'));
        PERFORM pg_temp.ok(t || ' sem DELETE negocio', NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='alm' AND c.relkind='r' AND c.relname <> 'sessoes' AND has_table_privilege(t,c.oid,'DELETE')));
    END LOOP;
END;
$$;

-- Todas as combinacoes de vinculo da Portaria, inclusive ausencia do autor.
DO $$
DECLARE s text; m integer; comando text; esperado boolean; erro text;
BEGIN
    FOREACH s IN ARRAY ARRAY['REGISTRADA','VINCULADA','CANCELADA'] LOOP
        FOR m IN 0..7 LOOP
            comando := format('INSERT INTO alm.chegadas_portaria (numero_nf,cnpj_emitente,metodo_leitura,status,recebimento_id,vinculada_em,vinculada_por,criado_por,alterado_por) VALUES (''123'',''12345678901234'',''MANUAL'',%L,%s,%s,%s,''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'')',s,
                CASE WHEN (m & 1)>0 THEN '''00000000-0000-0000-0000-000000000010''' ELSE 'NULL' END,
                CASE WHEN (m & 2)>0 THEN 'now()' ELSE 'NULL' END,
                CASE WHEN (m & 4)>0 THEN '''00000000-0000-0000-0000-000000000001''' ELSE 'NULL' END);
            esperado := m = CASE WHEN s='VINCULADA' THEN 7 ELSE 0 END;
            IF esperado THEN EXECUTE comando; PERFORM pg_temp.ok('portaria '||s||'/'||m,true);
            ELSE PERFORM pg_temp.rejeita('portaria '||s||'/'||m,comando,'23514'); END IF;
        END LOOP;
    END LOOP;
    FOREACH s IN ARRAY ARRAY['','   '] LOOP
        PERFORM pg_temp.rejeita('portaria NF vazia '||length(s),format('INSERT INTO alm.chegadas_portaria (numero_nf,cnpj_emitente,metodo_leitura,criado_por,alterado_por) VALUES (%L,''12345678901234'',''MANUAL'',''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'')',s),'23514');
    END LOOP;
END;
$$;

SET LOCAL ROLE alm_api;
SELECT alm.proximo_codigo_recebimento(9998::smallint);
SELECT pg_temp.rejeita('api SELECT numerador negado', 'SELECT * FROM alm.recebimento_numeradores', '42501');
SELECT pg_temp.rejeita('api INSERT numerador negado', 'INSERT INTO alm.recebimento_numeradores VALUES (9997,1,now())', '42501');
SELECT pg_temp.rejeita('api UPDATE numerador negado', 'UPDATE alm.recebimento_numeradores SET ultimo_numero=1', '42501');
SELECT pg_temp.rejeita('api DELETE numerador negado', 'DELETE FROM alm.recebimento_numeradores', '42501');
INSERT INTO alm.outbox (tipo,entidade,entidade_id,chave_idempotencia) VALUES ('SHEETS_ESPELHO','test','test','test') ON CONFLICT DO NOTHING;
SELECT pg_temp.rejeita('api outbox sem UPDATE', 'UPDATE alm.outbox SET status=''CONCLUIDO''', '42501');
SELECT pg_temp.rejeita('api outbox sem SELECT', 'SELECT * FROM alm.outbox', '42501');
SELECT pg_temp.rejeita('api nao escolhe estado outbox', 'INSERT INTO alm.outbox (tipo,entidade,entidade_id,chave_idempotencia,status) VALUES (''SHEETS_ESPELHO'',''test'',''test'',''test2'',''CONCLUIDO'')', '42501');
SELECT pg_temp.rejeita('api espelho sem controle', 'UPDATE alm.espelho_sheets SET ultimo_resultado=''OK''', '42501');
SELECT pg_temp.rejeita('api nao apaga recebimentos', 'DELETE FROM alm.recebimentos', '42501');
SELECT pg_temp.rejeita('api nao apaga arquivos', 'DELETE FROM alm.arquivos', '42501');
RESET ROLE;
SET LOCAL ROLE alm_job;
SELECT alm.proximo_codigo_recebimento(9998::smallint);
SELECT pg_temp.rejeita('job SELECT numerador negado', 'SELECT * FROM alm.recebimento_numeradores', '42501');
SELECT pg_temp.rejeita('job UPDATE numerador negado', 'UPDATE alm.recebimento_numeradores SET ultimo_numero=1', '42501');
SELECT pg_temp.rejeita('job INSERT numerador negado', 'INSERT INTO alm.recebimento_numeradores VALUES (9997,1,now())', '42501');
SELECT pg_temp.rejeita('job DELETE numerador negado', 'DELETE FROM alm.recebimento_numeradores', '42501');
SELECT pg_temp.rejeita('job sem credenciais', 'SELECT * FROM alm.credenciais_pin', '42501');
SELECT pg_temp.rejeita('job sem eventos autenticacao', 'SELECT * FROM alm.eventos_autenticacao', '42501');
SELECT pg_temp.rejeita('job sem token_hash', 'SELECT token_hash FROM alm.sessoes', '42501');
SELECT id,ultimo_uso_em,ocioso_max_segundos,expira_em,revogada_em FROM alm.sessoes;
DELETE FROM alm.sessoes WHERE expira_em < now() - interval '30 days';
UPDATE alm.outbox SET status='CONCLUIDO',processado_em=now() WHERE chave_idempotencia='test';
INSERT INTO alm.espelho_sheets (aba,planilha_id) VALUES ('test','test');
RESET ROLE;
SELECT pg_temp.ok('gerador sequencial roles', (SELECT ultimo_numero=2 FROM alm.recebimento_numeradores WHERE ano=9998));
SELECT pg_temp.ok('job processa fila', EXISTS(SELECT 1 FROM alm.outbox WHERE chave_idempotencia='test' AND status='CONCLUIDO'));
SELECT pg_temp.ok('job controla espelho', EXISTS(SELECT 1 FROM alm.espelho_sheets WHERE aba='test'));
SELECT pg_temp.rejeita('historico imutavel UPDATE', 'UPDATE alm.historico_alteracoes SET detalhes=''alterado''', 'P0001');
SELECT pg_temp.rejeita('historico imutavel DELETE', 'DELETE FROM alm.historico_alteracoes', 'P0001');
SELECT pg_temp.rejeita('historico imutavel TRUNCATE', 'TRUNCATE alm.historico_alteracoes', 'P0001');
CREATE ROLE alm_test_sem_policy NOLOGIN;
GRANT USAGE ON SCHEMA alm TO alm_test_sem_policy;
GRANT SELECT ON alm.recebimentos TO alm_test_sem_policy;
GRANT INSERT ON resultados TO alm_test_sem_policy;
SET LOCAL ROLE alm_test_sem_policy;
SELECT pg_temp.ok('RLS nega role sem policy mesmo com SELECT', (SELECT count(*)=0 FROM alm.recebimentos));
RESET ROLE;
SELECT count(*) AS testes_aprovados FROM resultados;
ROLLBACK;
