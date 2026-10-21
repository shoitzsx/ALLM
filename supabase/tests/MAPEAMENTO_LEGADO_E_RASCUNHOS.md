# ALM — contrato de migração de dados e rascunhos (Sheets → PostgreSQL)

**Status:** revisão do contrato; **nenhuma migração de dados executada**.
**Responsáveis:** Kobner documenta o schema; Goran implementa o mapeamento
no backend e plano de importação; Lucas ajusta a interface. Decisões abertas
dependem da equipe. Não criar dados de demonstração nem reescrever as
migrations já aplicadas.

## 1. Diferenças de modelos já confirmadas

| Modelo atual da API/Sheets | PostgreSQL `alm` | Tratamento |
|---|---|---|
| `usuarios.id = 'USR-001'` | `usuarios.id uuid` | Mapear ID legado → UUID, manter tabela de correspondência no plano de importação (não migrar seed/demo como pessoa real) |
| `usuario.perfil = 'Administrador'` etc. | `usuarios.perfil='ADMINISTRADOR'`, `ALMOXARIFADO`, `SUPRIMENTOS`, `CONSULTA`, `PORTARIA` | Mapeamento explícito, não confiar em papel vindo do navegador |
| Sem login real, `X-User-Id` | `usuarios.matricula`, `credenciais_pin`, `sessoes` | Autenticação a implementar no servidor; não converter IDs falsos em acesso real |
| `recebimento.id` / `protocolo` às vezes `REC-AAAA-NNNN` | `recebimentos.id uuid`, `codigo REC-AAAA-NNNNNN`, `codigo_legado text UNIQUE` | Gerar UUID/código oficial no banco; preservar protocolo antigo em `codigo_legado` quando aplicável |
| `pedido` | `pedido_compra text` | Pode ser NULL no rascunho; obrigatório para outros estados operacionais |
| `numeroNf`, `serieNf` | `numero_nf`, `serie_nf` | Campos opcionais inicialmente; numero NF exigido para finalização |
| `dataRecebimento` (YYYY-MM-DD) | `recebido_em timestamptz` | Definir convenção de hora/fuso antes de importar |
| `fornecedor`, `cnpjFornecedor` texto | `fornecedor_id uuid` FK + snapshots de nome/CNPJ | Resolver fornecedor por CNPJ/catálogo, não inventar UUIDs |
| `tipo` texto (p.ex. Estoque) | `tipo_recebimento_id smallint` FK | Mapear por catálogo `alm.tipos_recebimento`, não por suposição de ordem |
| `responsavel.id`, `criadoPor` etc. em strings | `responsavel_id`, `criado_por`, `alterado_por` UUID FK | Mapear autoria real; decidir estratégia para registros sem ator confiável |
| `status` com rótulos PT-BR | `status` em enum de CHECK textual uppercase | Traduzir e validar transições |
| `itens[].id` como `IT-<uuid>` | `recebimento_itens.id uuid` | Novos UUIDs e mapa de referências para divergências/anexos |
| `itens[].numero` string, ex. `"10"` | `numero_item integer > 0` único ativo por REC | Converter/verificar colisões |
| `itens[].quantidadeRecebida` | `quantidade_recebida numeric(18,6) > 0` | Não persistir linhas incompletas/zero como itens oficiais |
| `itens[].unidade` | `unidade_codigo` FK `unidades_medida` | Mapear códigos exatamente existentes, inclusive `PÇ` |
| `anexos[].storageKey` | `arquivos.storage_object_id`, `storage_container_id` etc. | Drive fica com bytes, banco com vínculo/metadados |
| `anexos[].nome,mimeType,tamanho` | `nome_original`, `mime_type_detectado`, `tamanho_bytes > 0` etc. | Validar metadados reais; não inventar checksum/nome |
| `anexos[].id = ANX-<uuid>` | `arquivos.id uuid` | Novo UUID + referência legada, se necessária |
| `arquivado` boolean | `excluido_em`, `excluido_por`, `motivo_exclusao` | **Não presumir equivalência sem decisão**: arquivamento pode ser distinto de exclusão lógica |
| `divergencias` com strings + `resolvida` | `divergencias.status` + FK tipo/item | Mapear `ABERTA`/`RESOLVIDA`, categorias, autor e resolução |

### Status da API → código PostgreSQL

| API / UI | Banco |
|---|---|
| `Em digitação` | `EM_DIGITACAO` |
| `Aguardando documentação` | `AGUARDANDO_DOCUMENTACAO` |
| `Em conferência` | `EM_CONFERENCIA` |
| `Divergência identificada` | `DIVERGENCIA_IDENTIFICADA` |
| `Conferido/Finalizado` | `CONFERIDO_FINALIZADO` |

Os status atuais provêm de `src/data.js`; os CHECKs, de
`20261007160000_alm_v1_base.sql`.
O `status` de um registro `MIGRACAO` é NULL, com
`origem='MIGRACAO'`; importações históricas não devem virar
recebimentos operacionais finalizados por simples conversão de strings.

## 2. Rascunhos: campos que podem estar incompletos

Para `alm.recebimentos` com `origem='OPERACIONAL'`,
`status='EM_DIGITACAO'` e usuário autenticado:

