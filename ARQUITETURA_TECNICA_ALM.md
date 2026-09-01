# Projeto ALM - Especificacao Tecnica Implementavel

Versao: 1.0  
Data: 01/09/2026  
Decisao arquitetural fixa: PostgreSQL para dados estruturados, Google Shared Drive institucional para arquivos e aplicacao como unica interface de acesso.

Este documento nao reabre a escolha de banco ou storage. Ele especifica como implementar a decisao ja tomada para um sistema interno de pequeno/medio porte, com dezenas de usuarios e crescimento para dezenas de milhares de recebimentos.

## 1. Arquitetura recomendada

### Decisao

Usar um **monolito modular**: frontend React responsivo, API REST TypeScript, PostgreSQL e um adaptador do Google Drive atras de `StorageService`. O mesmo deploy pode executar jobs agendados leves de reconciliacao; nao criar microsservicos, Kubernetes, Elasticsearch ou broker de mensagens no MVP.

```text
Funcionario (navegador/celular)
        |
        | HTTPS + OIDC + sessao segura
        v
+---------------------------------------------------+
| Aplicacao ALM                                     |
|                                                   |
|  React                                            |
|      |                                            |
|  API REST /api/v1                                 |
|      |-- Auth/RBAC                                |
|      |-- RecebimentoService                       |
|      |-- SearchService                            |
|      |-- DocumentService                          |
|      |       `-- StorageService                   |
|      |              `-- GoogleDriveAdapter        |
|      |-- AuditService                             |
|      `-- Jobs de reconciliacao/backup             |
+--------|-----------------------------|------------+
         |                             |
         v                             v
   PostgreSQL                   Google Shared Drive
   - recebimentos               - bytes dos arquivos
   - itens                      - pastas administrativas
   - metadados                  - IDs opacos
   - divergencias
   - auditoria
```

O PostgreSQL e a fonte de verdade do processo. O Shared Drive guarda os bytes, mas nomes e pastas nao definem identidade nem regras de negocio. A ligacao e feita por UUID interno, codigo publico `REC-AAAA-NNNNNN` e `storage_object_id` opaco.

### Componentes e responsabilidades

- **Frontend React:** cadastro em etapas, busca unica, autocomplete, fotos, documentos e visualizacao. Nunca recebe credencial, pasta, ID ou URL do Drive.
- **API REST:** autentica, autoriza, valida o dominio, executa transacoes, calcula hash, registra auditoria e transmite arquivos.
- **PostgreSQL:** integridade, concorrencia, filtros, pesquisa, deduplicacao e trilha auditavel.
- **Shared Drive institucional:** armazena somente os objetos binarios e a organizacao administrativa criada pela aplicacao.
- **Identidade tecnica:** uma service account exclusiva por ambiente, membro somente do Shared Drive correspondente com papel `fileOrganizer`/Content Manager. Nao usar delegacao em todo o dominio.
- **Jobs internos:** reconciliacao banco-storage, conferencias de ACL, limpeza de temporarios e inventario de backup. Sao comandos do mesmo codigo, executados por agendador.

### Decisoes de tecnologia

```text
Opcao A: varias APIs/microsservicos
Opcao B: monolito modular
Opcao C: plataforma low-code

Recomendacao: Opcao B.
Motivo: o volume e pequeno/medio, as transacoes atravessam varios modulos e a equipe precisa de implantacao e manutencao simples.
```

Para o backend, a referencia inicial e Node.js LTS + TypeScript + Fastify + driver `pg`, migrations SQL versionadas e cliente oficial Google APIs. Isso aproveita o ecossistema do frontend existente e preserva acesso completo aos recursos do PostgreSQL.

```text
Opcao A: container gerenciado no Google Cloud + Cloud SQL for PostgreSQL
Opcao B: VM/container na infraestrutura corporativa + PostgreSQL gerenciado
Opcao C: servidores locais administrados pela equipe

