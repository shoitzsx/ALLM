# 05 — Arquivos (Drive), Sheets e jobs

**Dono:** Goran · **Testes de falha:** Marcelo · **UI:** Lucas

## 1. Google Drive

### 1.1 Papel (D09)

O Drive guarda **bytes**. O banco decide identidade, permissão, estado lógico (excluído ou não) e estado físico (ativo, em quarentena, purgado). O cliente nunca recebe `fileId`, pasta ou URL do Drive; isso já é verdade hoje (`attachmentResponse` remove `storageKey`) e continua.

### 1.2 Decisão de identidade (depende de Q1)

| | **A) Shared Drive + service account** (v1 §6) | **B) Conta Google corporativa dedicada + OAuth** (como hoje) |
|---|---|---|
| Pré-requisito | **Google Workspace.** Shared Drive é recurso do Workspace `[DOC-OFICIAL]` (a página oficial os descreve assim; não confirmei texto explícito sobre contas pessoais; confirmar com o administrador) | Uma conta Google da empresa, **não** de uma pessoa |
| Credencial | Identidade do serviço, sem refresh token | Refresh token |
| Risco de expirar | Baixo | **Alto se o app estiver em modo "Testing"**: o token expira em **7 dias**. Também expira após 6 meses sem uso e há limite de 100 tokens por conta/cliente `[DOC-OFICIAL]`. **Status atual do app: [A VERIFICAR]** |
| Quem apaga de vez | A identidade do ALM é `fileOrganizer` e **não** consegue excluir definitivamente: isso exige `organizer` `[DOC-OFICIAL]`. A purga é feita por outra identidade, de propósito | A conta é dona dos arquivos e pode apagar: a restrição vira regra de código e auditoria |
| Marcadores de recuperação | `properties` (visíveis a todas as identidades) | `appProperties` (privadas ao app) |
| Dependência de pessoa | Não | Precisa de dono responsável, MFA e cofre |

**Recomendação:** A, se Q1 for "sim". Enquanto Q1 não for respondida, seguir em B com estas salvaguardas: publicar o consent screen em produção, conta dedicada com MFA, **job diário de saúde** (`about.get`) que alerta se o token deixou de funcionar, token guardado só no cofre da Vercel.

**Marcadores:** hoje o código grava `appProperties.almReceiptId` com o **protocolo**. Em qualquer migração para outra identidade os objetos precisam ser **re-marcados** (`properties` com UUIDs, nunca nome de pessoa, NF ou fornecedor): `almEnv`, `almContainerKey`, `almRecebimentoId`, `almArquivoId`, `almSha256`.

### 1.3 Limite de tamanho e download (Q12)

- Hoje: **4 MiB**. A causa não é o upload (vai direto do navegador ao Drive) e sim o **download** passar pela função: o corpo de resposta tem teto de **4,5 MB** na Vercel `[DOC-OFICIAL]`.
- A Vercel diz que **respostas em streaming não têm esse limite** `[DOC-OFICIAL]`. Hoje o download carrega o arquivo inteiro num `Buffer` (`files.get` com `arraybuffer`), então o limite se aplica. **Spike S3:** servir ≥ 20 MB em streaming com `Range`. Se passar, subir o limite para 20 MiB em imagens (valor da v1) e decidir o de PDF (v1 prevê 50 MiB).
- Do lado do cliente (v1 §7): corrigir orientação, **remover GPS/EXIF** e comprimir fotos antes de enviar. Isso reduz o tamanho e protege dado pessoal.

### 1.4 Upload com confirmação

O upload direto navegador → Drive **continua**; é o que impede o binário de passar pela função. A v1 queria o arquivo passando pela API para calcular hash e rodar antivírus; isso é incompatível com a Vercel (4,5 MB de corpo de requisição `[DOC-OFICIAL]`). A solução é **verificar depois do upload**:

```
Navegador                  API ALM                              Drive              Postgres
 | 1 POST upload-sessions --> valida permissão, Origin, tipo, tamanho
 |                            INSERT arquivos (PENDENTE, idempotency_key) ---------------> tx A
 |                            cria sessão resumível com properties {almArquivoId, ...}
 |<-- sessionUrl + arquivoId
 | 2 PUT em fatias, direto ------------------------------------> Drive
 |<------------------------------------------------ 200/201 {id}
 | 3 POST anexos {arquivoId, fileId} -->
 |                            files.get(id, fields: size, mimeType, sha256Checksum,
 |                                      parents, properties)
 |                            confere pasta, properties e tamanho == declarado
 |                            lê os primeiros bytes (Range) -> assinatura x allowlist
 |                            UPDATE arquivos -> DISPONIVEL + sha256 + mime detectado ---> tx B
 |<-- 201 anexo (sem fileId)
```

- O Drive expõe `sha256Checksum` nos metadados de arquivos com conteúdo `[DOC-OFICIAL]`, então não é preciso baixar o arquivo para ter o hash. **S4** confirma que o campo vem preenchido logo após o upload; se não vier, calcular em streaming no passo 3.
- Pastas e containers seguem a v1 §6: criação preguiçosa, `logical_key` única e lock consultivo.
- **Duplicata** `(recebimento_id, sha256)` → `409`; o objeto recém-enviado **vai para a quarentena**, não é apagado.
- `sessionUrl` é sensível: só em memória, nunca em log nem em banco (regra já em `docs/attachments-api.md`).
- `DRIVE_UPLOAD_ALLOWED_ORIGINS` continua, com comparação exata. URLs de Preview mudam a cada deploy: usar um alias estável.
- **Antivírus (Q8).** Não roda dentro de uma função serverless. Se a empresa exigir, as opções são: serviço externo de varredura, ou um job em contêiner que baixa o arquivo recém-enviado e libera depois. Fora do MVP; mitigação até lá: allowlist de tipos, assinatura real, `nosniff`, CSP `sandbox` no visualizador de PDF e download como anexo para tipos não-imagem.

### 1.5 Ciclo de vida da exclusão

```
LÓGICO   ATIVO ──(anexos.delete + motivo)──> EXCLUÍDO ──(anexos.restore)──> ATIVO

FÍSICO   ATIVO ─> QUARENTENA_PENDENTE ─> EM_QUARENTENA ─> PURGA_PENDENTE ─> PURGADO
                        ^                      │
                        └──── restaurar ───────┘  (dentro da retenção)
         qualquer estado ─> AUSENTE   (a reconciliação não achou o objeto)
```

1. `DELETE …/anexos/:id` com **motivo obrigatório**. Numa transação: preenche `excluido_*`, marca `QUARENTENA_PENDENTE` e grava `outbox(DRIVE_QUARENTENA)`. Responde `204`; o arquivo some da tela na hora.
2. **Job:** move o objeto para a pasta `Quarentena` (`addParents`/`removeParents`) e marca `EM_QUARENTENA`, com `purga_prevista_em = quarentena_em + retenção` (Q4, padrão 90 dias). Mover um objeto já movido é no-op (idempotente).
3. **Restaurar** (`anexos.restore`): zera `excluido_*`, grava `outbox(DRIVE_RESTAURAR)`; o job devolve à pasta da categoria. Em recebimento finalizado, é preciso reabri-lo antes (trigger da v1).
4. **Purga** (`anexos.purge`, só `ADMINISTRADOR`): só depois de `purga_prevista_em` (antes disso `422 RETENTION_NOT_ELAPSED`). Com Shared Drive, a identidade do ALM **não** exclui definitivamente; a purga roda por ferramenta administrativa com outra identidade e grava `purgado_em`/`purgado_por`.
5. **Regra de código:** `files.delete` só existe no módulo de purga. Um teste estático no CI falha se a chamada aparecer em outro lugar.

