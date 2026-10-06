# 04 — Dados, auditoria e busca

**Donos:** Kobner (schema, roles, migrations) e Goran (camada de acesso, serviços, API)

## 1. O que se reaproveita e o que o delta cria

O modelo de dados **é o da v1** (`ARQUITETURA_TECNICA_ALM.md` §2 e §3). Esta revisão só acrescenta o que a v1 não tem. Tudo o que muda está em [`sql/001_alm2_delta.sql`](sql/001_alm2_delta.sql) (sintaxe validada no parser real do Postgres; **não executado**).

| Item do delta | Para quê | Decisão |
|---|---|---|
| `alm.papeis`, `alm.usuario_papeis` | Perfil funcional + papéis superiores aditivos, sem `DELETE` (revogar = `revogado_em`) | D05 |
| `alm.usuarios`: `matricula`, `cargo`, `setor`, `legado`; `oidc_*` e `email` opcionais; sai `ultimo_login_em`; perfil ganha `PORTARIA` | Identidade por matrícula | D03 |
| `alm.credenciais_pin`, `alm.sessoes`, `alm.eventos_autenticacao` | PIN (hash + pepper), bloqueio, sessões, trilha de login | D03/D04/D08 |
| `alm.auditar_credencial()` | Audita troca de PIN **sem** o hash | D08 |
| `alm.auditar_mutacao()` (recriada) | Mesma lógica da v1, sem colunas derivadas no antes/depois | D08 |
| `alm.recebimentos`: `nfe_chave_acesso`, `codigo_legado` | Chave NF-e e compatibilidade com o protocolo antigo | D06 |
| `alm.chegadas_portaria` (+ sequência `seq_chegada`) | Entidade da Portaria | D15 |
| `alm.arquivos`: `armazenamento_estado`, `quarentena_em`, `purga_prevista_em`, `purgado_em`, `purgado_por` | Estado **físico** do byte, separado da exclusão **lógica** | D07/D09 |
| `alm.bloquear_mutacao_filho_finalizado()` (recriada) | Libera as colunas físicas novas para o job (ver parte 02, aresta e) | D09 |
| `alm.outbox`, `alm.espelho_sheets` | Fila transacional e estado do espelho | D10/D11 |
| `alm.filtros_salvos`, `alm.exportacoes` | Filtros do usuário e log de exportações | D14 |
| Grants, `REVOKE` para `anon`/`authenticated`, RLS em todo o schema | Segundo muro | D02 |

**Ordem das migrations** (Supabase CLI, pasta `supabase/migrations/`): `…_alm_v1_schema.sql` (extraída dos blocos `sql` da v1; tarefa do Kobner) → `…_alm2_delta.sql`. O delta assume a v1 aplicada.

## 2. Acesso ao banco (D02)

### 2.1 Princípios

- **Só o backend conecta.** O schema `alm` **não** entra nas "Exposed schemas" da Data API do Supabase; o `public` fica vazio. O navegador nunca recebe chave nem URL do Supabase.
- **Driver Postgres, não cliente REST.** O `supabase-js` fala com a API REST (PostgREST), que executa **um comando por requisição**; não há como abrir `BEGIN … COMMIT` com vários comandos pelo cliente. Como cada mutação precisa gravar dado + auditoria + outbox atomicamente, usa-se o driver `pg` com conexão direta ao Postgres. A alternativa seria empacotar cada mutação numa função PL/pgSQL chamada por RPC (uma chamada = uma transação); funciona, mas empurra a regra de negócio para o banco, o oposto do que o Goran já construiu em JavaScript. (Raciocínio sobre o comportamento do PostgREST; a documentação do Supabase não foi consultada para este ponto: **[A VERIFICAR no S1]**.)
- **Conexão pelo pooler transacional** (porta 6543). Para funções serverless o Supabase recomenda o *transaction pooler*, que é **IPv4**; a conexão direta é **IPv6** (IPv4 só com add-on pago) `[DOC-OFICIAL]`. Nesse modo **prepared statements nomeados não funcionam** e estado de sessão não persiste entre transações; transações normais funcionam `[DOC-OFICIAL]`. Consequências: não usar `name:` nas queries do `pg`; todo `set_config` deve ser `is_local = true`.
- **Duas roles de login técnico**, membros das roles `NOLOGIN` da v1: `alm_api_app` ∈ `alm_api` e `alm_job_app` ∈ `alm_job`. URLs em variáveis de ambiente (`DATABASE_URL_API`, `DATABASE_URL_JOB`). **[A VERIFICAR no S1]** que o pooler aceita logins personalizados nesse formato.
- **Timeouts na role:** `statement_timeout`, `lock_timeout` e `idle_in_transaction_session_timeout` definidos por `ALTER ROLE … SET`, menores que a duração máxima da função (padrão 300 s na Vercel `[DOC-OFICIAL]`).
- **Pool pequeno por instância** (ex.: `max: 3`). A Vercel com Fluid compute pode atender requisições concorrentes na mesma instância; ajustar no S1/S5.