Recomendacao: Opcao A.
Motivo: reduz operacao de SO/banco, permite identidade anexada sem chave longa e fica proximo da integracao Google. O baseline e um servico de container para API/frontend, PostgreSQL gerenciado privado e jobs agendados do mesmo codigo. Se uma politica corporativa proibir GCP, usar Opcao B mantendo exatamente os mesmos contratos e controles; essa e uma restricao de hospedagem, nao uma mudanca de arquitetura.
```

Desenvolvimento, homologacao e producao usam projetos, bancos, Drives, identidades e segredos separados. O servico e exposto somente pela entrada corporativa HTTPS/zero-trust; PostgreSQL nao possui endpoint publico.

Para chamadas em Shared Drives, o adaptador deve informar `supportsAllDrives=true`; listagens administrativas devem usar `corpora=drive`, `driveId` e `includeItemsFromAllDrives=true`. A exigencia consta na [documentacao oficial de Shared Drives](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives).

## 2. Modelo de dados

### Relacionamentos

```text
usuarios 1 --- N recebimentos (responsavel/criacao/alteracao)
fornecedores 1 --- N recebimentos
tipos_recebimento 1 --- N recebimentos
recebimentos 1 --- N recebimento_itens
recebimentos 1 --- N arquivos
recebimento_itens 0..1 --- N arquivos
recebimentos 1 --- N divergencias
recebimento_itens 0..1 --- N divergencias
recebimentos 1 --- N recebimento_status_historico
recebimentos 1 --- N historico_alteracoes
storage_containers 1 --- N arquivos
arquivos 1 --- N arquivo_acessos
arquivos 1 --- N arquivo_backups
lotes_migracao 1 --- N itens_migracao
```

O `id UUID` e a PK interna. O codigo `REC-2026-000184` e imutavel, unico e usado nas URLs e na comunicacao com o usuario. Numero de NF, pedido e codigo de produto permanecem `text`, pois podem conter zeros a esquerda, letras, barras ou hifens.

### Tabelas de catalogo

#### `unidades_medida`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `codigo` | `varchar(12)` | PK | sim | Codigo controlado em maiusculas, como PC, UN, KG ou M. |
| `descricao` | `text` | - | sim | Nome legivel da unidade. |
| `casas_decimais` | `smallint` | CHECK | sim / 3 | Entre 0 e 6; orienta validacao e exibicao. |
| `ativo` | `boolean` | - | sim / `true` | Inativo nao aparece em novos itens, mas preserva FKs antigas. |
| `ordem` | `smallint` | - | sim / 0 | Ordenacao na interface. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / horario atual | Controle temporal. |

#### `tipos_recebimento`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `smallint` | PK identity | automatico | Identificador interno. |
| `codigo` | `varchar(40)` | UNIQUE/CHECK | sim | Codigo estavel em maiusculas, sem espacos. |
| `nome` | `text` | - | sim | Nome apresentado ao usuario. |
| `ativo` | `boolean` | - | sim / `true` | Controla novos cadastros. |
| `ordem` | `smallint` | - | sim / 0 | Ordenacao na lista. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / horario atual | Controle temporal. |

#### `tipos_arquivo`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `codigo` | `varchar(30)` | PK/CHECK | sim | NOTA_FISCAL, DACTE, PEDIDO_COMPRA, FOTO_PRODUTO, CERTIFICADO ou OUTRO. |
| `nome` | `text` | - | sim | Rotulo apresentado. |
| `ativo` | `boolean` | - | sim / `true` | Controla novos uploads. |
| `ordem` | `smallint` | - | sim / 0 | Ordenacao visual. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / horario atual | Controle temporal. |

#### `tipos_divergencia`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `codigo` | `varchar(40)` | PK/CHECK | sim | Codigo funcional estavel. |
| `nome` | `text` | - | sim | Quantidade, avaria, material diferente, documento, embalagem ou outro. |
| `ativo` | `boolean` | - | sim / `true` | Controla novas divergencias. |
| `ordem` | `smallint` | - | sim / 0 | Ordenacao visual. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / horario atual | Controle temporal. |

### `usuarios`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `uuid` | PK | sim / `gen_random_uuid()` | Identidade interna. |
| `oidc_issuer` | `text` | UNIQUE composta | sim | Emissor do login corporativo. |
| `oidc_subject` | `text` | UNIQUE composta | sim | `sub` imutavel do provedor; nao usar e-mail como identidade. |
| `email` | `text` | UNIQUE | sim | Canonico em minusculas. |
| `nome` | `text` | - | sim | Nome exibido. |
| `nome_busca` | `text` | indice GIN | automatico por trigger | Nome sem acentos e em minusculas. |
| `perfil` | `varchar(20)` | CHECK | sim | ADMINISTRADOR, ALMOXARIFADO, SUPRIMENTOS ou CONSULTA. |
| `ativo` | `boolean` | - | sim / `true` | Desativacao preserva historico. |
| `ultimo_login_em` | `timestamptz` | - | nao | Telemetria de acesso. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / `now()` | Controle temporal. |
| `versao` | `bigint` | CHECK | sim / 1 | Concorrencia otimista. |

### `fornecedores`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `uuid` | PK | sim / UUID | Identidade interna. |
| `cnpj` | `char(14)` | UNIQUE parcial | nao | Somente digitos; nulo para legado nao identificado. |
| `razao_social` | `text` | - | sim | Nome juridico. |
| `nome_fantasia` | `text` | - | nao | Nome operacional. |
| `nome_busca` | `text` | GIN/trigram | automatico por trigger | Une razao social, fantasia e CNPJ normalizados. |
| `ativo` | `boolean` | - | sim / `true` | Inativos permanecem referenciaveis no historico. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / `now()` | Controle temporal. |
| `criado_por`, `alterado_por` | `uuid` | FK usuarios | nao | Auditoria administrativa. |
| `versao` | `bigint` | CHECK | sim / 1 | Concorrencia otimista. |

### `recebimento_numeradores`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `ano` | `smallint` | PK/CHECK | sim | Ano do codigo publico. |
| `ultimo_numero` | `integer` | CHECK | sim | Ultimo numero alocado, entre 1 e 999999; atualizado atomicamente. |
| `alterado_em` | `timestamptz` | - | sim / horario atual | Momento da ultima alocacao. |

### `recebimentos`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `uuid` | PK | sim / UUID | PK interna. |
| `codigo` | `varchar(20)` | UNIQUE | automatico por trigger | `REC-AAAA-NNNNNN`; a funcao com numerador anual o aloca atomicamente. |
| `origem` | `varchar(15)` | CHECK | sim / OPERACIONAL | OPERACIONAL ou MIGRACAO. |
| `qualidade_dados` | `varchar(25)` | CHECK | automatico por origem/status | Operacional nasce PENDENTE_CONFERENCIA e finaliza CONFERIDO; migracao nasce NAO_CONFERIDO. |
| `numero_nf`, `serie_nf` | `text` | - | nao | NF pode faltar no rascunho, mas e exigida no fechamento. |
| `numero_nf_busca`, `pedido_busca`, `fornecedor_busca` | `text` | indices | automatico por trigger | Versoes normalizadas usadas somente pela busca. |
| `pedido_compra` | `text` | - | condicional | Obrigatorio ao sair de Em digitacao, exceto legado. |
| `fornecedor_id` | `uuid` | FK fornecedores | condicional | Obrigatorio no fluxo operacional ativo. |
| `fornecedor_nome_snapshot`, `fornecedor_cnpj_snapshot` | `text`, `char(14)` | - | automatico/condicional | Preservam o fornecedor exibido no momento do recebimento. |
| `recebido_em` | `timestamptz` | - | condicional | Data/hora real; armazenada com timezone. |
| `ano_referencia`, `mes_referencia` | `smallint` | CHECK | nao | Permitem registrar apenas a competencia conhecida no legado sem inventar dia/hora. |
| `responsavel_id` | `uuid` | FK usuarios | sim no operacional | Preenchido pelo usuario autenticado; pode ser nulo apenas no historico sem identificacao confiavel. |
| `tipo_recebimento_id` | `smallint` | FK catalogo | condicional | Obrigatorio fora do rascunho/legado incompleto. |
| `status` | `varchar(40)` | CHECK | operacional / EM_DIGITACAO | Estado atual do workflow; nulo somente no historico migrado nao conferido. |
| `observacoes` | `text` | - | nao | Texto livre pesquisavel. |
| `dados_origem` | `jsonb` objeto | CHECK | sim / `{}` | Evidencias tecnicas da migracao; nao substitui campos de negocio. |
| `versao` | `bigint` | CHECK | sim / 1 | Concorrencia otimista via `If-Match`. |
| `busca_fts` | `tsvector` | GIN | automatico por trigger | NF, pedido, fornecedor e observacoes. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / `now()` | Controle temporal. |
| `criado_por`, `alterado_por` | `uuid` | FK usuarios | sim | Usuario real da aplicacao. |
| `excluido_em`, `excluido_por`, `motivo_exclusao` | varios | FK usuario | nao | Exclusao logica administrativa. |
| `conferido_em`, `conferido_por` | `timestamptz`, `uuid` | FK usuarios | condicional | Permitem retirar o selo nao conferido de um historico migrado apos revisao humana. |

Rascunhos podem estar incompletos. A transicao para outro status exige pedido, fornecedor, data, responsavel, tipo e ao menos um item valido. Registros de migracao podem manter campos nulos e recebem o selo `HISTORICO - DADOS NAO CONFERIDOS` pela combinacao `origem/qualidade_dados`, nao por um status operacional falso.

### `recebimento_itens`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `uuid` | PK | sim / UUID | Identidade do item. |
| `recebimento_id` | `uuid` | FK recebimentos | sim | Exclusao do recebimento e restrita, nao cascata fisica. |
| `numero_item` | `integer` | UNIQUE parcial por recebimento | sim | Linha 10, 20 etc.; positiva. |
| `codigo_produto` | `text` | - | nao | Snapshot do codigo no momento do recebimento. |
| `descricao` | `text` | - | sim | Obrigatoria em todo item gravado. |
| `quantidade_solicitada` | `numeric(18,6)` | CHECK | nao | `NULL` significa desconhecida; nunca converter para zero. |
| `quantidade_recebida` | `numeric(18,6)` | CHECK | sim | Maior que zero. |
| `unidade_codigo` | `varchar(12)` | FK unidade | sim | Lista controlada. |
| `observacoes` | `text` | - | nao | Complemento do item. |
| `codigo_produto_busca` | `text` | B-tree | automatico por trigger | Codigo normalizado para igualdade/prefixo. |
| `descricao_busca` | `text` | GIN/trigram | automatico por trigger | Descricao normalizada. |
| `busca_fts` | `tsvector` | GIN | automatico por trigger | Codigo, descricao e observacoes pesquisaveis. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / `now()` | Controle temporal. |
| `criado_por`, `alterado_por` | `uuid` | FK usuarios | sim | Auditoria. |
| `versao` | `bigint` | CHECK | sim / 1 | Concorrencia otimista. |
| `excluido_em`, `excluido_por`, `motivo_exclusao` | varios | FK usuario | nao | Exclusao logica com justificativa. |

### `storage_containers`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `uuid` | PK | sim / UUID | Container logico interno. |
| `recebimento_id` | `uuid` | FK recebimentos | nao | Nulo para raiz/ano/mes. |
| `parent_id` | `uuid` | FK self | nao | Hierarquia administrativa. |
| `storage_provider` | `varchar(30)` | UNIQUE composta | sim | Inicialmente GOOGLE_DRIVE. |
| `storage_namespace` | `text` | UNIQUE/FK composta | sim | Shared Drive ID, bucket ou container Azure; nunca exposto ao cliente. |
| `logical_key` | `text` | UNIQUE composta | sim | Chave idempotente independente do nome da pasta. |
| `storage_object_id` | `text` | UNIQUE composta | nao ate criar | ID opaco retornado pelo provider. |
| `finalidade` | `varchar(30)` | CHECK | sim | ROOT, ANO, MES, RECEBIMENTO, CATEGORIA ou QUARENTENA. |
| `tipo_arquivo_codigo` | `varchar(30)` | FK tipo arquivo | nao | Usado em container de categoria. |
| `status` | `varchar(20)` | CHECK | sim / PENDENTE | PENDENTE, DISPONIVEL, FALHOU ou INCONSISTENTE. |
| `nome_administrativo` | `text` | - | sim | Nome legivel da pasta; nao e identidade. |
| `provider_metadata` | `jsonb` | - | sim / `{}` | Somente dados tecnicos opcionais. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / `now()` | Controle temporal. |
| `criado_por`, `alterado_por` | `uuid` | FK usuarios | sim | Auditoria. |
| `versao` | `bigint` | CHECK | sim / 1 | Concorrencia otimista. |

### `arquivos`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `uuid` | PK | sim / UUID | ID entregue pela API; nunca o ID do Drive. |
| `recebimento_id` | `uuid` | FK recebimentos | sim | Dono logico do arquivo. |
| `item_id` | `uuid` | FK composta item/recebimento | nao | Garante que o item pertence ao mesmo recebimento. |
| `tipo_arquivo_codigo` | `varchar(30)` | FK catalogo | sim | Classificacao funcional. |
| `storage_provider` | `varchar(30)` | UNIQUE composta | sim / GOOGLE_DRIVE | Permite trocar o provider. |
| `storage_namespace` | `text` | UNIQUE/FK composta | sim | Shared Drive ID, bucket ou container fisico do provider. |
| `storage_object_id` | `text` | UNIQUE composta | nao enquanto pendente | ID opaco do objeto. |
| `storage_version_id`, `storage_etag` | `text` | - | nao | Controle tecnico opcional. |
| `storage_container_id` | `uuid` | FK container | sim | Pasta/container logico. |
| `nome_original` | `text` | - | sim | Nome exibido, nunca usado como identidade. |
| `nome_storage` | `text` | - | sim | Nome administrativo sanitizado. |
| `mime_type_declarado` | `text` | - | nao | Informado pelo cliente, nao confiavel. |
| `mime_type_detectado` | `text` | - | sim | Detectado por assinatura/magic bytes. |
| `tamanho_bytes` | `bigint` | CHECK | sim | Maior que zero. |
| `checksum_algoritmo` | `varchar(12)` | CHECK | sim / SHA-256 | Algoritmo oficial. |
| `checksum_sha256` | `char(64)` | indice/UNIQUE parcial | sim | Hash hexadecimal do conteudo. |
| `idempotency_key` | `uuid` | UNIQUE por recebimento | sim | Repeticao da chamada retorna o mesmo resultado. |
| `status_upload` | `varchar(25)` | CHECK | sim / PENDENTE | PENDENTE, ENVIANDO, DISPONIVEL, FALHOU ou INCONSISTENTE; exclusao logica usa campos proprios. |
| `provider_metadata` | `jsonb` | - | sim / `{}` | Nunca contem regra de negocio. |
| `integridade_verificada_em` | `timestamptz` | - | nao | Ultima comparacao bem-sucedida de existencia, tamanho e checksum. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / `now()` | Controle temporal. |
| `criado_por`, `alterado_por` | `uuid` | FK usuarios | sim | Usuario humano, nao a service account. |
| `versao` | `bigint` | CHECK | sim / 1 | Concorrencia otimista. |
| `excluido_em`, `excluido_por`, `motivo_exclusao` | varios | FK usuario | nao | Exclusao logica e justificativa. |

### `arquivo_acessos`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `bigint` | PK identity | automatico | Sequencia do evento. |
| `arquivo_id`, `recebimento_id` | `uuid` | FK composta arquivos | sim | Garante que o arquivo pertence ao recebimento auditado. |
| `usuario_id` | `uuid` | FK usuarios | sim | Usuario autenticado que pediu o conteudo. |
| `acao` | `varchar(10)` | CHECK | sim | PREVIEW ou DOWNLOAD. |
| `resultado` | `varchar(20)` | CHECK | sim | SUCESSO, NEGADO, FALHA_STORAGE ou INTERROMPIDO. |
| `request_id` | `uuid` | - | sim | Correlacao com API/logs. |
| `ip`, `user_agent` | `inet`, `text` | - | nao | Acesso restrito na API. |
| `bytes_transmitidos` | `bigint` | CHECK | nao | Quantidade efetivamente enviada. |
| `criado_em` | `timestamptz` | - | sim / horario atual | Registrado ao terminar/falhar o stream, nao ao gerar a miniatura automatica. |

Tabela append-only para provar visualizacao/download; nao substitui a auditoria de mutacoes.

### `arquivo_backups`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `bigint` | PK identity | automatico | Identidade da copia. |
| `arquivo_id`, `recebimento_id` | `uuid` | FK composta arquivos | sim | Arquivo de origem. |
| `backup_provider` | `varchar(30)` | UNIQUE composta | sim | Inicialmente S3. |
| `backup_namespace` | `text` | UNIQUE composta | sim | Bucket/container independente. |
| `backup_object_id`, `backup_version_id` | `text` | UNIQUE composta / - | condicional | Chave e versao opacas no backup. |
| `checksum_sha256` | `char(64)` | CHECK | sim | Deve coincidir com o arquivo canonico. |
| `status` | `varchar(20)` | CHECK | sim / PENDENTE | PENDENTE, COPIANDO, DISPONIVEL, FALHOU ou INCONSISTENTE. |
| `copiado_em`, `verificado_em` | `timestamptz` | - | condicionais | Evidenciam copia e ultima verificacao. |
| `erro_codigo` | `text` | - | nao | Falha sanitizada. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / horario atual | Controle do job. |

### `divergencias`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `uuid` | PK | sim / UUID | Identidade. |
| `recebimento_id` | `uuid` | FK recebimento | sim | Processo afetado. |
| `item_id` | `uuid` | FK composta | nao | Item do mesmo recebimento. |
| `tipo_divergencia_codigo` | `varchar(40)` | FK catalogo | sim | Tipo controlado. |
| `severidade` | `varchar(10)` | CHECK | sim / MEDIA | BAIXA, MEDIA, ALTA ou CRITICA. |
| `descricao` | `text` | - | sim | Problema constatado. |
| `status` | `varchar(20)` | CHECK | sim / ABERTA | ABERTA, EM_TRATAMENTO, RESOLVIDA ou CANCELADA. |
| `responsavel_tratamento_id` | `uuid` | FK usuarios | nao | Normalmente Suprimentos. |
| `resolucao` | `text` | - | condicional | Obrigatoria quando RESOLVIDA. |
| `resolvida_em` | `timestamptz` | - | condicional | Obrigatoria quando RESOLVIDA. |
| `resolvida_por` | `uuid` | FK usuarios | condicional | Obrigatorio quando RESOLVIDA. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / `now()` | A abertura e representada por `criado_em`. |
| `criado_por`, `alterado_por` | `uuid` | FK usuarios | sim | Autor da abertura e ultima alteracao. |
| `versao` | `bigint` | CHECK | sim / 1 | Concorrencia otimista. |
| `excluido_em`, `excluido_por`, `motivo_exclusao` | varios | FK usuario | nao | Cancelamento/exclusao logica com justificativa. |

### `recebimento_status_historico`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `bigint` | PK identity | automatico | Sequencia da trilha. |
| `recebimento_id` | `uuid` | FK recebimentos | sim | Recebimento alterado. |
| `status_anterior` | `varchar(40)` | - | nao | Nulo apenas na criacao da trilha. |
| `status_novo` | `varchar(40)` | - | sim | Deve ser diferente do anterior. |
| `observacao` | `text` | - | condicional | Obrigatoria em reabertura/retrocesso excepcional pela API. |
| `alterado_em` | `timestamptz` | - | sim / horario atual | Momento da transicao. |
| `alterado_por` | `uuid` | FK usuarios | condicional | Usuario humano; nulo quando o ator e um job. |
| `ator_tipo`, `ator_identificador` | `varchar(10)`, `text` | CHECK | sim | Diferencia USUARIO de SISTEMA sem atribuir job ao ultimo humano. |

Tabela append-only: a role da API nao recebe UPDATE ou DELETE.

### `historico_alteracoes`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `bigint` | PK identity | automatico | Sequencia global da auditoria. |
| `recebimento_id` | `uuid` | FK recebimentos | nao | Nulo para entidade global, como usuario/fornecedor. |
| `entidade` | `varchar(60)` | - | sim | Nome qualificado da tabela auditada. |
| `entidade_id` | `text` | - | sim | Identificador da linha auditada. |
| `acao` | `varchar(30)` | - | sim | INSERCAO, ALTERACAO, EXCLUSAO_LOGICA ou EXCLUSAO_FISICA. |
| `usuario_id` | `uuid` | FK usuarios | nao | Usuario humano quando houver. |
| `ator_tipo` | `varchar(10)` | CHECK | sim / USUARIO | USUARIO ou SISTEMA. |
| `ator_identificador` | `text` | - | sim | UUID humano ou nome estavel do job. |
| `request_id` | `uuid` | - | nao | Correlaciona API e logs. |
| `ip` | `inet` | - | nao | Restrito a administradores no retorno da API. |
| `user_agent` | `text` | - | nao | Restrito a administradores. |
| `dados_antes`, `dados_depois` | `jsonb` objeto | CHECK | nao | Snapshot sem bytes, token, cookie ou segredo. |
| `campos_alterados` | `text[]` | - | nao | Lista calculada dos campos diferentes. |
| `detalhes` | `text` | - | nao | Contexto sanitizado. |
| `criado_em` | `timestamptz` | - | sim / horario atual | Momento imutavel do evento. |

Tabela append-only: trigger bloqueia UPDATE/DELETE e privilegios reforcam a regra.

### `lotes_migracao`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `uuid` | PK | sim / UUID | Identidade do lote. |
| `codigo` | `text` | UNIQUE | sim | Nome operacional, como MIG-2026-001. |
| `raiz_origem` | `text` | - | sim | Raiz registrada; nunca exposta ao usuario comum. |
| `status` | `varchar(30)` | CHECK | sim / CRIADO | Ciclo de inventario, dry-run, importacao, conclusao ou rollback. |
| `configuracao` | `jsonb` objeto | CHECK | sim / `{}` | Regras/versionamento usados no lote. |
| `total_arquivos`, `total_bytes`, `total_importados`, `total_duplicados`, `total_erros` | `bigint` | - | sim / 0 | Contadores de conciliacao. |
| `versao_importador` | `text` | - | sim | Versao exata do codigo/regras. |
| `iniciado_em`, `concluido_em` | `timestamptz` | - | nao | Marcos da execucao. |
| `criado_em` | `timestamptz` | - | sim / horario atual | Criacao do lote. |
| `criado_por` | `uuid` | FK usuarios | sim | Administrador responsavel. |

### `itens_migracao`

| Coluna | Tipo | Chave | Obrigatoria / padrao | Descricao e regras |
|---|---|---|---|---|
| `id` | `bigint` | PK identity | automatico | Identidade da linha importada. |
| `lote_id` | `uuid` | FK lotes_migracao | sim | Lote de origem. |
| `chave_origem` | `text` | UNIQUE por lote | sim | Chave estavel que torna reexecucao idempotente. |
| `caminho_relativo`, `nome_arquivo` | `text` | - | sim | Evidencia de onde o arquivo veio. |
| `tamanho_bytes` | `bigint` | CHECK | sim | Pode ser zero no inventario, mas arquivo vazio nao e importado como documento valido. |
| `modificado_em_origem` | `timestamptz` | - | nao | Mtime apenas como evidencia, nao como data de recebimento confirmada. |
| `checksum_sha256` | `char(64)` | indice | nao ate calcular | Hash dos bytes de origem. |
| `metadados_extraidos` | `jsonb` objeto | CHECK | sim / `{}` | Ano, mes, NF, pedido e fornecedor sugeridos. |
| `confianca_extracao` | `numeric(5,4)` | CHECK | nao | Entre 0 e 1. |
| `status` | `varchar(25)` | CHECK | sim / DESCOBERTO | Estado por arquivo, inclusive DUPLICADO, ERRO e REVERTIDO. |
| `recebimento_id`, `arquivo_id` | `uuid` | FKs | nao ate importar | Linhas de destino criadas. |
| `tentativas` | `smallint` | CHECK | sim / 0 | Contador de retry. |
| `erro_codigo`, `erro_detalhe` | `text` | - | nao | Falha sanitizada e acionavel. |
| `criado_em`, `alterado_em` | `timestamptz` | - | sim / horario atual | Controle operacional. |

Essas tabelas tornam dry-run, reexecucao e rollback por lote idempotentes.

## 3. Schema PostgreSQL

Baseline recomendado: PostgreSQL 16 ou superior. O DDL abaixo cria o nucleo, catalogos, staging de migracao, normalizacao, geracao concorrente do codigo e validacao defensiva de fechamento.

```sql
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
```

### Funcoes e triggers essenciais

`unaccent()` nao e declarado imutavel. A normalizacao e preenchida por triggers, evitando indices incoerentes se o dicionario for alterado.

```sql
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
```

A aplicacao deve bloquear o recebimento com `SELECT ... FOR UPDATE` antes de alterar itens, arquivos, divergencias ou status. O trigger abaixo e a segunda linha de defesa para o fechamento.

```sql
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
```

Os historicos sao append-only. O proprio banco insere `recebimento_status_historico` na mesma transacao da mudanca e usa triggers de auditoria para as tabelas de dominio. A role da API recebe apenas `SELECT` nos historicos.

```sql
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
```

Observacao de bootstrap: o primeiro administrador e criado por migration privilegiada com `app.ator_sistema` definido. Toda transacao mutavel posterior define exatamente um entre `SET LOCAL app.usuario_id` e `SET LOCAL app.ator_sistema`, alem de `request_id`; requisicoes humanas tambem definem IP e user-agent. As roles `NOLOGIN` sao concedidas a logins tecnicos diferentes por ambiente. Clientes nunca acessam o PostgreSQL diretamente.

## 4. Indices e estrategia de busca

### Decisao

Usar tres mecanismos complementares:

1. **B-tree** para igualdade, prefixo, data e filtros operacionais.
2. **GIN + `pg_trgm`** para nomes parciais, substring e erros simples.
3. **GIN + Full-Text Search** para descricoes, observacoes e consultas com varias palavras.

O PostgreSQL documenta que `pg_trgm` acelera similaridade, `LIKE` e `ILIKE`, enquanto GIN e a opcao usual para `tsvector`: [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) e [indices de Full-Text Search](https://www.postgresql.org/docs/current/textsearch-tables.html).

### SQL dos indices

```sql
-- Identidades e nomes de baixa cardinalidade operacional.
CREATE INDEX idx_usuarios_nome_prefix
    ON alm.usuarios (nome_busca text_pattern_ops);