**Por que quarentena e não a lixeira do Drive:** a lixeira **apaga sozinha após 30 dias** `[DOC-OFICIAL]`, menos que qualquer retenção razoável. O ChatGPT propôs "mover para a lixeira com retenção de 60/90 dias", o que perderia o arquivo sem aviso. Além disso, `files.delete` (o que o código usa hoje) **não passa pela lixeira**: é definitivo.

**Backup do arquivo excluído:** a v1 §12 mantém cópia independente (S3) por ao menos 180 dias; é Fase 2 do ALM 2.0.

### 1.6 Reconciliação

Cadência da v1 §7. Nunca apaga automaticamente.

| Job | Quando | Compara | Ação |
|---|---|---|---|
| Pendências | a cada 15 min | `arquivos` em `PENDENTE`/`ENVIANDO` há mais de 30 min × objeto no Drive por `properties.almArquivoId` | Existe e confere: completa. Não existe: `FALHOU` |
| Incremental | diário | `DISPONIVEL` sem objeto | `AUSENTE`, bloqueia download, alerta |
| Órfãos | diário | Objetos com `almArquivoId` sem linha | Move para `Quarentena` e registra |
| Integridade | semanal | tamanho e `sha256Checksum` | `INCONSISTENTE` + alerta |
| ACL | diário | Membros e compartilhamentos do Shared Drive | Alerta se aparecer pessoa, `anyone` ou domínio |
| Saúde da credencial | diário | `about.get` com a credencial do ALM | Alerta imediato se falhar |

### 1.7 Quem apagou por fora?

O ALM audita o que passa por ele. Se alguém com permissão de **Editor** apagar direto no Drive:

- A reconciliação detecta o objeto ausente (`AUSENTE`) e registra o evento **sem autor**.
- Descobrir o autor exige o log de auditoria do Drive no console do Workspace ou a API Drive Activity. **[A VERIFICAR no S4]**; não afirmo que está disponível para este caso.
- **A defesa real é permissão:** pessoas entram como **Leitor**; só a identidade do ALM escreve. Isso é decisão de administração do Google, não de código.

### 1.8 Download

Proxy autenticado (v1 §6), com autorização a **cada** requisição, inclusive `Range`. Passar de `Buffer` para **stream**. Cabeçalhos: `Content-Disposition` com nome sanitizado, `X-Content-Type-Options: nosniff` (já existe), `Cache-Control: private, no-store`, CSP `sandbox` para PDF. Registrar em `alm.arquivo_acessos` ao terminar o stream (com bytes realmente enviados). O perfil `PORTARIA` nunca acessa arquivos.

## 2. Google Sheets

### 2.1 Papel (D10)

Espelho **somente leitura** e destino de exportações. Se o Sheets cair ou estourar quota, o ALM continua; só o espelho atrasa.

### 2.2 Regras

1. **Planilha nova** para o espelho (`GOOGLE_SHEETS_MIRROR_ID`). A planilha atual, que hoje é o banco, fica arquivada somente leitura até a migração ser aceita. **Nunca** apontar o espelho para abas com dados ainda não importados: o primeiro snapshot as sobrescreveria.
2. Pessoas como **Leitor**; só a service account escreve. Intervalos protegidos com aviso "gerada pelo ALM, não edite".
3. Escrita sempre **`RAW`** (já é assim hoje): texto que começa com `=` fica literal.
4. **Sem sincronização bidirecional.** Edição manual é descartada no próximo snapshot, por desenho. Para anotar, usar uma aba separada que referencia o código do recebimento.
5. Recebimentos **excluídos não aparecem** no espelho: a exclusão se reflete sozinha.

### 2.3 Por que snapshot, e não "upsert por ID"

A especificação do ChatGPT sincronizaria linha a linha, "upsert por ID". Não funciona bem no Sheets:

- Não há chave nem upsert: achar a linha exige **ler** a coluna de IDs. A quota é de **60 leituras/min e 60 escritas/min por usuário** (uma service account é um usuário) e 300/min por projeto `[DOC-OFICIAL]`. O incidente de 429 de hoje (cerca de 120 leituras para 6 anexos) mostra o risco.
- Falha no meio de uma sequência de linhas deixa a planilha em estado indefinido. O **snapshot é idempotente**: rodar de novo converge.
- Custo: por aba, 1 escrita do bloco novo + 1 limpeza da cauda; com 6 abas, uns 12 chamadas por execução, no máximo 1 execução por minuto: bem abaixo da quota.
- O Google recomenda corpos de requisição de até ~2 MB `[DOC-OFICIAL]`: escrever em blocos de alguns milhares de linhas.

**Não esvaziar antes de escrever.** `clear` seguido de `update` deixa a planilha vazia se a função morrer entre os dois. Escrever o bloco novo **por cima** a partir de `A1` e só depois limpar as linhas além do novo tamanho.

Tamanho: 100 mil recebimentos × ~20 colunas = 2 milhões de células. O limite do Sheets (10 milhões por planilha, número que conheço mas **não conferi** nesta sessão) deixa folga; monitorar e, se necessário, espelhar só uma janela (ex.: últimos 24 meses + tudo que está aberto).

### 2.4 Abas do espelho

| Aba | Linha = | Colunas principais |
|---|---|---|
| `Recebimentos` | recebimento | código, código legado, status, pedido, NF, série, chave NF-e, data de recebimento, fornecedor, CNPJ, tipo, responsável (nome e matrícula), nº de itens, divergências abertas, anexos ativos, NF anexada (sim/não), criado em, atualizado em |
| `Itens` | item | código do recebimento, nº do item, código do produto, descrição, qtd solicitada, qtd recebida, unidade, diferença |
| `Divergencias` | divergência | código, tipo, severidade, status, descrição, aberta em/por, resolvida em/por |
| `Anexos` | arquivo | código, categoria, nome original, tamanho, enviado por/em, estado. **Sem link nem ID do Drive** |
| `Chegadas` | chegada da Portaria | código, chave/NF, fornecedor, status, vinculada a, registrada em/por |
| `_Sincronizacao` | aba | última execução, linhas escritas, atraso, último erro |

Auditoria completa **não** é espelhada: vive só no banco.

### 2.5 Execução

- **Gatilho:** cada mutação grava `outbox(SHEETS_ESPELHO, chave = nome da aba)`. O índice único parcial `uq_outbox_aberto` **coalesce**: vários eventos enquanto há um aberto viram um só (`INSERT … ON CONFLICT DO NOTHING`).
- **Job:** pega o evento com `FOR UPDATE SKIP LOCKED`, usa lock consultivo para haver um único escritor, lê do banco (uma consulta por aba, ordenada), escreve e atualiza `alm.espelho_sheets`.
- **Cadência:** no máximo 1 execução por minuto por aba. Meta (SLO) `[PROPOSTA]`: atraso p95 ≤ 2 min.
- **Erro:** 429/5xx → *backoff* exponencial com jitter (recomendação do Google `[DOC-OFICIAL]`); após N falhas vira `MORTO` e aparece na tela de integrações. A operação nunca espera o Sheets.
- **Manual:** `POST /integracoes/espelho/sincronizar` (`integracoes.manage`).

### 2.6 Exportação formatada (pedido do Lucas)

Pedido: ao exportar, em vez de CSV, usar o Google Sheets, com formatação correta e visualmente boa.

