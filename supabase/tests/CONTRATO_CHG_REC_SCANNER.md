# ALM — contrato SQL de Portaria (CHG), recebimento (REC) e scanner

**Estado verificado:** migrations aplicadas no staging em 15/10/2026.
**Escopo:** contrato para Goran (API) e Lucas (scanner), documentado por
Kobner dentro de `supabase/`. **Nenhuma migration ou alteração de backend**
é feita por este documento. A integração real ainda está pendente.

## 1. Contrato já implementado: conversão de uma CHG existente

Assinatura exata no PostgreSQL:

```sql
alm.criar_recebimento_da_chegada(p_chegada_id uuid)
RETURNS TABLE (recebimento_id uuid, codigo varchar(20), reutilizado boolean)
```

Criada em `20261015010000_alm_chg_rec_atomico.sql` como
`SECURITY DEFINER`, com `EXECUTE` concedido a `alm_api`
(e revogado de `PUBLIC`).

**Pré-condições verificadas pela função:**

1. A transação deve ter `app.usuario_id` não vazio, UUID válido de usuário
   **ativo**, e `app.ator_sistema` **ausente**.
2. `p_chegada_id` precisa identificar `alm.chegadas_portaria.id` existente,
   não excluída.
3. Na primeira conversão, `status='REGISTRADA'` e
   `recebimento_id IS NULL`. CHG cancelada/vinculada de modo inconsistente
   não cria novo REC.
4. O backend continua responsável pela **autorização por perfil humano**.
   `alm_api` é papel técnico, não substitui permissão de negócio.

**Efeitos exatos no primeiro uso:**

- Trava a linha da CHG com `SELECT ... FOR UPDATE`, serializando retries.
- Insere `alm.recebimentos` com `origem='OPERACIONAL'`,
  `numero_nf`, `serie_nf`, `nfe_chave_acesso`,
  `fornecedor_id` copiados da CHG (podem estar nulos quando permitido),
  `responsavel_id=criado_por=alterado_por=app.usuario_id`, e
  `dados_origem` contendo `chegada_portaria_id` e `chegada_codigo`.
- O trigger `alm.preparar_recebimento()` preenche
  `status='EM_DIGITACAO'`, `qualidade_dados='PENDENTE_CONFERENCIA'` e
  gera `codigo` oficial no formato `REC-AAAA-NNNNNN` conforme ano
  de referência do recebimento/instante.
- **NÃO** preenche `pedido_compra`, `tipo_recebimento_id`,
  `recebido_em`, itens, anexos nem outros detalhes que não estavam na CHG.
  `fornecedor_id` só vem preenchido se a CHG tiver esse campo.
- **Decisão ainda aberta:** como `recebido_em` inicialmente é NULL, o
  trigger gera o ano do código REC a partir do relógio em
  `America/Sao_Paulo`. Preencher `recebido_em` depois **não renumera**
  o REC. Se o contrato exigir código no ano de uma chegada antiga,
  aprovar antes uma alteração específica; não corrigir o código manualmente.
- Atualiza CHG para `status='VINCULADA'`, define
  `recebimento_id`, `vinculada_em`, `vinculada_por` e `alterado_por`.
- Retorna `reutilizado=false`.

**Retry / idempotência:** se a CHG já referencia REC **ativo**, retorna
o mesmo `recebimento_id` e `codigo` com `reutilizado=true`, sem
fazer novo INSERT. Se o REC associado está excluído, rejeita.
A unicidade no banco é reforçada por
`uq_chegadas_recebimento` (índice parcial único de `recebimento_id`
não nulo) e pelo lock da CHG. A função **não** compara payloads de
pedido/tipo/fornecedor; isso cabe ao contrato da API.

**Exceções da função:** mensagens atuais incluem
`Defina somente app.usuario_id para criar REC a partir de CHG`,
`app.usuario_id invalido`, `Usuario autenticado inexistente ou inativo`,
`CHG inexistente: ...`,
`CHG excluida nao pode gerar recebimento`,
`REC vinculado a CHG nao esta ativo`,
`Somente CHG REGISTRADA pode gerar recebimento`.
São exceções PostgreSQL, **não** códigos HTTP implementados.
Além delas podem ocorrer violações de FK/CHECK/permissão; o backend
deve mapear erros sem devolver detalhes internos desnecessários.