### 2.2 Uma transação por mutação

```js
// backend/db/tx.mjs  (a criar)
export async function withActor(pool, ator, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Os triggers da v1 exigem EXATAMENTE um ator: usuario_id OU ator_sistema.
    await client.query(
      `SELECT set_config('app.usuario_id',   $1, true),
              set_config('app.ator_sistema', $2, true),
              set_config('app.request_id',   $3, true),
              set_config('app.ip',           $4, true),
              set_config('app.user_agent',   $5, true)`,
      [ator.usuarioId ?? '', ator.sistema ?? '', ator.requestId, ator.ip ?? '', ator.userAgent ?? ''],
    )
    const resultado = await fn(client)
    await client.query('COMMIT')
    return resultado
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {})
    throw erro
  } finally {
    client.release()
  }
}
```

Regras:

1. **Nenhuma chamada externa (Drive, Sheets) dentro da transação** (v1 §7). Efeito externo = linha em `alm.outbox` **na mesma transação**.
2. `SELECT … FOR UPDATE` no recebimento antes de mexer em filhos ou status (v1).
3. Cada mutação define **um** ator. Login não grava em tabela auditada (por isso o contador saiu de `usuarios`).
4. Jobs usam `ator.sistema` (ex.: `'job:sheets-espelho'`).

### 2.3 Erros do banco → erros da API

| Origem no Postgres | HTTP | Código |
|---|---|---|
| `23505` violação de unicidade | 409 | `CONFLICT` (com `details.constraint`) |
| `23503` chave estrangeira | 422 | `VALIDATION_ERROR` |
| `23514` `CHECK` | 422 | `VALIDATION_ERROR` |
| `P0001` `RAISE EXCEPTION` dos triggers (ex.: "Reabra o recebimento…") | 422 | `BUSINESS_RULE` (mensagem do trigger, já em português) |
| Timeout de statement/lock | 503 | `DB_TIMEOUT` |
| Falha de conexão | 503 | `DB_UNAVAILABLE` |

## 3. Código do recebimento (D06)

**O que a v1 faz e não pode ser contornado:** a trigger `preparar_recebimento` **recusa um `codigo` informado** (`'codigo e gerado exclusivamente pelo banco'`) e o gera por `alm.proximo_codigo_recebimento(ano)`, com o ano de `recebido_em` no fuso `America/Sao_Paulo`. É um upsert atômico no numerador anual, que **elimina a corrida** do `max + 1` atual `[CÓDIGO]`.

- Formato: `REC-AAAA-NNNNNN` (6 dígitos, limite 999.999 por ano).
- **Legado.** Os códigos atuais (`REC-2026-0012`, 4 dígitos) não podem ser inseridos como estão. Procedimento: importar **em ordem crescente do número legado dentro de cada ano**; se não houver lacunas, o numerador reproduz os mesmos números (`REC-2026-0012` → `REC-2026-000012`). O texto original vai em `codigo_legado` (único). O importador **lista** os casos em que o número novo difere do legado; nesses, a identidade continua preservada por `codigo_legado`.
- **API:** `GET /recebimentos/:id` aceita `uuid`, `codigo` ou `codigo_legado`. A resposta traz `id` (uuid), `codigo`, `codigo_legado`, `protocolo` (**alias de `codigo`**, para o frontend não quebrar) e `versao`.
- **Rotas do frontend** (`#/recebimentos/REC-2026-0012`) continuam resolvendo pelo legado; links novos usam `codigo`.
- **Drive:** arquivos já gravados com o protocolo antigo no nome (`REC-2026-0017_0001_…`) mantêm o nome físico; é cosmético, a identidade é o ID do objeto (v1 §6).
- **Nunca** gerar código no cliente nem no backend com `max + 1`.