- Botão **Exportar** → `CSV` ou `Google Sheets`, usando **os filtros da tela**.
- **Google Sheets:** o servidor cria um arquivo novo na pasta `ALM — Exportações` (Drive) a partir de um **modelo** mantido pelo time, preenche, formata e devolve o link. Não recomendo gravar numa aba da planilha existente: acumula abas, e apagar abas antigas é uma exclusão a auditar. **O ALM não conhece o e-mail de quem exportou** (login é por matrícula), então o acesso ao arquivo vem da **pasta compartilhada** gerida pelo administrador (Q14).
- **Layout legado**, uma linha por item, igual ao CSV de hoje (`src/data.js:508-533`): Item, Quantidade, Unidade, Descrição, Pedido, Nº NF/documento, Data de Recebimento, Fornecedor, Tipo, Responsável, Status, Observações, Protocolo. Manter a estrutura evita quebrar quem já trabalha com ela no Excel.
- **Formatação** (via `batchUpdate`): título, data/hora, quem exportou e filtros aplicados nas primeiras linhas; cabeçalho congelado e destacado; filtro automático; largura de colunas; datas `dd/mm/aaaa`; números à direita; **cor por status com o texto junto** (nunca só cor); bordas leves; total de linhas e de itens no rodapé; impressão em paisagem.
- **Volume:** até 100.000 linhas por exportação (v1); acima disso, job administrativo.
- **Registro:** `alm.exportacoes` (quem, formato, filtros, total, destino) + evento.

### 2.7 CSV: corrigir já

O `csvCell` atual (`src/data.js:499`) não neutraliza fórmulas. Texto que começa com `=`, `+`, `-`, `@`, tabulação ou retorno de carro é interpretado pelo Excel. Correção testada (ataques neutralizados; números e textos legítimos intactos):

```js
function csvCell(value, delimiter) {
  let text = value == null ? '' : String(value)
  // Neutraliza injeção de fórmula: só em texto (número de verdade passa direto)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (text.includes(delimiter) || /["\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}
```

Quantidades válidas são positivas (v1: `> 0`), então a regra não toca dados legítimos. Acrescentar teste unitário com os payloads acima. O mesmo tratamento vale no export do servidor. **Não apliquei a correção:** é uma mudança de código fora do pedido; posso fazê-la se você autorizar.

## 3. Outbox e jobs (D11)

### 3.1 Estados e tipos

- Tipos (delta SQL): `SHEETS_ESPELHO`, `DRIVE_QUARENTENA`, `DRIVE_RESTAURAR`, `DRIVE_PURGA`.
- Estados: `PENDENTE` → `PROCESSANDO` → `CONCLUIDO`; em erro `FALHOU` (nova tentativa com *backoff*) → após o limite, `MORTO` + alerta. `PROCESSANDO` com `travado_ate` vencido volta para `FALHOU` (a função morreu).
- Cada handler é **idempotente**: repetir um evento não duplica nem estraga.

### 3.2 Onde roda (a lacuna do ChatGPT)

Na Vercel não existe processo de fundo. Dois gatilhos combinados:

1. **Imediato.** Depois de responder, a própria função drena a outbox com `waitUntil` (`@vercel/functions`). **[A VERIFICAR no S5]** disponibilidade e comportamento com Fluid compute.
2. **Rede de segurança.** **Vercel Cron a cada minuto** chama `GET /api/internal/jobs/run?job=outbox`, autenticado por `Authorization: Bearer $CRON_SECRET`. **Cron por minuto exige plano Pro**; na Hobby só roda **1 vez por dia**, com precisão de ±59 minutos `[DOC-OFICIAL]`.
3. Alternativa: `pg_cron` + `pg_net` no Supabase chamando o mesmo endpoint. **[A VERIFICAR no S5]** disponibilidade, granularidade e plano; as páginas oficiais que consultei não trouxeram esses detalhes.

Jobs periódicos:

| Job | Cadência |
|---|---|
| Drenar outbox | 1 min (+ `waitUntil`) |
| Reconciliação de pendências | 15 min |
| Reconciliação incremental, ACL, saúde do Drive, limpeza de sessões | diário |
| Integridade de arquivos | semanal |

O endpoint interno: rejeita sem o segredo; roda como `alm_job_app` com `ator.sistema`; processa em lotes menores que a duração máxima; é idempotente.

### 3.3 Observabilidade