CREATE INDEX idx_usuarios_nome_trgm
    ON alm.usuarios USING gin (nome_busca gin_trgm_ops);

CREATE INDEX idx_fornecedores_nome_trgm
    ON alm.fornecedores USING gin (nome_busca gin_trgm_ops)
    WHERE ativo;

-- Consulta de recebimentos.
CREATE INDEX idx_recebimentos_codigo_prefix
    ON alm.recebimentos (codigo text_pattern_ops)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_recebimentos_nf_prefix
    ON alm.recebimentos (numero_nf_busca text_pattern_ops)
    WHERE excluido_em IS NULL AND numero_nf_busca <> '';

CREATE INDEX idx_recebimentos_pedido_prefix
    ON alm.recebimentos (pedido_busca text_pattern_ops)
    WHERE excluido_em IS NULL AND pedido_busca <> '';

CREATE INDEX idx_recebimentos_fornecedor_trgm
    ON alm.recebimentos USING gin (fornecedor_busca gin_trgm_ops)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_recebimentos_busca_fts
    ON alm.recebimentos USING gin (busca_fts)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_recebimentos_data
    ON alm.recebimentos (recebido_em DESC)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_recebimentos_competencia_historica
    ON alm.recebimentos (ano_referencia, mes_referencia)
    WHERE excluido_em IS NULL
      AND origem = 'MIGRACAO'
      AND recebido_em IS NULL;

CREATE INDEX idx_recebimentos_status_data
    ON alm.recebimentos (status, recebido_em DESC)
    WHERE excluido_em IS NULL AND origem = 'OPERACIONAL';

CREATE INDEX idx_recebimentos_responsavel_data
    ON alm.recebimentos (responsavel_id, recebido_em DESC)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_recebimentos_fornecedor_data
    ON alm.recebimentos (fornecedor_id, recebido_em DESC)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_recebimentos_tipo_data
    ON alm.recebimentos (tipo_recebimento_id, recebido_em DESC)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_recebimentos_nf_fornecedor
    ON alm.recebimentos (numero_nf_busca, fornecedor_id)
    WHERE excluido_em IS NULL AND numero_nf_busca <> '';

-- Itens.
CREATE UNIQUE INDEX uq_itens_recebimento_numero_ativo
    ON alm.recebimento_itens (recebimento_id, numero_item)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_itens_recebimento
    ON alm.recebimento_itens (recebimento_id)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_itens_codigo_prefix
    ON alm.recebimento_itens (codigo_produto_busca text_pattern_ops)
    WHERE excluido_em IS NULL AND codigo_produto_busca <> '';

CREATE INDEX idx_itens_descricao_trgm
    ON alm.recebimento_itens USING gin (descricao_busca gin_trgm_ops)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_itens_busca_fts
    ON alm.recebimento_itens USING gin (busca_fts)
    WHERE excluido_em IS NULL;

-- Containers e arquivos.
CREATE INDEX idx_containers_recebimento
    ON alm.storage_containers (recebimento_id, finalidade)
    WHERE recebimento_id IS NOT NULL;

CREATE UNIQUE INDEX uq_arquivos_provider_object
    ON alm.arquivos (storage_provider, storage_namespace, storage_object_id)
    WHERE storage_object_id IS NOT NULL;

CREATE INDEX idx_arquivos_recebimento_tipo_data
    ON alm.arquivos (recebimento_id, tipo_arquivo_codigo, criado_em DESC)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_arquivos_item_data
    ON alm.arquivos (item_id, criado_em DESC)
    WHERE item_id IS NOT NULL AND excluido_em IS NULL;

-- Bloqueio de conteudo repetido dentro do mesmo recebimento.
CREATE UNIQUE INDEX uq_arquivos_recebimento_sha256_ativo
    ON alm.arquivos (recebimento_id, checksum_sha256)
    WHERE excluido_em IS NULL;

-- Apenas para alerta global; nao e UNIQUE.
CREATE INDEX idx_arquivos_sha256_global
    ON alm.arquivos (checksum_sha256)
    WHERE excluido_em IS NULL AND status_upload = 'DISPONIVEL';

CREATE INDEX idx_arquivos_reconciliacao
    ON alm.arquivos (status_upload, alterado_em)
    WHERE excluido_em IS NULL AND status_upload <> 'DISPONIVEL';

CREATE INDEX idx_acessos_arquivo_data
    ON alm.arquivo_acessos (arquivo_id, criado_em DESC);

CREATE INDEX idx_acessos_usuario_data
    ON alm.arquivo_acessos (usuario_id, criado_em DESC);

CREATE UNIQUE INDEX uq_backup_provider_object
    ON alm.arquivo_backups (
        backup_provider, backup_namespace, backup_object_id
    )
    WHERE backup_object_id IS NOT NULL;

CREATE INDEX idx_backups_status_data
    ON alm.arquivo_backups (status, alterado_em)
    WHERE status <> 'DISPONIVEL';

-- Divergencias e historicos.
CREATE INDEX idx_divergencias_recebimento_status
    ON alm.divergencias (recebimento_id, status, criado_em DESC)
    WHERE excluido_em IS NULL;

CREATE INDEX idx_divergencias_tratamento
    ON alm.divergencias (responsavel_tratamento_id, status, criado_em)
    WHERE excluido_em IS NULL AND status IN ('ABERTA', 'EM_TRATAMENTO');

CREATE INDEX idx_status_historico_recebimento_data
    ON alm.recebimento_status_historico (recebimento_id, alterado_em DESC);

CREATE INDEX idx_auditoria_recebimento_data
    ON alm.historico_alteracoes (recebimento_id, criado_em DESC);

CREATE INDEX idx_auditoria_entidade_data
    ON alm.historico_alteracoes (entidade, entidade_id, criado_em DESC);

CREATE INDEX idx_auditoria_usuario_data
    ON alm.historico_alteracoes (usuario_id, criado_em DESC)
    WHERE usuario_id IS NOT NULL;

CREATE INDEX idx_migracao_lote_status
    ON alm.itens_migracao (lote_id, status, id);

CREATE INDEX idx_migracao_checksum
    ON alm.itens_migracao (checksum_sha256)
    WHERE checksum_sha256 IS NOT NULL;
```

Em banco populado, novos indices devem ser criados com `CREATE INDEX CONCURRENTLY`, fora de uma transacao. Depois do go-live, medir `pg_stat_user_indexes` e `EXPLAIN (ANALYZE, BUFFERS)` antes de adicionar combinacoes.

### Indices que nao devem ser criados agora

- Nao criar `UNIQUE` em NF, pedido ou codigo do produto: entregas parciais, series e migracao podem repetir valores.
- Nao criar B-tree isolado em booleanos, origem, qualidade ou status. O composto `status + data` atende a fila operacional.
- Nao criar GIN generico em todos os `jsonb`; ainda nao existe consulta de negocio por essas chaves.
- Nao criar trigram em observacoes longas; o FTS ja atende esse caso.
- Nao duplicar indices normalizados e `lower(coluna)` para o mesmo uso.
- Nao usar indice HASH para checksum; B-tree cobre igualdade e unicidade.
- Nao particionar as tabelas no volume inicial.
- Nao criar uma permutacao para cada combinacao de filtros. Indices aumentam escrita, VACUUM e armazenamento; a propria documentacao alerta para o custo de manutencao dos GIN.

### Consulta de busca principal

A API normaliza a entrada, identifica datas validas e executa uma consulta parametrizada. Cada ramo usa seu indice e os candidatos sao combinados com `UNION ALL`; isso e mais previsivel que um grande `OR` atravessando recebimentos e itens.

```sql
BEGIN;
SET LOCAL pg_trgm.similarity_threshold = 0.32;
SET LOCAL statement_timeout = '1500ms';

WITH p AS (
    SELECT
        $1::text AS original,
        alm.normalizar_texto($1) AS texto,
        alm.normalizar_identificador($1) AS identificador,
        websearch_to_tsquery('portuguese', public.unaccent($1)) AS fts
),
candidatos AS (
    SELECT r.id, 1000.0 AS pontos, 'CODIGO_EXATO'::text AS origem_match
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND r.codigo = upper(btrim(p.original))

    UNION ALL
    SELECT r.id, 920.0, 'CODIGO_PREFIXO'
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND r.codigo LIKE upper(btrim(p.original)) || '%'

    UNION ALL
    SELECT r.id,
           CASE WHEN r.numero_nf_busca = p.identificador THEN 980.0 ELSE 880.0 END,
           'NF'
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND p.identificador <> ''
       AND r.numero_nf_busca LIKE p.identificador || '%'

    UNION ALL
    SELECT r.id,
           CASE WHEN r.pedido_busca = p.identificador THEN 970.0 ELSE 870.0 END,
           'PEDIDO'
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND p.identificador <> ''
       AND r.pedido_busca LIKE p.identificador || '%'

    UNION ALL
    SELECT r.id,
           720.0 + similarity(r.fornecedor_busca, p.texto) * 100,
           'FORNECEDOR'
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND length(p.texto) >= 3
       AND (
            r.fornecedor_busca LIKE p.texto || '%'
            OR r.fornecedor_busca % p.texto
       )

    UNION ALL
    SELECT r.id,
           600.0 + ts_rank_cd(r.busca_fts, p.fts) * 100,
           'RECEBIMENTO_FTS'
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND numnode(p.fts) > 0
       AND r.busca_fts @@ p.fts

    UNION ALL
    SELECT i.recebimento_id,
           CASE WHEN i.codigo_produto_busca = p.identificador THEN 960.0 ELSE 850.0 END,
           'CODIGO_PRODUTO'
      FROM alm.recebimento_itens i, p
     WHERE i.excluido_em IS NULL
       AND p.identificador <> ''
       AND i.codigo_produto_busca LIKE p.identificador || '%'

    UNION ALL
    SELECT i.recebimento_id,
           650.0 + word_similarity(p.texto, i.descricao_busca) * 100,
           'PRODUTO_APROXIMADO'
      FROM alm.recebimento_itens i, p
     WHERE i.excluido_em IS NULL
       AND length(p.texto) >= 3
       AND (
            i.descricao_busca LIKE '%' || p.texto || '%'
            OR i.descricao_busca %> p.texto
       )

    UNION ALL
    SELECT i.recebimento_id,
           610.0 + ts_rank_cd(i.busca_fts, p.fts) * 100,
           'PRODUTO_FTS'
      FROM alm.recebimento_itens i, p
     WHERE i.excluido_em IS NULL
       AND numnode(p.fts) > 0
       AND i.busca_fts @@ p.fts

    UNION ALL
    SELECT r.id,
           700.0 + word_similarity(p.texto, u.nome_busca) * 50,
           'RESPONSAVEL'
      FROM alm.usuarios u
      JOIN alm.recebimentos r ON r.responsavel_id = u.id
      CROSS JOIN p
     WHERE r.excluido_em IS NULL
       AND length(p.texto) >= 2
       AND (
            u.nome_busca LIKE p.texto || '%'
            OR (length(p.texto) >= 3 AND u.nome_busca %> p.texto)
       )

    UNION ALL
    SELECT r.id, 900.0, 'DATA'
      FROM alm.recebimentos r
     WHERE r.excluido_em IS NULL
       AND $3::timestamptz IS NOT NULL
       AND r.recebido_em >= $3::timestamptz
       AND r.recebido_em <  $4::timestamptz

    UNION ALL
    SELECT r.id, 880.0, 'COMPETENCIA_HISTORICA'
      FROM alm.recebimentos r
     WHERE r.excluido_em IS NULL
       AND r.origem = 'MIGRACAO'
       AND r.recebido_em IS NULL
       AND $5::smallint IS NOT NULL
       AND r.ano_referencia = $5::smallint
       AND ($6::smallint IS NULL OR r.mes_referencia = $6::smallint)
),
ranking AS (
    SELECT id, max(pontos) AS pontos,
           (array_agg(origem_match ORDER BY pontos DESC))[1] AS melhor_match
      FROM candidatos
     GROUP BY id
)
SELECT
    r.id, r.codigo, r.numero_nf, r.pedido_compra,
    r.fornecedor_nome_snapshot AS fornecedor,
    r.recebido_em, u.nome AS responsavel, r.status,
    ranking.pontos, ranking.melhor_match