## 4. Exclusão lógica única (D07)

Hoje existem quatro mecanismos (`arquivado` no recebimento, `removido` no anexo, remoção física do item, `files.delete` no Drive). A v1 já define **um**: `excluido_em`, `excluido_por`, `motivo_exclusao`, com motivo obrigatório. A revisão adota esse e:

- `arquivado`/`arquivadoEm`/`arquivadoPor`/`restauradoEm` do Sheets → `excluido_*` (motivo `"Arquivado (migrado do Sheets)"`). Não há coluna `arquivado_*` no Postgres: o conceito foi absorvido, e "arquivar" deixa de existir como evento próprio.
- Endpoints atuais `POST /recebimentos/:id/arquivar` e `.../restaurar` viram **alias** de `DELETE /recebimentos/:id` (motivo obrigatório; padrão `"Arquivado pelo usuário"` só na transição) e `POST .../restaurar`.
- **Padrão das consultas:** `excluido_em IS NULL`. Centralizar em **um** helper do repositório (`apenasAtivos()`), com teste que prova que nenhuma listagem devolve excluído. Índices parciais da v1 já usam esse predicado.
- **Restaurar** zera os três campos juntos (`CHECK` da v1/delta exige tudo-ou-nada). O trigger de auditoria registra `ALTERACAO` com `excluido_em` em `campos_alterados`; a tela rotula como "Restaurado".
- **Tela "Excluídos"** (`excluidos.read`): tipo, quem excluiu, quando, motivo, e para arquivos o estado físico e o prazo de purga.
- **Compatibilidade crítica:** o frontend atual **sempre** envia `includeArchived: true` ao carregar a lista. Com a regra nova, isso exigiria `excluidos.read`. Na transição o backend **ignora** o parâmetro para quem não tem a permissão (em vez de `403`), e o frontend para de enviá-lo.
- Item: exclusão lógica (hoje é física). Divergência: `CANCELADA` + exclusão lógica (v1).

## 5. Concorrência (D20)

A v1 define `versao` em cada linha e ETag = `versao` do **recebimento**; qualquer mudança em item, arquivo ou divergência incrementa a versão do pai por trigger.

- Todo payload de recebimento devolve `versao`.
- `PATCH`/`DELETE`/`POST` de mutação em recebimento ou filho exigem `If-Match: "<versao>"`.
- Conflito → `409 VERSION_CONFLICT` com a `versao` atual em `details`. O frontend recarrega o registro e mostra "Este recebimento foi alterado por outra pessoa" em vez de sobrescrever (parte 06).
- **Transição:** flag `REQUIRE_IF_MATCH` (desligada em staging até o frontend enviar o header; ligada em produção desde o início).
- A fila de mutações por recebimento do navegador (`apiMutationQueues`) continua útil para a mesma aba, mas **não substitui** a versão: outras abas e outros usuários não passam por ela.

## 6. Auditoria (D08)

### 6.1 Camadas

| Camada | Tabela | Quem grava | O que registra | Quem lê |
|---|---|---|---|---|
| Mutação de dado | `alm.historico_alteracoes` | **Trigger** `auditar_mutacao` (vale para qualquer escrita, inclusive SQL manual) | antes, depois, `campos_alterados`, ator, request, IP, user-agent | `auditoria.read` (IP/UA: `auditoria.tecnica`) |
| Workflow de status | `alm.recebimento_status_historico` | Trigger | de → para, observação, ator | quem vê o recebimento |
| Acesso a arquivo | `alm.arquivo_acessos` | API, ao fim do stream | preview/download, resultado, bytes | `auditoria.read` |
| Autenticação | `alm.eventos_autenticacao` | Módulo de auth | login ok/falha, bloqueio, reset, logout, sessão revogada | `auditoria.tecnica` |
| Exportação | `alm.exportacoes` | API | quem, formato, filtros, total de linhas | `auditoria.read` |
| Integração | `alm.outbox`, `alm.espelho_sheets` | Jobs | sincronizações, falhas, quarentena, purga | `integracoes.read` |
| Troca de PIN | `alm.historico_alteracoes` | Trigger `auditar_credencial` | quando, por quem, temporário ou não. **Sem hash** | `auditoria.read` |