- Campos **sempre necessários para a linha**: `responsavel_id`,
  `criado_por`, `alterado_por` UUIDs válidos, além dos defaults e
  colunas preenchidos pelo trigger (`id`, `codigo`,
  `qualidade_dados='PENDENTE_CONFERENCIA'` e `status`).
- Campos **que podem estar vazios/NULL** nessa fase:
  `pedido_compra`, `numero_nf`, `serie_nf`,
  `nfe_chave_acesso`, `fornecedor_id`, `recebido_em`,
  `tipo_recebimento_id`, `observacoes` e os campos de competência
  desde que o par ano/mês respeite sua constraint.
- Itens e anexos **não são exigidos para criar o rascunho**.
- Para sair de `EM_DIGITACAO` para outro status operacional, o banco
  exige pedido não vazio, `fornecedor_id`, snapshot de nome do
  fornecedor, `recebido_em`, `responsavel_id` e
  `tipo_recebimento_id`.
- Finalização exige ainda nota NF, ao menos um item ativo, anexo de Nota
  Fiscal `DISPONIVEL`, ausência de uploads pendentes e divergências
  abertas, e diferenças de quantidades resolvidas.

### Momento em que um item passa a existir no banco

**Regra SQL atual, a preservar:** o INSERT em
`alm.recebimento_itens` só é permitido se:

- `recebimento_id` aponta para um REC existente;
- `numero_item` é inteiro maior que zero e único entre os itens
  ativos do mesmo REC;
- `descricao` não é vazia;
- `quantidade_recebida > 0`;
- `unidade_codigo` identifica unidade existente;
- `criado_por` e `alterado_por` são UUIDs válidos;
- a operação respeita auditoria, RLS e proteção de REC finalizado.

**Proposta de contrato do rascunho:** permitir criar a linha pai REC
sem itens; o frontend pode editar linhas de formulário incompletas
localmente e o backend **só persistirá em `alm.recebimento_itens`**
os itens completos. A aplicação deverá explicar ao usuário se um
item incompleto ficou apenas no cliente. Se for necessário manter
**itens incompletos após recarga/troca de dispositivo**, isso requer
uma solução própria acordada (ex.: estado de rascunho separado);
**não relaxar `quantidade_recebida > 0` nem outros CHECKs sem decisão.**

A estratégia de edição de itens incompletos no cliente e eventual
persistência separada continua **pendente de aprovação de Goran/Lucas**.

## 3. Proteção de finalizados e exclusão lógica

Recebimentos com `status='CONFERIDO_FINALIZADO'` não podem ter
campos funcionais alterados diretamente. Reabertura deve alterar
apenas status e qualidade, sujeita às regras do banco.
Itens, arquivos e divergências associados também ficam protegidos,
com exceções estritas para atualização técnica do arquivo por sistema.
Não existe exceção automática de edição funcional por ser administrador.

A exclusão lógica em `alm` exige, nas tabelas pertinentes,
`excluido_em`, `excluido_por` e `motivo_exclusao`
consistentes. O legado `arquivado` precisa de decisão de significado;
não mapear automaticamente para `excluido_em`.

## 4. Anexos: dados que faltam no contrato antigo

`alm.arquivos` exige `recebimento_id`, `tipo_arquivo_codigo`,
`storage_namespace`, `storage_container_id`,
`nome_original`, `nome_storage`, `mime_type_detectado`,
`tamanho_bytes > 0`, `checksum_sha256` hexadecimal minúsculo
de 64 caracteres, `idempotency_key uuid`,
`criado_por` e `alterado_por`.
Provider padrão `GOOGLE_DRIVE`; para
`status_upload='DISPONIVEL'`, `storage_object_id` deve existir.

A FK composta exige coerência entre o container, REC, provider,
namespace e tipo de arquivo; vincular o objeto Drive não é só
gravar um `storageKey`. O backend deve obter/calcular dados
reais e avaliar o tratamento de registros antigos incompletos.

## 5. Plano de importação/recuperação: responsabilidade de integração

Antes de trocar a persistência do backend, elaborar e aprovar:

1. Exportação e backup verificável dos registros legados do Sheets e
   inventário dos arquivos existentes no Drive (sem gravar senhas/logs).
2. Mapeamento de IDs de usuários/recibos/itens/anexos/divergências;
   deduplicação e validação das chaves estrangeiras.
3. Política para usuários demo vs. reais, históricos sem autoria,
   fornecedores desconhecidos, itens com quantidade zero,
   anexos sem checksum/container e divergências antigas.
4. Importação **idempotente** em staging próprio/testável, com
   relatório de rejeições; não alterar staging atual sem autorização.
5. Reconciliação por contagens e amostras funcionais, testes de
   auditoria e rollback/recuperação definidos antes do corte.
6. Troca controlada do backend para PostgreSQL e desativação de
   escritas em Sheets; não construir espelho novo.

**Pendências de decisão:** rascunho incompleto após recarga,
equivalência ou não de arquivamento/exclusão, autoria histórica,
eventuais entregas parciais com mesma chave NF-e e critérios
de preservar anexos sem metadados completos.

**Fontes verificadas:** `src/data.js`,
`backend/services/recebimentosService.mjs`,
`backend/repositories/recebimentosRepository.mjs`,
`supabase/migrations/20261007160000_alm_v1_base.sql`,
`20261007160100_alm2_delta.sql` e
`20261007160200_alm_integridade.sql`.