FROM ranking
JOIN alm.recebimentos r ON r.id = ranking.id
LEFT JOIN alm.usuarios u ON u.id = r.responsavel_id
WHERE $7::double precision IS NULL
   OR ROW(
          ranking.pontos::double precision,
          coalesce(r.recebido_em, '-infinity'::timestamptz),
          r.id
      ) < ROW(
          $7::double precision,
          coalesce($8::timestamptz, '-infinity'::timestamptz),
          $9::uuid
      )
ORDER BY ranking.pontos DESC,
         coalesce(r.recebido_em, '-infinity'::timestamptz) DESC,
         r.id DESC
LIMIT least(greatest($2::integer, 1), 50);
COMMIT;
```

Parametros `$3/$4` representam intervalo de data real; `$5/$6`, ano/mes de competencia historica; `$7/$8/$9`, o cursor anterior. A API codifica em Base64URL JSON o trio assinado `{score, recebido_em, id}` e devolve o ultimo trio como `next_cursor`; o cliente nao pode alterar score ou escopo. Consultas muito amplas limitam cada ramo a uma janela de candidatos antes do `ranking`, definida e validada com o plano real.

`websearch_to_tsquery` recebe o texto original apenas sem acentos, preservando aspas, sinal de menos e a sintaxe de pesquisa web; o `tsvector` usa a mesma remocao de acentos. A funcao aceita entrada semelhante a uma pesquisa web sem exigir operadores internos, conforme a [documentacao do PostgreSQL](https://www.postgresql.org/docs/current/functions-textsearch.html). Prefixos e erros de digitacao continuam sendo resolvidos por B-tree e trigramas.

Metas de aceite com massa equivalente a cinco anos:

- autocomplete p95 abaixo de 250 ms;
- busca completa p95 abaixo de 500 ms;
- listagem filtrada p95 abaixo de 500 ms;
- nenhuma consulta sem limite/paginacao;
- plano validado com `EXPLAIN (ANALYZE, BUFFERS)`.

## 5. Busca e autocomplete

### Fluxo de interface

```text
usuario digita
-> aguarda 250 ms (debounce)
-> cancela a requisicao anterior
-> GET /api/v1/search/suggestions?q=flu
-> backend autoriza e normaliza
-> PostgreSQL retorna no maximo 8 sugestoes
-> interface agrupa por NF, Pedido, Fornecedor, Produto e Responsavel
```

Decisoes:

- iniciar com 2 caracteres;
- com 2 caracteres, somente prefixo;
- a partir de 3, habilitar trigramas;
- no maximo 8 sugestoes e 3 por categoria;
- cache privado de 30 segundos por usuario/consulta;
- abortar resposta obsoleta no navegador;
- timeout SQL de 800 ms;
- rate limit inicial de 120 requisicoes/minuto por usuario, com burst 20;
- exato > prefixo > substring > erro simples > recencia;
- nunca aplicar fuzzy em NF/pedido numerico, para nao sugerir numero fiscal incorreto;
- usuario inativo continua pesquisavel no historico; `ativo=false` apenas impede nova atribuicao;
- filtro de autorizacao deve estar dentro de cada CTE, antes do `LIMIT`.

### SQL sugerido para autocomplete

```sql
BEGIN;
SET LOCAL pg_trgm.similarity_threshold = 0.32;
SET LOCAL statement_timeout = '800ms';

WITH p AS (
    SELECT alm.normalizar_texto($1) AS qt,
           alm.normalizar_identificador($1) AS qi
),
nf AS (
    SELECT 'NF'::text AS tipo,
           r.numero_nf AS valor,
           'NF ' || r.numero_nf AS rotulo,
           max(r.recebido_em) AS ultima,
           max(CASE WHEN r.numero_nf_busca = p.qi THEN 100 ELSE 90 END)::real AS pontos
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND p.qi <> ''
       AND r.numero_nf_busca LIKE p.qi || '%'
     GROUP BY r.numero_nf
     ORDER BY pontos DESC, ultima DESC NULLS LAST
     LIMIT 3
),
pedido AS (
    SELECT 'PEDIDO'::text AS tipo,
           r.pedido_compra AS valor,
           'Pedido ' || r.pedido_compra AS rotulo,
           max(r.recebido_em) AS ultima,
           max(CASE WHEN r.pedido_busca = p.qi THEN 99 ELSE 89 END)::real AS pontos
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND p.qi <> ''
       AND r.pedido_busca LIKE p.qi || '%'
     GROUP BY r.pedido_compra
     ORDER BY pontos DESC, ultima DESC NULLS LAST
     LIMIT 3
),
fornecedor AS (
    SELECT 'FORNECEDOR'::text AS tipo,
           r.fornecedor_nome_snapshot AS valor,
           'Fornecedor: ' || r.fornecedor_nome_snapshot AS rotulo,
           max(r.recebido_em) AS ultima,
           max(CASE
                 WHEN r.fornecedor_busca = p.qt THEN 98
                 WHEN r.fornecedor_busca LIKE p.qt || '%' THEN 88
                 ELSE 60 + similarity(r.fornecedor_busca, p.qt) * 20
               END)::real AS pontos
      FROM alm.recebimentos r, p
     WHERE r.excluido_em IS NULL
       AND length(p.qt) >= 2
       AND (
            r.fornecedor_busca LIKE p.qt || '%'
            OR (length(p.qt) >= 3 AND r.fornecedor_busca % p.qt)
       )
     GROUP BY r.fornecedor_nome_snapshot
     ORDER BY pontos DESC, ultima DESC NULLS LAST
     LIMIT 3
),
produto AS (
    SELECT 'PRODUTO'::text AS tipo,
           coalesce(i.codigo_produto || ' | ', '') || i.descricao AS valor,
           'Produto: ' || i.descricao AS rotulo,
           max(r.recebido_em) AS ultima,
           max(CASE
                 WHEN i.codigo_produto_busca = p.qi AND p.qi <> '' THEN 97
                 WHEN i.codigo_produto_busca LIKE p.qi || '%' AND p.qi <> '' THEN 87
                 WHEN i.descricao_busca LIKE p.qt || '%' THEN 85
                 WHEN length(p.qt) >= 3
                      AND i.descricao_busca LIKE '%' || p.qt || '%' THEN 75
                 ELSE 55 + word_similarity(p.qt, i.descricao_busca) * 20
               END)::real AS pontos
      FROM alm.recebimento_itens i
      JOIN alm.recebimentos r ON r.id = i.recebimento_id
      CROSS JOIN p
     WHERE i.excluido_em IS NULL
       AND r.excluido_em IS NULL
       AND length(p.qt) >= 2
       AND (
            (p.qi <> '' AND i.codigo_produto_busca LIKE p.qi || '%')
            OR i.descricao_busca LIKE p.qt || '%'
            OR (
                length(p.qt) >= 3
                AND (
                    i.descricao_busca LIKE '%' || p.qt || '%'
                    OR i.descricao_busca %> p.qt
                )
            )
       )
     GROUP BY i.codigo_produto, i.descricao
     ORDER BY pontos DESC, ultima DESC NULLS LAST
     LIMIT 3
),
responsavel AS (
    SELECT 'RESPONSAVEL'::text AS tipo,
           u.id::text AS valor,
           'Responsavel: ' || u.nome AS rotulo,
           max(r.recebido_em) AS ultima,
           max(
               CASE
                   WHEN u.nome_busca LIKE p.qt || '%' THEN 80
                   ELSE 60 + word_similarity(p.qt, u.nome_busca) * 20
               END
           )::real AS pontos
      FROM alm.usuarios u
      JOIN alm.recebimentos r ON r.responsavel_id = u.id
      CROSS JOIN p
     WHERE r.excluido_em IS NULL
       AND length(p.qt) >= 2
       AND (
            u.nome_busca LIKE p.qt || '%'
            OR (length(p.qt) >= 3 AND u.nome_busca %> p.qt)
       )
     GROUP BY u.id, u.nome
     ORDER BY ultima DESC NULLS LAST
     LIMIT 3
)
SELECT tipo, valor, rotulo,
       'PESQUISAR'::text AS acao,
       valor AS query
FROM (
    SELECT * FROM nf
    UNION ALL SELECT * FROM pedido
    UNION ALL SELECT * FROM fornecedor
    UNION ALL SELECT * FROM produto
    UNION ALL SELECT * FROM responsavel
) s
ORDER BY pontos DESC, ultima DESC NULLS LAST
LIMIT 8;
COMMIT;
```

Toda entrada e parametro SQL; nenhum termo e concatenado. Cada sugestao declara `acao` e `query`, portanto o clique executa uma busca clara em vez de tentar abrir um registro ambiguo. Sugestoes nunca revelam a existencia de recebimento que o usuario nao poderia abrir. Erros retornam uma mensagem simples e a busca completa continua disponivel caso o autocomplete exceda o timeout.

## 6. Arquitetura de arquivos

### Identidade tecnica do Shared Drive

```text
Opcao A: service account dedicada, membro direto do Shared Drive
Opcao B: service account com delegacao em todo o dominio
Opcao C: usuario Workspace generico com senha/token

Recomendacao: Opcao A.
Motivo: atende server-to-server com menor privilegio e sem poder de impersonar funcionarios.
```

Criar identidades separadas por ambiente e finalidade:

```text
alm-storage-prod@projeto.iam.gserviceaccount.com
alm-storage-hml@projeto.iam.gserviceaccount.com
alm-backup-prod@projeto.iam.gserviceaccount.com
```

- `alm-storage-prod`: membro apenas de `ALM - Recebimentos - Producao`, papel Content Manager (`fileOrganizer`).
- grupo humano pequeno `alm-drive-admins@empresa`: Manager (`organizer`).
- identidade de backup: somente leitura.
- identidade temporaria de migracao: removida ao concluir a migracao.
- usuarios comuns: nao sao membros do Shared Drive.

Scopes: runtime/migracao usam `https://www.googleapis.com/auth/drive`; backup usa `https://www.googleapis.com/auth/drive.readonly`. O scope de runtime e amplo, mas a identidade so enxerga o Shared Drive ALM e nao possui delegacao de dominio.