Todas as tabelas de auditoria são **append-only** (trigger `impedir_mutacao_historico` + sem `UPDATE`/`DELETE` para a role da API).

### 6.2 Por que trigger, e não gravação pela aplicação

A especificação do ChatGPT gravaria `audit_events` no código da aplicação. Um `if` esquecido, um novo endpoint ou um script de manutenção deixam um buraco. O trigger cobre **toda** escrita. Limite: quem tem poder de DBA pode desabilitar triggers; mitigação da v1 §8: acesso técnico restrito e exportação periódica para um log central.

### 6.3 Duas armadilhas que a v1 não previa (corrigidas no delta)

1. **O trigger genérico vazaria segredos.** `auditar_mutacao()` copia a linha inteira. Em `credenciais_pin` ou `sessoes` isso colocaria `pin_hash` e `token_hash` na auditoria. Por isso essas tabelas **não** recebem o trigger genérico; `credenciais_pin` tem `auditar_credencial()`, que registra só o fato e os metadados.
2. **Colunas derivadas inflavam a auditoria.** O snapshot incluía `busca_fts` (tsvector) e as colunas `*_busca`. O delta recria a função removendo essas chaves.

### 6.4 Pergunta → onde achar

| Pergunta | Fonte |
|---|---|
| Quem alterou a NF e qual era o valor? | `historico_alteracoes` (`entidade='alm.recebimentos'`, `campos_alterados` contém `numero_nf`) |
| Quem apagou esta foto, quando e por quê? | `historico_alteracoes` (`alm.arquivos`, ação `EXCLUSAO_LOGICA`, `motivo_exclusao`) |
| O arquivo ainda existe no Drive? | `arquivos.armazenamento_estado` e `quarentena_em`/`purgado_em` |
| Quem purgou definitivamente? | `arquivos.purgado_por` + linha de auditoria da mudança |
| Quem baixou ou visualizou este documento? | `arquivo_acessos` |
| Quando este usuário virou gerente? | `historico_alteracoes` (`alm.usuario_papeis`) |
| Quem exportou 142 recebimentos e com que filtro? | `exportacoes` |
| Quem errou o PIN 10 vezes? | `eventos_autenticacao` |
| A planilha está desatualizada? | `espelho_sheets.ultima_sincronizacao_em` e `outbox` |

### 6.5 "Auditoria do que foi excluído do Drive e do Sheets" (pedido do Lucas)

- **Drive, pelo ALM:** coberto por completo. A exclusão lógica é auditada; a mudança de estado físico (quarentena, restauração, purga) também, porque `arquivos` tem o trigger.
- **Sheets:** é **derivado**. "Apagar uma linha" equivale a excluir o recebimento no ALM, que já é auditado; o espelho só reflete no próximo snapshot. Não faz sentido auditar o espelho em si.
- **Fora do ALM (alguém apaga direto no Drive ou edita a planilha):** **não dá para garantir autoria.** O que se consegue: reconciliação detecta o objeto ausente e registra o evento sem autor. Descobrir quem foi exige o log de auditoria do Google Workspace ou a API Drive Activity **[A VERIFICAR]**; a defesa real é permissão: pessoas como **Leitor**, só a identidade do ALM escreve (parte 05).

### 6.6 Retenção e tamanho `[ESTIMATIVA]`

- Auditoria cresce sempre. Premissa: 15 a 30 linhas por recebimento (criação, itens, anexos, status, divergências), cada uma com antes/depois de 1 a 2 KB sem derivados, mais índices: da ordem de **25 a 40 KB por recebimento**. Com isso o limite de 500 MB do plano Free acabaria em ~12 a 20 mil recebimentos; o Pro (8 GB) comporta centenas de milhares. **Medir** com o teste de carga da v1 (100 mil recebimentos sintéticos).
- Retenção em anos: Q11. Particionar `historico_alteracoes` só quando chegar a dezenas de milhões de linhas (v1 §14).
- LGPD: IP e user-agent são dado pessoal; acesso só `auditoria.tecnica`.

## 7. Pesquisa e filtros salvos (D14)