## 2. Preencher pedido, tipo e fornecedor na **mesma transação**

**Proposta de integração sem nova migration**, a testar pelo responsável
do backend. Não é fluxo E2E já homologado:

1. Validar a sessão humana e a autorização de criação de REC.
2. Abrir uma única transação numa conexão PostgreSQL do backend.
3. `SET LOCAL ROLE alm_api`, atribuir `app.usuario_id` (UUID
   **da sessão verificada pelo servidor**) e `app.request_id` via
   `set_config(..., true)`.
4. Chamar `SELECT * FROM alm.criar_recebimento_da_chegada($1::uuid)`.
5. **Somente se `reutilizado=false`**, atualizar esse
   `alm.recebimentos.id` enquanto `status='EM_DIGITACAO'` com:
   `pedido_compra`, `tipo_recebimento_id` e, se aplicável,
   `fornecedor_id`. Guardar o `id` da CHG ligado ao REC, não um ID
   fornecido pelo navegador. Validar o tipo pela FK de
   `alm.tipos_recebimento`, e o fornecedor pela FK de
   `alm.fornecedores`.
6. `COMMIT` apenas quando função + atualização tiverem êxito;
   em erro, `ROLLBACK` reverte **ambos** os passos.
7. **Se `reutilizado=true`**, não fazer UPDATE automático.
   Reconsultar o REC e devolver o resultado anterior. Se o cliente
   repetir a operação com dados divergentes, definir rejeição por
   conflito (ex.: HTTP 409) **após aprovação da regra pela equipe**.
   Não mudar silenciosamente pedido/tipo/fornecedor num retry.

Exemplo **esquemático** (`$1` etc. são placeholders do driver,
não um script a executar no SQL Editor):

```sql
BEGIN;
SET LOCAL ROLE alm_api;
SELECT set_config('app.usuario_id', $1, true);
SELECT set_config('app.request_id', $2, true);
SELECT * FROM alm.criar_recebimento_da_chegada($3::uuid);
-- Na aplicação, conferir "reutilizado". Só para false:
UPDATE alm.recebimentos
   SET pedido_compra = $4,
       tipo_recebimento_id = $5::smallint,
       fornecedor_id = COALESCE($6::uuid, fornecedor_id),
       alterado_por = $1::uuid
 WHERE id = $recebimento_id
   AND status = 'EM_DIGITACAO'
   AND excluido_em IS NULL
   AND ($6::uuid IS NULL OR fornecedor_id IS NULL OR fornecedor_id = $6::uuid);
-- Confirmar exatamente 1 linha afetada; se não, ROLLBACK.
COMMIT;
```

A linha `$recebimento_id` é **pseudocódigo**, não parâmetro do protocolo
PostgreSQL: usar o UUID retornado na aplicação e bindá-lo como parâmetro
posicional real. `fornecedor_id` não deve ser sobrescrito se a CHG já
possui outro fornecedor sem **decisão explícita**: confirmar essa
consistência antes do UPDATE. Se dados obrigatórios não chegaram,
o REC pode continuar como rascunho, sujeito às constraints existentes.

Não fazer upload ao Google Drive enquanto o lock/transação fica aberto.

### REC manual, sem CHG

O backend pode inserir `alm.recebimentos` diretamente, após validar
sessão/autorização e configurar `app.usuario_id` na transação. Usar
`origem='OPERACIONAL'`, `responsavel_id`, `criado_por`,
`alterado_por`; preencher pedido/tipo/fornecedor quando disponíveis.
**Não** enviar `codigo`: é exclusivo do trigger do banco. O `id`
UUID é gerado no PostgreSQL. Nenhuma CHG é criada/vinculada nessa via.

No status `EM_DIGITACAO`, pedido/tipo/NF/data ainda podem estar ausentes;
antes de avançar para outro status, o banco exige os campos do fluxo
operacional descritos em `alm.recebimentos` e suas constraints.

## 3. Scanner → `alm.chegadas_portaria`

O schema aceita **apenas** os seguintes valores:

| Campo | Valor SQL | Origem verificável no scanner |
|---|---|---|
| `metodo_leitura` | `PDF_TEXTO` | Chave encontrada no texto selecionável do PDF |
| `metodo_leitura` | `ZBAR` | Decoder ZBar identificado como vencedor |
| `metodo_leitura` | `ZXING` | Decoder ZXing identificado como vencedor |
| `metodo_leitura` | `NATIVO` | `BarcodeDetector` nativo identificado como vencedor |
| `metodo_leitura` | `OCR` | Chave reconhecida por OCR |
| `metodo_leitura` | `MANUAL` | Registro informado manualmente, sem detecção |
| `confianca` | `ALTA`, `MEDIA`, `BAIXA`, `MANUAL` | Aceita NULL; **não** aceita `CONFERIR` ou `NAO_ENCONTRADO` |

**Diferença comprovada do frontend atual:** `analysisBuilder.js`
produz confidência **por campo** com valores
`alta`, `conferir`, `baixa`, `nao_encontrado`.
`origensChave` em `extractor.js` pode ser `texto do PDF`,
`código de barras` ou `OCR`; o caminho de barcode
`runBarcodeThenOcr` atualmente **agrega ZBar, ZXing e nativo**
na origem pública `código de barras`.

Logo, **não inferir `ZBAR`/`ZXING`/`NATIVO` a partir da string
`código de barras`**. Um mapeamento fiel exige metadado estruturado
de qual decoder venceu, fornecido pelo scanner/frontend, ou decisão
da equipe sobre um novo valor genérico por migration futura.
Nenhum frontend foi alterado.

**Sugestão pendente de aprovação**, NÃO regra atualmente definida:
para confidência por campo, `alta → ALTA`,
`conferir → MEDIA`, `baixa → BAIXA`;
`nao_encontrado` sem confiança SQL (NULL);
entrada manual confirmada → `MANUAL`.
**A equipe deve distinguir confiança global da leitura CHG da confiança
de cada campo:** não copiar arbitrariamente o nível de qualquer campo
para `chegadas_portaria.confianca`. O backend precisa validar enum SQL.

**Identificação mínima de CHG:** `nfe_chave_acesso` com exatamente
44 dígitos, **ou** (`numero_nf` não vazio + `cnpj_emitente` de
14 dígitos). `metodo_leitura` é obrigatório; `criado_por` e
`alterado_por` devem referenciar um usuário válido. `status`
inicial = `REGISTRADA`, salvo regra explícita diferente.

## 4. Duplicidade de NF-e na Portaria: decisão em aberto

`uq_chegadas_chave_ativa` impõe **uma única CHG não cancelada e não
excluída por `nfe_chave_acesso`**. Engloba CHG `REGISTRADA` e
`VINCULADA`; uma segunda tentativa de INSERT com a mesma chave ativa
causa violação de unicidade (SQLSTATE usual `23505`).
CHG `CANCELADA` ou logicamente excluída não participa do índice.

**Isso é diferente** da idempotência de converter *a mesma CHG* em REC:
a função `alm.criar_recebimento_da_chegada` evita dois REC para a
mesma CHG, mas **não** resolve uma nova CHG com a mesma NF-e.

**Proposta até alinhamento funcional:** tratar segunda chave como
conflito, consultar a CHG existente e orientar o usuário; **não**
criar uma segunda CHG, nem vincular/editar automaticamente uma
anterior. A equipe precisa decidir se a mesma NF-e poderá chegar
em entregas parciais distintas e qual identificador de ocorrência
permitiria isso; qualquer flexibilização do índice exige
nova migration proposta e aprovada.

## 5. O que precisa ser validado em integração

- Rollback de CHG→REC+pedido/tipo/fornecedor quando UPDATE falha.
- Retry igual devolve o mesmo REC, sem alterar dados nem incrementar
  indevidamente o vínculo.
- Retry divergente devolve conflito definido pela API (regra pendente).
- CHG inexistente, excluída, cancelada, REC excluído, permissão humana negada.
- Duas conexões disputando mesma CHG e duas CHGs disputando mesma NF-e.
- REC manual sem CHG, com código criado somente pelo banco.
- Scanner com texto PDF/OCR/decoders e fallback manual sem método inventado.
- Transição de rascunho para conferência com validação completa.

**Fontes no repositório:** `supabase/migrations/20261015010000_alm_chg_rec_atomico.sql`,
`supabase/migrations/20261007160100_alm2_delta.sql`,
`supabase/migrations/20261007160000_alm_v1_base.sql`,
`src/features/nfeReader/{analysisBuilder,extractor}.js`.