Service accounts nao possuem armazenamento proprio e devem gravar em Shared Drives ou agir em nome de um usuario; como o conteudo pertence a organizacao, o membro direto e adequado. Referencias: [visao geral de Shared Drives](https://developers.google.com/workspace/drive/api/guides/about-shareddrives) e [papeis do Drive](https://developers.google.com/workspace/drive/api/guides/ref-roles).

Se a aplicacao rodar no Google Cloud, usar identidade anexada/Application Default Credentials. Fora dele, usar Workload Identity Federation. Chave JSON permanente e a ultima opcao; nunca fica no repositorio ou estacao do desenvolvedor. A recomendacao oficial e evitar chaves e delegacao ampla: [boas praticas de service accounts](https://docs.cloud.google.com/iam/docs/best-practices-service-accounts).

### Shared Drives por ambiente

```text
ALM - Recebimentos - Producao
ALM - Recebimentos - Homologacao
```

Bloquear compartilhamento externo, `anyone`, dominio inteiro e compartilhamento com nao membros. A aplicacao verifica diariamente ACL/membros inesperados. A identidade de runtime nao recebe Manager, portanto nao administra pessoas nem faz purga definitiva.

### Organizacao administrativa

```text
/Recebimentos
    /Quarentena
    /2026
        /09
            /REC-2026-000184
                /Nota Fiscal
                /Produtos
                /DACTE
                /Pedido
                /Certificados
                /Outros
```

A estrutura e adequada, mas deve ser **lazy**:

- ano/mes somente quando houver o primeiro arquivo naquele periodo;
- pasta do recebimento no primeiro upload;
- subpasta da categoria somente no primeiro arquivo daquele tipo;
- nenhuma pasta por item no MVP; o vinculo do item esta no PostgreSQL.
- `Quarentena` e criada uma vez no provisionamento, fora das categorias e sem exposicao na API comum.

O nome e apenas organizacao. A identidade e `storage_object_id`. Nomes iguais sao permitidos pelo Drive, portanto a criacao usa a `logical_key` unica de `storage_containers` e um lock transacional/advisory:

```text
1. adquirir lock para logical_key
2. consultar storage_containers
3. se ausente, procurar properties.almContainerKey
4. criar somente se ainda nao existir
5. salvar o ID opaco retornado
```

Pastas e arquivos recebem propriedades privadas de recuperacao:

```json
{
  "almEnvironment": "prod",
  "almContainerKey": "prod:receipt:UUID:NOTA_FISCAL",
  "almRecebimentoId": "UUID",
  "almArquivoId": "UUID",
  "almSha256": "hash"
}
```

Usar `properties`, e nao `appProperties`, porque runtime, migrador e backup possuem identidades tecnicas diferentes e precisam ler os mesmos marcadores. Guardar apenas ambiente, UUIDs, tipo e checksum, nunca nome de pessoa, NF, fornecedor, token ou segredo. Essas propriedades sao apoio de reconciliacao, nao fonte de verdade. Referencia: [custom file properties](https://developers.google.com/workspace/drive/api/guides/properties).

Alterar fornecedor, NF ou data nao renomeia automaticamente uma pasta ja criada. Se um administrador renomear/mover uma pasta, seu ID permanece a referencia e o sistema continua funcionando; a reconciliacao apenas registra a divergencia administrativa.

### Abstracao de storage

Separar regra e infraestrutura:

```text
DocumentService
    - autorizacao
    - regras e vinculos
    - checksum/deduplicacao
    - auditoria
        |
        v
StorageService
    - operacoes fisicas no provider
```

```typescript
interface StorageService {
  ensureContainer(command: EnsureContainer): Promise<ContainerRef>;
  reserveObjectId?(): Promise<string>;
  upload(stream: Readable, command: UploadCommand): Promise<StoredObject>;
  openStream(ref: StorageObjectRef, range?: ByteRange): Promise<Readable>;
  stat(ref: StorageObjectRef): Promise<StoredObjectMetadata>;
  getPreview(ref: StorageObjectRef, options?: PreviewOptions): Promise<Readable | null>;
}

interface StorageMaintenanceService extends StorageService {
  moveToQuarantine(ref: StorageObjectRef): Promise<void>;
  purgeAfterApprovedRetention(ref: StorageObjectRef): Promise<void>;
}

type StorageObjectRef = {
  provider: 'GOOGLE_DRIVE' | 'GCS' | 'S3' | 'AZURE_BLOB';
  namespace: string;
  objectId: string;
};

type StoredObject = {
  provider: 'GOOGLE_DRIVE' | 'GCS' | 'S3' | 'AZURE_BLOB';
  namespace: string;
  objectId: string;
  versionId?: string;
  size: number;
  mimeType: string;
  sha256: string;
  etag?: string;
};
```

Somente `GoogleDriveStorageAdapter` existe no MVP. O restante da aplicacao nao importa o SDK do Google, nao interpreta IDs e nao conhece `webViewLink`. Exclusao pela API e apenas logica no PostgreSQL; purga fisica fica na interface administrativa, depois da retencao aprovada. Erros sao convertidos em `StorageUnavailable`, `ObjectNotFound`, `AccessDenied`, `QuotaExceeded` e `IntegrityMismatch`.

### Servir arquivos

```text
GET /api/v1/arquivos/{uuid}/preview
-> autenticar
-> autorizar o recebimento
-> validar status do arquivo
-> registrar acesso
-> files.get(fileId, alt=media)
-> transmitir pelo backend
```

Imagens e PDFs podem abrir `inline`; outros tipos usam `attachment`. O proxy transmite o stream sem carregar tudo em memoria, aceita apenas um byte range e responde corretamente `206`, `Content-Range`, `Accept-Ranges` e `Content-Length`. O ETag da aplicacao deriva do SHA-256, nunca do ETag do provider. Documentos usam `Cache-Control: private, no-store`; miniaturas privadas podem usar cinco minutos. Aplicar `X-Content-Type-Options: nosniff`, nome sanitizado no `Content-Disposition` e CSP `sandbox` no visualizador de PDF. SVG, HTML e scripts nao entram na allowlist. O Drive usa `alt=media` para bytes de imagens/PDFs: [download de arquivos](https://developers.google.com/workspace/drive/api/guides/manage-downloads).

A autorizacao e refeita em toda requisicao, inclusive Range. Apos o stream terminar ou falhar, a API insere `arquivo_acessos` com resultado e bytes efetivamente transmitidos; miniaturas automaticas da grade nao geram falsos eventos de leitura explicita.

Nunca devolver ao cliente `fileId`, `driveId`, `thumbnailLink`, `webContentLink`, `webViewLink`, pasta ou token OAuth. O endpoint da aplicacao e a unica URL aceita.

## 7. Upload e prevencao de duplicidade

### Escopo da deduplicacao

```text
Mesmo item:             bloqueado pela regra do recebimento
Mesmo recebimento:      bloqueio obrigatorio
Recebimentos diferentes: alerta, sem bloqueio
Global fisico:          nao deduplicar no MVP
```

Recomendacao: a constraint unica `(recebimento_id, checksum_sha256)` e a regra oficial. A mesma NF/certificado pode ser legitima em dois recebimentos; compartilhar um unico objeto fisico criaria problemas de autorizacao, exclusao e restore. O alerta global so informa outro registro se o usuario tiver permissao para ve-lo.

O SHA-256 e calculado no backend, em streaming, sobre os bytes reais. Hash do navegador e apenas otimizacao. Nome, data, tamanho e MIME nao substituem hash.

### Validacoes antes do storage

- JPEG, PNG, WebP, HEIC e HEIF: ate 20 MiB;
- PDF: ate 50 MiB;
- um arquivo por requisicao; a interface permite selecionar ate 10 e envia no maximo 3 em paralelo, cada um com sua propria `Idempotency-Key`;
- assinatura real/magic bytes coerente com allowlist;
- bloqueio de executaveis, scripts, HTML e formatos desconhecidos;
- antivirus corporativo ou ClamAV em modo fail-closed antes de disponibilizar; timeout, scanner indisponivel ou assinatura vencida falham o upload;
- nome original sanitizado para exibicao;
- arquivo temporario em volume criptografado e remocao garantida;
- HEIC/HEIF preserva os bytes originais e recebe preview JPEG gerado em sandbox;
- no celular, corrigir orientacao, remover GPS/EXIF sensivel e comprimir para o alvo acordado sem degradacao silenciosa; a versao aceita pelo servidor e a evidencia oficial.

### Fluxo tecnico decidido

```text
1. autenticar e autorizar
2. receber um arquivo em temporario enquanto calcula SHA-256
3. validar tamanho, magic bytes e antivirus
4. pre-gerar IDs do Drive para containers/objeto, sem transacao PostgreSQL
5. iniciar transacao A e executar SELECT recebimento FOR UPDATE
6. validar status, versao, duplicidade e Idempotency-Key
7. fazer upsert dos containers PENDENTES e inserir o arquivo PENDENTE com IDs reservados
8. incrementar recebimentos.versao e confirmar a transacao A
9. fora de transacao/lock, criar os containers pendentes e enviar ao Drive por upload resumivel
10. consultar metadados e comparar tamanho/hash
11. iniciar transacao B, marcar containers/arquivo DISPONIVEL e inserir auditoria
12. confirmar, apagar temporario e exibir miniatura
```

Nenhuma chamada externa ocorre enquanto uma transacao ou row lock do PostgreSQL esta aberto. Os IDs reservados e a `logical_key` fazem workers concorrentes convergirem para os mesmos objetos; um conflito do provider e seguido por `stat/get` e validacao do marcador/hash. O Drive oferece upload resumivel e IDs pre-gerados, uteis em repeticoes: [criacao com IDs pre-gerados](https://developers.google.com/workspace/drive/api/guides/create-file) e [uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads). Usar `supportsAllDrives=true`, parent pelo ID da categoria e `properties` com IDs do banco.

Semantica de idempotencia: a mesma chave em `DISPONIVEL` retorna o arquivo existente; em `PENDENTE/ENVIANDO`, retorna `202` e o estado; em `FALHOU`, somente `POST /arquivos/{id}/retentar` reutiliza a mesma linha. Uma nova tentativa nao cria outra linha ativa com o mesmo hash.

### Consistencia banco-Drive

Nao existe transacao distribuida entre PostgreSQL e Drive. A recomendacao e uma saga pequena baseada na linha `arquivos`, sem broker:

- **Linha pendente e upload falhou:** marcar `FALHOU`, guardar erro sanitizado e permitir retentativa. Nao aparece na galeria.
- **Objeto existe, update final do banco falhou:** reconciliador consulta o ID reservado/propriedade; se hash e tamanho conferirem, marca `DISPONIVEL`.
- **Objeto sem registro no banco:** mover para quarentena administrativa; nunca excluir automaticamente.
- **Linha disponivel sem objeto:** marcar `INCONSISTENTE`, bloquear download, alertar administrador e restaurar do backup.
- **Repeticao da chamada:** devolve o recurso/estado anterior; `FALHOU` so muda pelo endpoint explicito de retentativa.

Restauracao logica verifica o indice de checksum. Se ja houver arquivo ativo com o mesmo hash no recebimento, retorna `409`, mostra o arquivo ativo ao administrador, nao reativa uma segunda linha e registra a decisao.

Jobs:

- pendencias e resultados indeterminados: a cada 15 minutos;
- reconciliacao incremental: diaria;
- inventario completo banco x Drive: semanal;
- retry de `429`/5xx com exponential backoff e jitter, como orientado nos [limites da Drive API](https://developers.google.com/workspace/drive/api/guides/limits).

## 8. Seguranca e permissoes

### Autenticacao

Usar OIDC corporativo com Authorization Code + PKCE e cookie `__Host-alm_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` e sem `Domain`. Sessao expira apos 30 minutos de inatividade ou 8 horas absolutas, tem ID rotacionado no login/mudanca de privilegio e e invalidada no servidor no logout. Validar issuer, audience, expiracao, `sub`, e-mail verificado e dominio permitido. O `sub` + issuer mapeiam `usuarios`; o e-mail pode mudar. Exigir MFA no IdP para Administrador e recomendar para todos.

A identidade humana da sessao e separada da service account do Drive. Em cada transacao:

```sql
SET LOCAL app.usuario_id = 'uuid';
SET LOCAL app.request_id = 'uuid';
SET LOCAL app.ip = '10.0.0.10';
SET LOCAL app.user_agent = '...';
```

### Matriz de autorizacao

| Acao | Administrador | Almoxarifado | Suprimentos | Consulta |
|---|---:|---:|---:|---:|
| Criar recebimento | Sim | Sim | Nao | Nao |
| Editar dados/itens ativos | Sim | Sim | Somente campos de compra/documento definidos | Nao |
| Visualizar recebimento/arquivo | Sim | Sim | Sim | Sim |
| Adicionar foto | Sim | Sim, antes de finalizar | Nao | Nao |
| Adicionar documento | Sim, se nao finalizado | Sim, se nao finalizado | Sim, se nao finalizado | Nao |
| Registrar divergencia | Sim | Sim | Sim, se documental | Nao |
| Resolver divergencia | Sim | Nao | Sim | Nao |
| Finalizar recebimento | Sim | Sim, apos reconferencia | Nao | Nao |
| Reabrir finalizado | Sim, com justificativa | Nao | Nao | Nao |
| Excluir logicamente arquivo | Sim, apos reabrir se finalizado | Somente rascunho proprio | Somente documento incluido por ele e ativo | Nao |
| Purga fisica | Processo administrativo separado | Nao | Nao | Nao |
| Ver historico operacional | Sim | Sim | Sim | Sim |
| Ver IP/log tecnico | Sim | Nao | Nao | Nao |
| Administrar usuarios/catalogos | Sim | Nao | Nao | Nao |

Decisao do MVP, que possui um unico Almoxarifado: todo perfil ativo consulta todos os recebimentos e seus arquivos; os perfis limitam mutacoes, nao o universo consultavel. Preview e download recebem a mesma autorizacao, pois ambos expoem o conteudo. Se houver varias unidades no futuro, adicionar escopo organizacional explicito antes de liberar dados entre unidades.

### Workflow autorizado

```text
EM_DIGITACAO
  -> AGUARDANDO_DOCUMENTACAO        Almoxarifado/Admin
  -> EM_CONFERENCIA                 Almoxarifado/Admin, somente documentos completos

AGUARDANDO_DOCUMENTACAO
  -> EM_CONFERENCIA                 Almoxarifado/Admin, apos NF obrigatoria

EM_CONFERENCIA
  -> DIVERGENCIA_IDENTIFICADA       automatico ao abrir divergencia
  -> CONFERIDO_FINALIZADO           Almoxarifado/Admin, regras satisfeitas

DIVERGENCIA_IDENTIFICADA
  -> EM_CONFERENCIA                 Suprimentos/Admin, todas resolvidas

CONFERIDO_FINALIZADO
  -> EM_CONFERENCIA                 somente Admin, justificativa obrigatoria
```

Retrocesso excepcional exige Administrador, justificativa e historico. A interface mostra apenas acoes efetivamente permitidas; a API sempre revalida.

`CONFERIDO_FINALIZADO` e imutavel para dados, itens, arquivos e divergencias. Ate um Administrador precisa reabrir antes de alterar/excluir ou acrescentar documento. Substituir arquivo cria nova linha/novo objeto e exclui logicamente o anterior; o adapter nunca sobrescreve bytes existentes. O unico update permitido sem reabertura e o reconciliador marcar/verificar campos tecnicos, com ator SISTEMA e auditoria.

### Controles adicionais

- TLS obrigatorio; HSTS em producao.
- Autorizacao por recurso no backend, nunca apenas escondendo botao.
- Queries parametrizadas e CSRF para endpoints mutaveis quando usar cookie.
- Rate limit para login, busca, download e upload.
- Controle otimista com `versao`/`If-Match`; `409` quando outro usuario alterou.
- Exclusao logica com motivo; sem `ON DELETE CASCADE` em dados de negocio.
- Role PostgreSQL da API sem `TRIGGER`, `OWNER`, `SUPERUSER` ou alteracao de schema.
- Auditoria append-only; acesso tecnico restrito e exportacao periodica para log central.
- Segredos em Secret Manager/cofre corporativo, nunca em `.env` versionado.
- Logs sem bytes, tokens, cookies ou chaves; sempre `correlation_id`.
- Content Security Policy, `nosniff`, nomes sanitizados e antivirus para uploads.
- Scanner em fail-closed com alertas de saude, idade da assinatura, latencia/fila e espaco/limpeza do temporario apos crash.
- Nenhum usuario comum ou grupo geral no Shared Drive.
- Verificacao diaria contra permissao `anyone`, dominio ou membro inesperado.

Content restriction do Drive pode marcar arquivos finalizados como somente leitura, mas nao e garantia de imutabilidade; a propria documentacao informa que a restricao e mutavel. A fonte auditavel continua sendo banco + backup: [content restrictions](https://developers.google.com/workspace/drive/api/guides/content-restrictions).

## 9. UX para usuario leigo

### Tela inicial

Priorizar um unico campo:

```text
Pesquise NF, pedido, produto, fornecedor ou responsavel...
```

Abaixo dele:

- sugestoes agrupadas por tipo;
- botao grande `Novo recebimento`;
- atalhos `Meus rascunhos`, `Documentacao pendente` e `Divergencias`;
- lista curta de recebimentos recentes.

Resultado compacto:

```text
REC-2026-000184                         Em conferencia
NF 34589 | Pedido 225211
FLUIDCENTER
Recebido por Andre | 01/07/2026 14:32
```

Status usa texto, icone e cor; nunca apenas cor.

### Cadastro

Manter quatro etapas com rascunho automatico:

1. Identificacao: pedido, fornecedor, data/hora e tipo.
2. Produtos: codigo, descricao, quantidade e unidade.
3. Evidencias: `Tirar foto`, `Escolher da galeria` e `Selecionar documento`.
4. Revisao: campos, pendencias, divergencias e destino do status.

Regras de experiencia:

- data/hora e responsavel automaticos;
- NF nao bloqueia rascunho, mas o aviso explica que bloqueia fechamento;
- autosave serializado apos mudancas relevantes, com estado sempre visivel `Salvando...`, `Salvo` ou `Nao salvo - tentar novamente`;
- em `409`, pausar autosave, mostrar `Este recebimento foi alterado por outra pessoa` e oferecer recarregar/comparar, sem sobrescrever silenciosamente;
- progresso por arquivo, miniatura, retentativa e cancelamento;
- erro de rede nao limpa o formulario nem a selecao;
- duplicata: `Esta foto ja foi adicionada a este recebimento`;
- selecao de ate 10 fotos com fila e no maximo 3 uploads simultaneos, cada um retomavel individualmente;
- sem modo offline no MVP; mostrar estado sem conexao claramente;
- fonte de input minima 16 px no celular;
- alvo de toque minimo 44 x 44 px;
- labels persistentes, foco visivel e erros junto ao campo.

### Tela do recebimento

Ordem:

1. codigo, status e acoes validas;
2. avisos acionaveis, por exemplo `Falta anexar a Nota Fiscal`;
3. NF, pedido, fornecedor, data e responsavel;
4. produtos em tabela responsiva/cartoes;
5. galeria de fotos;
6. documentos agrupados;
7. divergencias;
8. linha do tempo.

```text
RECEBIMENTO REC-2026-000184
NF 34589 | Pedido 225211 | FLUIDCENTER
01/07/2026 14:32 | Andre

PRODUTOS
79678 | Manometro horizontal | 1 UN

FOTOS                 DOCUMENTOS
[miniatura] [miniatura]  [Nota Fiscal] [DACTE] [Pedido]

HISTORICO
14:32 Andre criou o recebimento
14:34 Andre adicionou 3 fotos
```

Fotos e PDFs abrem em visualizador interno. IDs, checksums, provider e pastas nao aparecem para usuario comum. Mensagens usam linguagem operacional, nunca erro de banco/Drive.

Testes obrigatorios: teclado, contraste AA, Chrome/Edge desktop, Android e Safari no iPhone, inclusive camera, galeria, rede instavel e arquivo duplicado.

## 10. APIs

### Convencoes

- base `/api/v1` e JSON UTF-8;
- autenticacao pela sessao OIDC segura; bearer somente para integracoes controladas;
- autorizacao sempre no servidor;
- erros `application/problem+json`;
- pagina por cursor, `limit` 25 por padrao e maximo 100;
- `Idempotency-Key` obrigatoria em criacao e upload;
- `If-Match` com `versao` em alteracoes;
- `X-Correlation-ID` em requisicao/resposta/log;
- ISO 8601 na API e `timestamptz` no banco;
- o cliente recebe codigo REC e UUIDs da aplicacao, nunca IDs/URLs do Drive;
- contrato versionado em OpenAPI e validado no pipeline.

O ETag e a `versao` do agregado `recebimentos`. Toda mutacao de item, arquivo ou divergencia bloqueia o pai e incrementa essa versao por trigger; endpoints filhos recebem `If-Match` do recebimento e devolvem a nova versao. Isso evita que dois usuarios alterem partes diferentes com o mesmo estado antigo.

### Endpoints

| Endpoint | Finalidade / entrada | Saida | Autenticacao, autorizacao e validacoes |
|---|---|---|---|
| `GET /me` | Usuario corrente | Nome, perfil e permissoes efetivas | Qualquer autenticado. |
| `GET /recebimentos` | `q`, `status`, `nf_pendente`, `origem`, fornecedor, responsavel, datas, cursor, limit, sort | Resumos + `next_cursor` | Todos; filtros parametrizados e escopo aplicado antes da paginacao. |
| `POST /recebimentos` | Dados gerais e itens opcionais | `201`, codigo REC, status, versao | Admin/Almox; idempotencia; rascunho pode ser incompleto. |
| `GET /recebimentos/{codigo}` | Registro completo | Dados, itens, arquivos, divergencias e acoes permitidas | Todos que podem visualizar; sem metadado do provider. |
| `PATCH /recebimentos/{codigo}` | Campos alterados | Recurso e nova versao | Admin/Almox; Suprimentos apenas campos autorizados; `If-Match`; bloqueio apos finalizacao. |
| `DELETE /recebimentos/{codigo}` | Motivo | `204` | Admin; exclusao logica e historico. |
| `POST /recebimentos/{codigo}/transicoes` | `{status_destino, observacao}` | Novo status/versao | Matriz de workflow; `SELECT FOR UPDATE`; valida NF, itens, uploads e divergencias. |
| `POST /recebimentos/{codigo}/reabrir` | Justificativa | Status Em conferencia | Somente Admin; justificativa obrigatoria. |
| `POST /recebimentos/{codigo}/itens` | Item | `201` item | Admin/Almox; quantidade positiva, unidade ativa, `If-Match`. |
| `PATCH /recebimentos/{codigo}/itens/{itemId}` | Campos do item | Item/versao | Admin/Almox; bloqueado finalizado; quantidade desconhecida fica `null`. |
| `DELETE /recebimentos/{codigo}/itens/{itemId}` | Motivo | `204` | Admin/Almox enquanto editavel; exclusao logica. |
| `POST /recebimentos/{codigo}/arquivos` | Multipart de um arquivo: arquivo, tipo, item opcional | `201` metadados, `202` processando ou `409` duplicado | Admin/Almox; Suprimentos para documentos; uma chave por arquivo, MIME real, limite, AV, checksum e pai nao finalizado. |
| `GET /arquivos/{arquivoId}/status` | Consulta estado assincrono | Estado sanitizado e erro acionavel | Mesmo acesso ao recebimento; nunca devolve provider/ID. |
| `POST /arquivos/{arquivoId}/retentar` | Retoma linha FALHOU | `202` mesma linha/estado | Quem pode anexar; mesma chave/hash; nao cria duplicata. |
| `GET /arquivos/{arquivoId}/conteudo` | `disposition=inline|attachment` | Stream, MIME, ETag, Range | Qualquer perfil com acesso; proxy autenticado; registra acesso. |
| `GET /arquivos/{arquivoId}/preview` | Tamanho de preview permitido | Imagem/stream privado | Mesma autorizacao do original. |
| `DELETE /arquivos/{arquivoId}` | Motivo | `204` | Regra da matriz; exclusao logica; nunca purga imediata. |
| `POST /arquivos/{arquivoId}/restaurar` | Motivo | Metadados restaurados | Admin. |
| `POST /recebimentos/{codigo}/divergencias` | Tipo, item, severidade, descricao | `201` e status atualizado | Almox/Admin; Suprimentos para documental; descricao obrigatoria. |
| `PATCH /divergencias/{id}` | Responsavel/descricao/status permitido | Divergencia | Conforme etapa e perfil; `If-Match`. |
| `POST /divergencias/{id}/resolver` | Resolucao | Divergencia resolvida | Suprimentos/Admin; resolucao obrigatoria; ultima resolucao habilita reconferencia. |
| `GET /recebimentos/{codigo}/historico` | Cursor/limit | Linha do tempo sanitizada | Todos com acesso; IP/user-agent somente Admin. |
| `GET /search?q=` | Busca completa e cursor | Recebimentos ranqueados | Todos; minimo 2 caracteres, timeout, limit e rate limit. |
| `GET /search/suggestions?q=` | Autocomplete | Ate 8 sugestoes | Todos; minimo 2 caracteres; nao revela recurso sem acesso. |
| `GET /catalogos` | Listas controladas ativas | Unidades, tipos, status | Qualquer autenticado. |
| `POST /catalogos/{tipo}` | Novo valor | `201` item | Admin; tipo em allowlist e codigo unico. |
| `PATCH /catalogos/{tipo}/{id}` | Nome, ordem ou ativo | Item | Admin; nao apagar valor ja referenciado. |
| `GET /fornecedores` | Busca/paginacao | Fornecedores | Todos; inativos apenas no historico/admin. |
| `POST /fornecedores` | CNPJ, razao, fantasia | `201` fornecedor | Admin/Almox; CNPJ normalizado/unico e criacao auditada. |
| `PATCH /fornecedores/{id}` | Campos e ativo | Fornecedor/versao | Admin; `If-Match`; snapshots antigos nao mudam. |
| `POST /recebimentos/{codigo}/conferir-historico` | Confirmacao e correcoes | Historico com qualidade CONFERIDO | Admin/Suprimentos; somente MIGRACAO; registra `conferido_em/por`. |
| `GET /recebimentos/export` | Filtros + `format=csv` | Stream CSV UTF-8/BOM | Perfis de consulta; mesmas regras da lista; exportacao auditada. |
| `GET /usuarios` | Busca/paginacao | Usuarios | Admin; lista reduzida de responsaveis pode ser usada por perfis de escrita. |
| `POST /usuarios` | OIDC subject, email, nome, perfil | `201` usuario | Admin; impedir duplicidade. |
| `PATCH /usuarios/{id}` | Perfil/ativo | Usuario | Admin; impedir desativacao do ultimo administrador. |
| `GET /admin/migracoes/{loteId}` | Estado do lote | Contadores/erros | Admin. |
| `GET /health/live` | Vida do processo | Estado simples | Infra; sem dados internos. |
| `GET /health/ready` | PostgreSQL e dependencias essenciais | Estado sanitizado | Restrito a infraestrutura. |

`sort` usa uma allowlist fechada; nunca concatena coluna recebida pelo cliente. Exportacao e stream com limite inicial de 100.000 linhas e periodo maximo de 24 meses por arquivo. Antes do CSV, textos iniciados por `=`, `+`, `-` ou `@` recebem apostrofo para neutralizar formula injection; exportacoes maiores viram job administrativo auditado.

Exemplo de criacao:

```json
{
  "pedido_compra": "225211",
  "numero_nf": null,
  "fornecedor_id": "52c6b146-...",
  "recebido_em": "2026-07-01T14:32:00-03:00",
  "tipo_recebimento_id": 1,
  "itens": [
    {
      "numero_item": 10,
      "codigo_produto": "79678",
      "descricao": "Manometro horizontal",
      "quantidade_recebida": 1,
      "unidade_codigo": "UN"
    }
  ]
}
```

```json
{
  "codigo": "REC-2026-000184",
  "status": "AGUARDANDO_DOCUMENTACAO",
  "nf_pendente": true,
  "versao": 1,
  "criado_em": "2026-07-01T17:32:04Z"
}
```

Exemplo de erro:

```json
{
  "type": "https://alm.interno/erros/nf-obrigatoria",
  "title": "Nota Fiscal pendente",
  "status": 422,
  "detail": "Anexe e informe a Nota Fiscal antes de finalizar.",
  "field": "numero_nf",
  "correlation_id": "7da60c88-..."
}
```

Codigos: `400` malformado, `401` nao autenticado, `403` sem permissao, `404` inexistente/nao visivel, `409` duplicidade/versao/idempotencia, `413` tamanho, `415` formato, `422` regra de negocio, `429` limite e `503` dependencia indisponivel.

## 11. Migracao do historico

### Decisao

Implantar o sistema novo sem esperar uma reconstrucao perfeita. Arquivos antigos entram como:

```text
origem = MIGRACAO
qualidade_dados = NAO_CONFERIDO
rotulo = HISTORICO - DADOS NAO CONFERIDOS
status operacional = nulo
```

Nunca inventar NF, pedido, fornecedor, produto ou data. Se somente ano/mes forem conhecidos, usar `ano_referencia/mes_referencia`; nao gravar o primeiro dia como se fosse a data real.

### Estrategia

- tornar a raiz antiga somente leitura ou gerar snapshot;
- uma pasta claramente associada a um recebimento gera um registro;
- agrupar arquivos soltos apenas com evidencia forte: mesma NF, fornecedor e periodo;
- em ambiguidade, manter separados em vez de unir incorretamente;
- campos nao identificados permanecem nulos;
- origem antiga nao e apagada durante o projeto;
- cada arquivo recebe chave de origem estavel e SHA-256.

### Processo executavel

```text
alm-migrate inventory --source <raiz> --batch MIG-2026-001
alm-migrate parse     --batch MIG-2026-001
alm-migrate dry-run   --batch MIG-2026-001
alm-migrate import    --batch MIG-2026-001
alm-migrate validate  --batch MIG-2026-001
alm-migrate rollback  --batch MIG-2026-001
```

1. Definir raiz, periodos, exclusoes e dono funcional.
2. Inventariar recursivamente caminho relativo, nome, extensao, tamanho e mtime.
3. Calcular SHA-256 em streaming.
4. Extrair por regras versionadas ano, mes, fornecedor, NF e pedido.
5. Gravar em staging (`lotes_migracao`/`itens_migracao`).
6. Produzir dry-run: arquivos, bytes, duplicados, reconhecidos e ambiguos.
7. Validar amostra estratificada com Almoxarifado/Suprimentos.
8. Importar por mes, 4 a 8 uploads concorrentes, usando `StorageService` e o mesmo dominio da API.
9. Conferir contagem, tamanho e SHA-256 em origem, banco e destino.
10. Emitir relatorio e aceite por lote.
11. Manter a origem por pelo menos 90 dias apos o aceite.

O importador executa com `app.ator_sistema='historical-migrator'`; `criado_por/alterado_por` recebem um usuario tecnico interno inativo para atribuicao, enquanto a auditoria registra corretamente o ator SISTEMA e o administrador operador do lote em `lotes_migracao.criado_por`.

### Logs e erros

Por arquivo: caminho relativo, hash, tamanho, metadados extraidos, confianca, recebimento/arquivo criado, estado, tentativas, erro sanitizado, data e versao do importador. Salvar log JSON estruturado e resumo CSV.

Um erro nao desfaz o lote. A unidade de trabalho e um recebimento historico. Erro transitorio recebe backoff; formato ilegivel vai para quarentena/relatorio; apos limite de tentativas, o lote termina `CONCLUIDO_COM_ERROS`.

Antes de copiar, comparar novamente tamanho, mtime e hash com o inventario. Mudanca da origem grava `status=ERRO`, `erro_codigo=ORIGEM_ALTERADA` e exige novo inventario; nao importar bytes diferentes sob a chave antiga. Testar reexecucao parcial apos interrupcao em cada estado.

### Deduplicacao e reexecucao

- mesmo hash no mesmo recebimento historico: um arquivo, demais caminhos viram alias no log;
- mesmo hash em recebimentos diferentes: manter vinculos separados;
- `(lote_id, chave_origem)` impede duplicar reexecucao;
- hash global apenas alerta;
- nunca deduplicar somente por nome.

### Rollback

Rollback e por lote e idempotente. Marcar o lote, bloquear novos trabalhos, identificar exclusivamente registros criados por ele, excluir logicamente os que nao receberam alteracao humana posterior e colocar objetos no container `QUARENTENA`. Registro alterado manualmente vira pendencia, nunca e removido automaticamente. Revisar a quarentena apos 30 dias, mas nao purgar automaticamente: a retencao documental aprovada prevalece. A origem permanece intacta.

## 12. Backup e recuperacao

Historico de versoes do Drive nao e backup completo.

### Banco

```text
PostgreSQL
-> PITR/WAL do servico gerenciado (quando disponivel)
-> pg_dump -Fc diario
-> repositorio criptografado em conta/local separado
```

Decisao inicial:

- PITR com RPO de 15 minutos, retencao de 7 dias;
- `pg_dump -Fc` diario por 35 dias;
- backup completo semanal retido por 12 semanas;
- backup completo mensal retido por 12 meses;
- criptografia em transito e repouso;
- restore automatizado mensal em banco isolado;
- exercicio completo trimestral.

### Arquivos

```text
Shared Drive
-> job incremental com identidade somente leitura
-> SHA-256 e manifesto
-> Amazon S3 em conta administrativa separada
```

```text
Opcao A: GCS no mesmo ecossistema
Opcao B: S3 em conta/provedor separado
Opcao C: NAS corporativo

Recomendacao: Opcao B.
Motivo: dominio de falha e credencial independente do Google Workspace.
```

Se Azure Blob ja for o padrao corporativo, ele substitui S3 sem mudar o desenho; a decisao de projeto continua sendo um segundo provider independente.

Politica:

- incremental a cada 6 horas, descoberto por `arquivos` DISPONIVEL sem copia valida em `arquivo_backups`;
- inventario diario completo e Drive Changes API como deteccao adicional de alteracao/exclusao administrativa;
- manifesto diario com `cutoff_at`, versao do formato, UUID, namespace, objeto, SHA-256 e referencia ao backup do banco compativel;
- a copia canonica permanece enquanto o documento estiver retido; versoes substituidas ficam no minimo 90 dias;
- copias completas mensais por 12 meses;
- excluido logicamente permanece no backup por no minimo 180 dias ou prazo fiscal superior;
- credencial de backup nao apaga versoes;
- comparacao de tamanho/SHA-256 a cada copia;
- verificacao integral trimestral;
- restauracao mensal de amostra e trimestral de pelo menos 10 recebimentos completos.

`arquivo_backups` e o catalogo operacional por objeto. Alertar arquivo disponivel sem backup apos seis horas, checksum divergente, job incompleto e manifesto diario ausente. A credencial curta/federada do backup tem `PutObject` e leitura minima, mas nao `DeleteObject`/`DeleteObjectVersion`; uma identidade separada executa restauracao.

Metas: RPO banco 15 minutos, RPO arquivos 6 horas, RTO do servico essencial 8 horas e RTO de um recebimento 4 horas. A area responsavel deve aceitar formalmente esses valores.

Runbooks diferentes evitam restauracao destrutiva desnecessaria:

- **arquivo individual ausente:** nao restaurar banco; copiar do S3 para novo objeto do Drive, atualizar o ID em transacao tecnica e auditar;
- **perda do Shared Drive:** manter PostgreSQL atual, recriar objetos pelo catalogo/manifesto e reconciliar;
- **desastre completo:** escolher instante `T`, restaurar PostgreSQL para `T`, selecionar manifesto com `cutoff_at` compativel e restaurar objetos;
- **corrupcao logica no banco:** restaurar em ambiente isolado, comparar e promover apenas pelo runbook aprovado.

Nunca reconstruir relacoes pelos nomes das pastas.

## 13. OCR como segunda fase

OCR nao entra no MVP. Executar piloto com 80 a 100 NFs reais, ao menos 10 fornecedores, PDFs digitais, scans e fotos em qualidades variadas. Criar gabarito humano antes de processar e separar o conjunto de ajuste do conjunto final de teste. Antes de enviar documentos a um provedor, aprovar seguranca/privacidade, regiao de processamento, retencao, uso para treinamento e contrato/DPA.

```text
Fotografar/anexar NF
-> OCR processa copia
-> apresenta numero, fornecedor, CNPJ, data, valor e pedido sugeridos
-> funcionario compara com o original
-> corrige e confirma
-> somente a confirmacao altera o registro oficial
-> sugestao, confianca e correcao ficam auditadas
```

Metricas:

- exatidao e cobertura por campo;
- documento inteiro correto;
- falsos positivos e taxa de correcao humana;
- tempo manual antes/depois;
- latencia p50/p95 e custo por documento;
- resultado por fornecedor/qualidade da imagem;
- taxa de abandono.

Continuar para producao somente se:

- NF e CNPJ >= 98% de exatidao;
- fornecedor e data >= 95%;
- pedido, quando presente, >= 85%;
- documento inteiro correto >= 90% no conjunto de teste separado;
- reducao mediana de tempo >= 30%;
- erro critico < 2%;
- custo < 20% da economia estimada de digitacao;
- revisao humana em 100% dos casos no inicio.

Se o desempenho variar muito, habilitar apenas para layouts/fornecedores aprovados. OCR nunca sobrescreve silenciosamente um dado confirmado.

## 14. Estrategia de escalabilidade

### Decisao para o volume previsto

PostgreSQL, o monolito modular e o Shared Drive atendem ao cenario inicial: dezenas de usuarios, dezenas de milhares de recebimentos e alguns milhoes de linhas relacionadas. A primeira resposta a crescimento deve ser medir e otimizar a solucao atual, nao introduzir uma nova plataforma.

| Componente | Continua adequado enquanto | Acao ao atingir o limite pratico |
|---|---|---|
| PostgreSQL | busca p95 <= 500 ms, autocomplete p95 <= 250 ms, CPU/IO com margem e autovacuum saudavel | analisar consultas com `EXPLAIN (ANALYZE, BUFFERS)`, revisar indices, pool e capacidade vertical; usar replica de leitura apenas se relatorios competirem com operacao |
| Tabelas transacionais | ate milhoes de recebimentos/itens sem degradacao mensurada | arquivar dados somente por regra de negocio; particionar primeiro auditoria/historicos quando chegarem a dezenas de milhoes de linhas |
| Shared Drive | quantidade de itens, cota de API e latencia permanecem com margem | alertar aos 300.000 itens e parar novas gravacoes nesse Drive aos 350.000; abrir novo destino administrado ou migrar o storage primario |
| Busca PostgreSQL | relevancia e erros simples sao resolvidos por B-tree, `pg_trgm` e FTS | considerar mecanismo externo apenas depois de teste de carga e requisito comprovado de busca semantica/multilingue |

Um Shared Drive tem limite oficial de 500.000 itens, contando arquivos, pastas e itens na lixeira. Por isso os limiares acima deixam margem operacional e tornam indispensavel criar pastas apenas quando necessario. Fonte: [limites de Shared Drives do Google Workspace](https://support.google.com/a/users/answer/7338880?hl=pt-BR).

### Quando trocar o storage de arquivos

```text
Opcao A: manter Shared Drive
Opcao B: segmentar em mais Shared Drives
Opcao C: migrar o provider primario para GCS/S3/Azure Blob

Recomendacao agora: Opcao A, com monitoramento e backup independente.
Recomendacao ao atingir 300.000 itens ou limitacao recorrente de API/latencia: planejar Opcao C.
```

Migrar para object storage passa a fazer sentido quando houver centenas de milhares de objetos, necessidade de lifecycle automatizado, downloads em grande escala, URLs assinadas/CDN ou quotas do Drive afetando a operacao. A troca e localizada no adaptador `StorageService`; `recebimentos`, itens, permissoes e APIs nao mudam.

### Testes e observabilidade

- teste de carga antes da homologacao com pelo menos 100.000 recebimentos sinteticos, cinco itens e oito arquivos de metadados por recebimento;
- metas: autocomplete p95 <= 250 ms, busca/lista p95 <= 500 ms e detalhe sem arquivo p95 <= 400 ms;
- painel com latencia, erros por endpoint, pool do banco, slow queries, taxa/latencia do Drive, uploads pendentes, objetos orfaos e quantidade de itens no Shared Drive;
- alertas para erro >= 2% por 5 minutos, fila de reconciliacao envelhecida, backup atrasado, restore falho e limite de itens;
- toda medicao deve separar aplicacao, PostgreSQL e Google Drive para localizar o gargalo real.

## 15. MVP

| Requisito | Classificacao | Decisao de entrega |
|---|---|---|
| PostgreSQL, migrations e integridade referencial | `OBRIGATORIO NO MVP` | Schema da secao 3 aplicado automaticamente por ambiente. |
| Shared Drive institucional e identidade tecnica exclusiva | `OBRIGATORIO NO MVP` | Nenhum Drive pessoal e nenhum usuario comum como membro. |
| Aplicacao como unica interface de arquivos | `OBRIGATORIO NO MVP` | Preview/download autenticados por proxy; sem links ou IDs do Drive. |
| UUID interno e codigo `REC-AAAA-NNNNNN` | `OBRIGATORIO NO MVP` | Geracao atomica e codigo imutavel. |
| Cadastro com varios itens, anexos e divergencias | `OBRIGATORIO NO MVP` | Fluxo responsivo com rascunho e salvamento por etapa. |
| Status, NF condicional e regras de finalizacao | `OBRIGATORIO NO MVP` | Validacao na API e no banco. |
| Login corporativo, quatro perfis e menor privilegio | `OBRIGATORIO NO MVP` | OIDC, sessao segura e autorizacao por acao. |
| `StorageService` desacoplado do Drive | `OBRIGATORIO NO MVP` | Interface e adaptador testavel, sem regra de negocio no cliente Google. |
| Upload real, validacao, SHA-256 e deduplicacao no recebimento | `OBRIGATORIO NO MVP` | Estados de upload, compensacao e reconciliacao. |
| Busca unica, filtros e autocomplete | `OBRIGATORIO NO MVP` | B-tree, trigramas e FTS no PostgreSQL. |
| Historico, auditoria, exclusao logica e quarentena | `OBRIGATORIO NO MVP` | Acoes relevantes sao rastreaveis; remocao fisica e job controlado. |
| Backup independente e teste de restore | `OBRIGATORIO NO MVP` | Nao entrar em producao apenas com versionamento do Drive. |
| Uso mobile, camera e multiplas fotos | `OBRIGATORIO NO MVP` | Validado em aparelhos reais e rede instavel. |
| Varredura antimalware dos anexos | `OBRIGATORIO NO MVP` | Fail-closed; arquivo suspeito nunca entra no storage canonico e segue a politica de incidente. |
| Hash global como alerta de copia repetida | `IMPORTANTE` | Avisar sem bloquear recebimentos legitimamente distintos. |
| Reconciliador de pendencias/inconsistencias e propriedades tecnicas | `OBRIGATORIO NO MVP` | Fecha a saga sem tornar o Drive fonte de verdade. |
| Upload retomavel backend-Drive | `OBRIGATORIO NO MVP` | Evita duplicidade e perda em falha da API do Drive. |
| Retomada cliente-backend em blocos, miniaturas e inventario completo | `IMPORTANTE` | Ativar conforme testes moveis e operacionais. |
| Inspecao automatica das permissoes do Shared Drive | `IMPORTANTE` | Job diario alerta membro humano ou compartilhamento indevido. |
| Migracao por inventario, piloto e lotes | `IMPORTANTE` | Pode ocorrer em paralelo apos o fluxo novo estar estavel. |
| OCR de Nota Fiscal | `FASE 2` | Piloto e revisao humana conforme secao 13. |
| Consulta/validacao com ERP | `FASE 2` | Integracao somente apos contrato e API do ERP definidos. |
| Notificacoes e protocolo PDF | `FASE 2` | Adicionar depois de validar eventos e destinatarios. |
| Deduplicacao fisica global dos bytes | `FUTURO` | Somente com requisito juridico e modelo seguro de referencias. |
| Migrar o storage primario para GCS/S3/Azure | `FUTURO` | Acionado pelos limiares da secao 14, nao por antecipacao. |
| Elasticsearch/OpenSearch, microsservicos ou Kubernetes | `FUTURO` | Apenas se medicao demonstrar limite que PostgreSQL/monolito nao resolvem. |

O MVP corporativo nao e apenas a interface React atual: ele exige API, banco, autenticacao, armazenamento real, auditoria, backup e controles de arquivo antes de operar com documentos reais.

## 16. Plano de implementacao

### Etapa 0 - Fechamento funcional (1 semana)

1. Validar campos, catalogos, perfis, matriz de status e documentos obrigatorios com Almoxarifado, Suprimentos e TI.
2. Congelar criterios de aceite, metas de busca/upload e politica de retencao.
3. Nomear dono funcional, administrador tecnico e responsavel por seguranca/backup.

**Saida:** especificacao assinada, backlog priorizado e dados de teste anonimizados.

### Etapa 1 - Fundacao tecnica (1 semana)

1. Criar ambientes desenvolvimento, homologacao e producao separados.
2. Provisionar PostgreSQL, segredos, OIDC e Shared Drive de desenvolvimento.
3. Criar migrations, pipeline CI e verificacoes de lint/teste/seguranca.
4. Implementar observabilidade basica e `correlation_id`.

**Saida:** deploy vazio repetivel e seguro.

### Etapa 2 - Dominio e API principal (2 semanas)

1. Aplicar o schema, seeds e triggers da secao 3.
2. Implementar usuarios/perfis, recebimentos, itens, divergencias e transicoes.
3. Adicionar idempotencia, `If-Match`, erros RFC 9457 e testes de autorizacao.
4. Criar dados sinteticos e testes das regras de finalizacao.

**Saida:** API transacional sem arquivos.

### Etapa 3 - Arquivos e seguranca (2 semanas)

1. Implementar `StorageService` e `GoogleDriveAdapter`.
2. Implementar upload streaming, SHA-256, MIME real, limites, antimalware, estados e compensacao.
3. Implementar preview/download por proxy, exclusao logica e quarentena.
4. Criar reconciliador e inspetor de ACL/permissoes.

**Saida:** ciclo de vida de arquivo testado inclusive em falhas simuladas.

### Etapa 4 - Busca e UX (2 semanas)

1. Implementar indices, busca ranqueada, autocomplete e filtros.
2. Adaptar o frontend existente para API, sessao real e tratamento de concorrencia.
3. Finalizar cadastro em etapas, camera, multiplos arquivos, detalhe e historico.
4. Executar testes de usabilidade com 5 a 8 usuarios e aparelhos reais.

**Saida:** MVP funcional completo em homologacao.

### Etapa 5 - Backup, carga e seguranca (1 a 2 semanas)

1. Implantar backups do banco e copia independente dos arquivos.
2. Executar restores, teste de carga, analise de indices, DAST/SAST e revisao de permissoes.
3. Corrigir achados altos/criticos e documentar runbooks.

**Saida:** evidencias objetivas para go-live.

### Etapa 6 - Piloto e producao (2 semanas)

1. Treinar grupo piloto, operar com recebimentos reais controlados e suporte proximo.
2. Medir tempo, falhas, fotos, buscas, pendencias e aderencia ao fluxo.
3. Corrigir bloqueadores, obter aceite e executar implantacao gradual.
4. Congelar novos registros no processo antigo na data de corte, preservando consulta.

**Saida:** producao aceita e acompanhada.

### Etapa 7 - Migracao historica (paralela, por lotes)

1. Inventariar, executar dry-run, validar amostra e importar um mes piloto.
2. Ajustar regras e migrar os demais meses em lotes auditaveis.
3. Emitir conciliacao e aceite por lote; manter a origem pelo prazo definido.

**Saida:** historico pesquisavel com qualidade explicitamente identificada.

Estimativa inicial: 10 a 12 semanas para o MVP corporativo com uma equipe pequena dedicada, mais a migracao historica em paralelo. A estimativa deve ser refinada depois da Etapa 0 e da prova de upload/identidade tecnica.

## 17. Riscos tecnicos

Escala: probabilidade e impacto classificados como Baixa, Media ou Alta.

| Risco | Probabilidade | Impacto | Mitigacao e indicador |
|---|---|---|---|
| Credencial tecnica vazada ou excessiva | Baixa | Alta | identidade por workload, sem chave longa, Drive exclusivo, menor privilegio, rotacao/revogacao e alerta de acesso anomalo |
| Politica Workspace impedir service account externa | Media | Alta | validar no spike da primeira semana com Admin Workspace; usar identidade tecnica no dominio/projeto aprovado, sem usuario generico |
| Usuario obter acesso direto ao Shared Drive | Media | Alta | nao adicionar humanos, bloquear compartilhamento externo, job diario de ACL e teste negativo antes do go-live |
| Objeto no Drive sem linha no banco | Media | Media | saga, propriedades tecnicas, compensacao e reconciliador diario com quarentena |
| Linha `arquivo` sem objeto correspondente | Media | Alta | estados explicitos, nao disponibilizar antes de `DISPONIVEL`, reconciliacao e restore pelo manifesto |
| Foto duplicada ou consumo excessivo | Alta | Media | SHA-256 no recebimento, alerta global, compressao de imagem e limites de lote |
| Rede movel interromper foto/upload | Alta | Media | fila individual, tres uploads paralelos, idempotencia, retomada e formulario preservado |
| Malware ou arquivo disfarçado | Media | Alta | assinatura real/MIME, allowlist, antimalware, quarentena e cabecalhos seguros no download |
| Lentidao da busca com crescimento | Media | Media | indices medidos, FTS/trigram, teste com volume futuro, slow-query log e metas p95 |
| Excesso de indices degradar escrita | Media | Media | conjunto minimo da secao 4, `pg_stat_user_indexes`, remover indice nao utilizado apos janela representativa |
| Limite/quota/indisponibilidade do Drive | Media | Alta | retry com jitter, circuit breaker, upload retomavel, monitoramento de itens/quota e plano de troca pelo `StorageService` |
| Crescimento atingir limite do Drive antes da projecao | Baixa | Alta | medir baseline e tendencia mensal, alertar 300 mil, bloquear novas gravacoes 350 mil e testar novo provider antes do gatilho |
| Corrida ao gerar codigo `REC` | Media | Alta | contador anual transacional com bloqueio de linha e teste concorrente |
| Edicao concorrente sobrescrever dados | Media | Media | coluna `versao`, ETag/`If-Match`, `409` e tela de reconciliacao |
| Finalizacao indevida sem NF/divergencia resolvida | Media | Alta | regra duplicada na API e trigger de banco, testes de transicao e auditoria |
| Alteracao posterior invalidar recebimento finalizado | Media | Alta | filhos bloqueiam/lockam o pai; reabertura administrativa obrigatoria; teste negativo por endpoint |
| Migracao associar arquivos ao recebimento errado | Alta | Alta | confianca explicita, nao inferir ambiguidade, dry-run, amostra humana e rollback por lote |
| Backup existir mas nao restaurar | Media | Alta | restore mensal automatizado, exercicio trimestral e evidencia de RPO/RTO |
| Dados pessoais/sensiveis em logs | Media | Alta | logs estruturados sem arquivo/token/conteudo, mascaramento, acesso restrito e retencao |
| CSV executar formula ao abrir no Excel | Media | Alta | neutralizar prefixos `= + - @`, streaming, allowlist de sort e teste com payloads maliciosos |
| Scope aumentar antes da validacao | Alta | Media | matriz MVP, criterio de mudanca e OCR/ERP bloqueados para Fase 2 |

## 18. Checklist para entrar em producao

### Funcional e dados

- [ ] Fluxo e campos aprovados formalmente por Almoxarifado e Suprimentos.
- [ ] Catalogos de unidade, tipo, arquivo e divergencia revisados.
- [ ] Todas as transicoes permitidas e proibidas foram testadas por perfil.
- [ ] NF pendente permite rascunho e bloqueia corretamente a finalizacao.
- [ ] Divergencia aberta e upload pendente bloqueiam corretamente a finalizacao.
- [ ] Codigo `REC` foi testado com criacoes simultaneas e nao duplica.
- [ ] Exclusao logica, restauracao e quarentena foram validadas.

### Busca e UX

- [ ] NF, pedido, fornecedor, produto, codigo, responsavel, data e `REC` retornam resultados corretos.
- [ ] Acentos, caixa, nomes parciais e um erro simples de digitacao foram testados.
- [ ] Autocomplete respeita minimo, debounce, limite, ranking e autorizacao.
- [ ] Metas p95 foram atingidas com o volume sintetico definido.
- [ ] Cadastro, camera, multiplas fotos e retomada de erro foram testados em celular/tablet reais.
- [ ] Pelo menos 5 usuarios leigos completaram o roteiro sem ajuda critica.

### Seguranca

- [ ] OIDC de producao, logout, expiracao de sessao e revogacao funcionam.
- [ ] Cookie `__Host-`, CSRF, CSP, HSTS e cabecalhos do proxy foram testados.
- [ ] Matriz RBAC possui testes automatizados de allow/deny para cada endpoint.
- [ ] Nenhum usuario comum e membro do Shared Drive ou recebe ID/URL do Drive.
- [ ] Service account possui somente os papeis necessarios e nao usa chave permanente exposta.
- [ ] Compartilhamento externo esta bloqueado e inspecao de ACL esta ativa.
- [ ] Preview/download exigem autorizacao em toda requisicao e usam cabecalhos seguros.
- [ ] Upload valida tamanho, formato real, checksum e antimalware.
- [ ] Scanner esta fail-closed, com assinatura atual, monitoramento e limpeza de temporarios testada apos crash.
- [ ] Segredos estao em cofre e nao aparecem em codigo, logs ou frontend.
- [ ] Vulnerabilidades altas/criticas de dependencias, SAST/DAST e revisao manual foram resolvidas.
- [ ] Retencao, acesso e exportacao de logs/auditoria estao aprovados.

### Operacao, Drive e banco

- [ ] Migrations aplicam em banco vazio e em copia da versao anterior.
- [ ] Integridade referencial, triggers e indices foram verificados em PostgreSQL de homologacao.
- [ ] Toda mutacao de item/arquivo/divergencia incrementa a versao do recebimento e invalida ETag antigo.
- [ ] Alteracao de filho ou NF em recebimento finalizado falha ate a reabertura auditada.
- [ ] `StorageService` foi testado com falha antes, durante e depois do upload.
- [ ] Reconciliador detecta ambos os tipos de inconsistencia banco-storage.
- [ ] Retry/backoff respeita quotas da API e nao duplica objetos.
- [ ] Alertas de erro, latencia, pool, quota, itens, reconciliacao e backup chegam ao plantao correto.
- [ ] Baseline, crescimento mensal e projecao de itens do Shared Drive foram registrados.
- [ ] Health checks nao expõem dados internos.

### Backup, continuidade e migracao

- [ ] `pg_dump`, WAL/PITR e copia independente dos arquivos executam sem erro.
- [ ] Restore completo em ambiente isolado atendeu RPO/RTO e checksums.
- [ ] Credencial de backup nao consegue apagar versoes protegidas.
- [ ] Runbook de indisponibilidade do Google Drive foi ensaiado.
- [ ] Inventario/dry-run da migracao foi aprovado e um mes piloto conciliado.
- [ ] Reexecucao completa e parcial da migracao nao cria registros/objetos duplicados.
- [ ] Origem historica esta preservada e o rollback por lote foi testado.

### Implantacao e governanca

- [ ] Donos funcional, tecnico, seguranca, backup e suporte estao nomeados.
- [ ] Usuarios foram treinados; manual curto e canal de suporte estao publicados.
- [ ] Plano de corte, rollback, comunicacao e janela de suporte foram aprovados.
- [ ] Restore de configuracoes e segredos possui procedimento documentado sem copiar credenciais antigas inseguras.
- [ ] Monitoramento intensivo dos primeiros dias possui responsaveis e criterios de parada.
- [ ] Evidencias e aceite final estao registrados.

## Se eu fosse comecar a implementar amanha

As 10 primeiras tarefas, nesta ordem exata:

1. Versionar no repositorio a ADR arquitetural, o dicionario de dados, a matriz de autorizacao, o workflow e o OpenAPI inicial ja aprovados pelo funcional/TI.
2. Criar o monorepo/estrutura modular do backend TypeScript, convencoes de ambiente, CI e primeira migration versionada.
3. Provisionar PostgreSQL e OIDC de desenvolvimento, sem reutilizar credenciais de homologacao ou producao.
4. Criar o Shared Drive de desenvolvimento, a identidade tecnica sem chave permanente e validar upload/download com menor privilegio.
5. Aplicar e testar o DDL da secao 3, incluindo concorrencia do codigo `REC`, integridade composta e triggers de finalizacao/auditoria.
6. Implementar autenticacao, sessao, `usuarios` e middleware de autorizacao com testes positivos e negativos para os quatro perfis.
7. Implementar a API de recebimentos, itens, divergencias e transicoes de status com idempotencia e controle otimista por `versao`.
8. Implementar `StorageService`, `GoogleDriveAdapter` e o fluxo de upload streaming com SHA-256, validacao, antimalware, compensacao e reconciliacao.
9. Implementar indices, busca ranqueada, autocomplete e testes de carga com massa sintetica representativa.
10. Conectar o frontend React existente a API, concluir o fluxo mobile e executar o primeiro teste de ponta a ponta com usuarios do Almoxarifado.