`GET /integracoes/estado` mostra backlog, evento mais antigo, falhas, `MORTO`, última sincronização por aba e última reconciliação. Alertas (Marcelo): backlog > 5 min, `MORTO` > 0, espelho sem sincronizar há > 15 min, reconciliação com pendências, credencial do Drive inválida. Logs com `requestId` e `outbox.id`, **sem segredo**.

## 4. Matriz de falhas

Cada linha vira teste (Marcelo), com dublê do Drive e do Sheets.

| # | Cenário | Comportamento esperado | Recuperação |
|---|---|---|---|
| 1 | Drive indisponível no upload | UI mostra erro; linha `PENDENTE` vira `FALHOU` pelo job; nenhum anexo fantasma | Tentar de novo (mesma `Idempotency-Key`) |
| 2 | PUT terminou, confirmação não chegou (aba fechada) | Linha fica `PENDENTE`; objeto existe | Reconciliação por `almArquivoId` completa, ou `FALHOU` e quarentena do objeto |
| 3 | Confirmação com hash já ativo no recebimento | `409`; objeto novo vai para quarentena | — |
| 4 | Banco cai depois do upload | Objeto órfão no Drive | Reconciliação move para `Quarentena`; nunca apaga |
| 5 | Sheets fora do ar ou `429` | Operação segue normalmente | Outbox tenta de novo; painel mostra atraso |
| 6 | Job de quarentena falha no meio | Fica `QUARENTENA_PENDENTE` | Nova tentativa idempotente |
| 7 | Alguém apaga o arquivo direto no Drive | `AUSENTE`, download bloqueado, alerta | Restaurar de backup (v1 §12) |
| 8 | Alguém edita o espelho | Sobrescrito no próximo snapshot; banco intacto | — |
| 9 | Duas execuções do job ao mesmo tempo | Lock consultivo + `SKIP LOCKED`: uma só escreve | — |
| 10 | Função morre no meio do snapshot | Planilha nunca fica vazia (escreve por cima, limpa a cauda depois) | Próxima execução converge |
| 11 | Token OAuth do Drive expira (plano B) | `DRIVE_AUTH_FAILED` no upload; alerta imediato | Runbook de reautorização |
| 12 | Reenvio de criação após timeout | `Idempotency-Key` devolve o mesmo recurso | — |
| 13 | Purga antes da retenção | `422 RETENTION_NOT_ELAPSED` | — |
| 14 | Restauração com hash ativo igual | `409`; mostra o arquivo ativo (v1 §7) | Decisão do administrador |

## 5. Segurança desta parte

- `CORS_ORIGIN` tem padrão `*` (`backend/config/env.mjs:45`). Em produção, same-origin: **não definir CORS**, ou fixar a origem exata.
- Nomes de variáveis (sem valores; nunca com prefixo `VITE_`): `GOOGLE_SHEETS_MIRROR_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`, `DRIVE_UPLOAD_ALLOWED_ORIGINS`, `DATABASE_URL_API`, `DATABASE_URL_JOB`, `ALM_PIN_PEPPER_V1`, `CRON_SECRET`.
- Preview **nunca** com a planilha, a pasta ou o banco de produção (D13).
- O mesmo tratamento de `sessionUrl`: só em memória.

## 6. Fontes verificadas em 06/10/2026

- Lixeira × exclusão, papéis em Shared Drive: https://developers.google.com/workspace/drive/api/guides/delete
- Checksums, `properties` × `appProperties`: https://developers.google.com/workspace/drive/api/reference/rest/v3/files
- Expiração de refresh token: https://developers.google.com/identity/protocols/oauth2
- Quotas do Sheets: https://developers.google.com/workspace/sheets/api/limits
- Shared Drives: https://support.google.com/a/users/answer/7212025
- Limites de função e streaming na Vercel: https://vercel.com/docs/functions/limitations e https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- Cron na Vercel: https://vercel.com/docs/cron-jobs/usage-and-pricing
- **A verificar:** `waitUntil`, `pg_cron`/`pg_net`, Drive Activity, `sha256Checksum` imediato, limite de 10 milhões de células (spikes S3, S4, S5).