### 7.1 Base já definida na v1

- Colunas normalizadas por trigger (`lower(unaccent())`), índices GIN com `pg_trgm` e `tsvector`, busca ranqueada, autocomplete, paginação por cursor, metas de latência (v1 §4, §5, §10 `/search`). **Isso já resolve** "pesquisar sem acento, com maiúscula ou minúscula": `ÁGUIA`, `Aguia` e `aguia` são o mesmo termo.
- O frontend atual já normaliza no cliente; a regra passa para o servidor (parte 06).

### 7.2 O que a busca precisa cobrir (lista do Lucas)

| Critério | Campo | Observação |
|---|---|---|
| Código do recebimento | `codigo`, `codigo_legado` | exato/prefixo |
| Pedido | `pedido_compra` | normalizado |
| Nota fiscal | `numero_nf`, `serie_nf` | normalizado |
| **Chave NF-e (44 dígitos)** | `nfe_chave_acesso` | se a consulta tem 44 dígitos, **igualdade** no índice parcial; é o caminho do scanner |
| Empresa/fornecedor | `fornecedor_nome_snapshot`, `fornecedor_cnpj_snapshot` | trigram; CNPJ só dígitos |
| Material | `codigo_produto`, `descricao` dos itens | trigram + FTS |
| Responsável | nome e matrícula do usuário | |
| Status | `status` | lista |
| Datas | `recebido_em` | de/até, "últimos N dias" |
| Com/sem divergência aberta; com/sem anexo; NF pendente | derivados | filtros booleanos |
| Origem | `chegadas_portaria` × recebimento | Portaria x Almoxarifado |
| Excluídos | `excluido_em` | só com `excluidos.read` |

### 7.3 Filtros estruturados (allowlist)

O cliente **nunca** manda SQL nem nome de coluna livre. Manda uma definição declarativa; o servidor valida contra um catálogo fechado e compila para SQL parametrizado.

| Tipo do campo | Operadores permitidos |
|---|---|
| texto | `igual`, `diferente`, `contem`, `nao_contem`, `vazio`, `nao_vazio` |
| lista (status, tipo) | `em`, `nao_em` |
| data | `antes`, `depois`, `entre`, `ultimos_dias` |
| número | `igual`, `maior`, `menor`, `entre` |
| booleano | `verdadeiro`, `falso` |

Definição de filtro (também é o formato salvo em `alm.filtros_salvos.definicao`):

```json
{
  "versao": 1,
  "q": "aguia",
  "filtros": [
    { "campo": "fornecedor", "op": "contem", "valor": "ABC" },
    { "campo": "status", "op": "nao_em", "valor": ["CONFERIDO_FINALIZADO"] },
    { "campo": "recebido_em", "op": "ultimos_dias", "valor": 30 }
  ],
  "ordenacao": { "campo": "recebido_em", "direcao": "desc" }
}
```

Limites: no máximo 10 condições; `q` com no mínimo 2 caracteres; ordenação só por campos da allowlist; timeout e rate limit por rota; total de linhas calculado só quando pedido.

### 7.4 Filtros salvos

- **`PRIVADO`:** só o dono. **`GLOBAL`:** exige `filtros.global`; aparece para todos.
- Nome único por dono e módulo (índice `uq_filtros_nome_dono`).
- Exclusão lógica e auditoria como o resto.
- Pré-cadastrar como `GLOBAL`: "Entradas de hoje", "NF pendente", "Divergências abertas", "Meus rascunhos".
- Versão do formato (`versao`) permite evoluir sem quebrar filtros antigos.

### 7.5 Estado na URL

`#/recebimentos?q=aguia&status=EM_CONFERENCIA&de=2026-09-01` para o link ser compartilhável e o botão Voltar funcionar (parte 06).

## 8. Contrato da API (D20)

### 8.1 O que se preserva

As rotas atuais (`/api/v1/recebimentos`, `/itens`, `/anexos`, `/divergencias`, `/status`, `/historico`, `/dashboard`, `/catalogos`, `/usuarios`, `/auth/me`), os nomes de campo em camelCase e o erro `{ "error": { "code", "message", "details" } }`. **Motivo:** o frontend inteiro depende disso, e `apiRequest` já monta a mensagem a partir desse formato. O desenho REST da v1 (snake_case, `application/problem+json`, `/transicoes`) fica superado nesses pontos.

### 8.2 O que se acrescenta

- `versao` nos recebimentos e `If-Match` nas mutações (seção 5).
- `codigo`, `codigo_legado` e `protocolo` (alias) (seção 3).
- Header `X-Request-Id` na resposta e `requestId` no corpo de erro, igual ao `app.request_id` do banco.
- Paginação por **cursor** (`cursor`, `limit`) ao lado de `page`/`pageSize`, que continuam funcionando.
- `GET /dashboard` passa a ser a fonte do dashboard (hoje o cliente recalcula tudo e ninguém chama esse endpoint).
- Contrato publicado em OpenAPI (`docs/openapi.yaml`, a criar, dono Goran; Marcelo valida no CI).

### 8.3 Endpoints novos ou alterados

| Rota | Finalidade | Permissão |
|---|---|---|
| `POST /auth/login`, `/logout`, `/trocar-pin`, `/ping`; `GET /auth/me` | Autenticação (parte 03) | — / sessão |
| `POST /usuarios/:id/resetar-pin`, `/bloquear`, `/desbloquear`, `/revogar-sessoes`, `/papeis` | Gestão de acesso | ver parte 03 |
| `DELETE /recebimentos/:id` (motivo) e `POST /recebimentos/:id/restaurar` | Exclusão lógica; `arquivar`/`restaurar` antigos viram alias | `recebimentos.delete` / `.restore` |
| `DELETE /recebimentos/:id/anexos/:anexoId` (motivo **obrigatório**) | Exclusão lógica + quarentena | `anexos.delete` |
| `POST /recebimentos/:id/anexos/:anexoId/restaurar` | Sai da quarentena | `anexos.restore` |
| `POST /recebimentos/:id/anexos/:anexoId/purgar` | Purga definitiva, após a retenção | `anexos.purge` |
| `GET /excluidos?tipo=` | Tela de excluídos | `excluidos.read` |
| `GET /auditoria`, `GET /auditoria/:id` | Auditoria funcional | `auditoria.read` |
| `GET/POST/PATCH/DELETE /filtros` | Filtros salvos | autenticado; global: `filtros.global` |
| `POST /exportacoes`, `GET /exportacoes/:id` | Exportação CSV ou Google Sheets | `recebimentos.export` |
| `GET /portaria/chegadas`, `POST /portaria/chegadas`, `POST /portaria/chegadas/:id/vincular`, `POST /portaria/chegadas/:id/cancelar`, `GET /portaria/identificar?chave=` | Portaria | `portaria.*` |
| `GET /integracoes/estado`, `POST /integracoes/espelho/sincronizar` | Painel de sincronização | `integracoes.read` / `.manage` |
| `GET /health/live`, `GET /health/ready` | Saúde (sem dados internos) | infra |

### 8.4 Códigos de erro novos

Mantêm o padrão (inglês em caixa alta, mensagem em português): `INVALID_CREDENTIALS`, `TOO_MANY_ATTEMPTS`, `SESSION_EXPIRED`, `PIN_CHANGE_REQUIRED`, `WEAK_PIN`, `VERSION_CONFLICT`, `BUSINESS_RULE`, `CONFLICT`, `DB_TIMEOUT`, `DB_UNAVAILABLE`, `ARRIVAL_DUPLICATE`, `ARRIVAL_NOT_FOUND`, `FILE_IN_QUARANTINE`, `RETENTION_NOT_ELAPSED`, `EXPORT_TOO_LARGE`, `FILTER_INVALID`. O `errorMessages.js` do frontend ganha uma entrada por código (parte 06).

## 9. Fontes verificadas em 06/10/2026

- Conexão com Postgres, pooler, IPv4/IPv6, limitações do modo transacional: https://supabase.com/docs/guides/database/connecting-to-postgres
- Duração máxima de função na Vercel: https://vercel.com/docs/functions/limitations
- Todo o restante desta parte vem do código e do `ARQUITETURA_TECNICA_ALM.md` (conferido linha a linha onde citado).
- **A verificar (S1):** transação com vários comandos via PostgREST; login técnico personalizado pelo pooler; uso de `set_config(..., true)` e queries não nomeadas pelo pooler.
