# 07 — Migração, infraestrutura, custos, testes e roadmap

**Todos revisam.** Marcelo conduz a parte de qualidade e release (se aceitar, Q13).

## 1. Migração do Sheets para o Postgres (D19)

### 1.1 Decidir primeiro (Q9)

Os dados atuais do Sheets e do Drive são **reais** ou de **teste**? O handoff do Goran e o badge "Ambiente de validação" no frontend sugerem ambiente de validação. Isso muda o esforço de dias para semanas.

- **Se são de teste (padrão assumido): recomeçar limpo.** Arquivar a planilha e a pasta do Drive atuais (somente leitura), semear catálogos, importar a lista de funcionários e começar. Custo mínimo, risco mínimo.
- **Se são reais: importação idempotente** (seções 1.2 a 1.6).

### 1.2 Mapeamento campo a campo

| Sheets (`aba.campo`) | Postgres (`alm`) | Observação |
|---|---|---|
| `Recebimentos.id` / `protocolo` | `recebimentos.codigo_legado`; `codigo` é gerado | A trigger da v1 **recusa** `codigo` informado (parte 04, seção 3) |
| `pedido` | `pedido_compra` | |
| `numeroNf`, `serieNf` | `numero_nf`, `serie_nf` | Vazio vira `NULL` |
| `dataRecebimento` (`YYYY-MM-DD`) | `recebido_em` | Só há data: gravar ao meio-dia em `America/Sao_Paulo` e marcar `dados_origem.hora_desconhecida = true`. Não inventar hora real |
| `fornecedor`, `cnpjFornecedor` | `fornecedores` (achar ou criar por CNPJ; sem CNPJ, por nome normalizado) + `fornecedor_nome_snapshot`/`cnpj_snapshot` | `cnpj` é opcional na v1 justamente para isso |
| `tipo` | `tipo_recebimento_id` | `Débito Direto` → `DEBITO_DIRETO`, `Industrialização` → `INDUSTRIALIZACAO` etc. |
| `responsavelId`, `responsavelNome`, `responsavel` (JSON) | `responsavel_id` | Via usuário legado (1.5) |
| `status` | `status` | `Conferido/Finalizado` → `CONFERIDO_FINALIZADO` etc. (5 valores) |
| `observacoes` | `observacoes` | |
| `criadoEm`, `atualizadoEm` | `criado_em`, `alterado_em` | Valores explícitos no `INSERT` |
| `arquivado`, `arquivadoEm`, `arquivadoPor`, `restauradoEm` | `excluido_*` se `arquivado = true` | Motivo `"Arquivado (migrado do Sheets)"`; `restauradoEm` vai para `dados_origem` |
| `Itens.numero` | `numero_item` (inteiro) | Se não numérico, sequencial |
| `Itens.codigo`, `descricao` | `codigo_produto`, `descricao` | |
| `quantidadeSolicitada` | `quantidade_solicitada` | **Vazio = `NULL`, nunca 0** (v1) |
| `quantidadeRecebida` | `quantidade_recebida` | A v1 exige `> 0`; registros com 0 ou vazio vão para o relatório |
| `Itens.unidade` | `unidade_codigo` | **`PÇ` → `PC`**: o catálogo da v1 só aceita `[A-Z0-9._/-]`, e o frontend usa `PÇ`. Decidir o rótulo exibido |
| `Divergencias.*` | `divergencias` | `resolvida` → `status` `RESOLVIDA`/`ABERTA`; severidade padrão `MEDIA`; `resolucao` ausente → "Sem descrição (migrado)" |
| `HistoricoStatus.*` | `recebimento_status_historico` | Ver armadilha 4 |
| `Auditoria.*` | `historico_alteracoes` | Entidade `legado.auditoria`, texto em `detalhes`, ator original em `dados_depois` |
| `Anexos.*` | `arquivos` | **Só se Q9 = real** (1.4) |
| `Usuarios.*` | `usuarios` (`legado = true`) | 1.5 |

### 1.3 Armadilhas do importador (vêm do DDL da v1)

1. **Código.** Importar **em ordem crescente do número legado, dentro de cada ano**. Sem lacunas, o numerador reproduz os mesmos números; o relatório lista onde divergir. `codigo_legado` resolve sempre.
2. **`ck_recebimentos_campos_fluxo`.** Recebimento operacional fora de "Em digitação" exige pedido, fornecedor, data, responsável e tipo. Quem não cumpre entra como `origem = 'MIGRACAO'` (status nulo, "dados não conferidos") e vai para o relatório. Alternativa: completar os dados antes.
3. **Finalizados.** A trigger de finalização exige NF, ao menos um item, anexo de NF ativo e nenhuma divergência aberta. Quem não cumpre cai no mesmo desvio para `MIGRACAO`.
4. **Histórico de status.** A trigger grava **uma linha** ao inserir o recebimento (com a hora da importação). Definir `app.status_observacao = 'Importado do Sheets'` e inserir o histórico legado com a hora original.
5. **Privilégios.** `alm_api` e `alm_job` **não** têm `INSERT` em `recebimento_status_historico` nem em `historico_alteracoes` (só triggers escrevem). O importador roda com a **role dona do schema**, localmente ou pelo CLI, não pela API.
6. **Ator.** Toda escrita auditada exige `app.usuario_id` **ou** `app.ator_sistema`. Usar `ator_sistema = 'import:sheets:<lote>'`.
7. **Idempotência.** Tabela de mapeamento `alm_import.mapa(aba, id_legado, id_novo, lote)` em schema próprio, apagado depois do aceite. Unidade de trabalho: um recebimento com seus filhos, numa transação.
8. **Duplicatas.** O `max + 1` antigo pode ter gerado protocolos repetidos; detectar **antes** e resolver à mão.
9. **Valores do Sheets.** Vêm como texto: parsear datas ISO, booleanos (`TRUE`/`true`) e números; o que não parsear vai para o relatório, nunca é "consertado" em silêncio.

### 1.4 Arquivos do Drive (só se Q9 = real)

`arquivos` tem colunas obrigatórias (`checksum_sha256`, `mime_type_detectado`, `storage_container_id`, `storage_namespace`, `idempotency_key`). Os anexos antigos não têm isso. O caminho é um job `drive-copy`: para cada anexo, **copiar** para o destino final (Shared Drive, se Q1 = sim), ler o `sha256Checksum`, detectar o MIME pelos primeiros bytes, criar o container e re-marcar com `properties`. Os originais **não** são apagados. Sem Shared Drive, registrar os arquivos onde estão (`storage_namespace = 'LEGADO'`) e manter a credencial antiga ativa. Em ambos os casos o nome físico com o protocolo antigo permanece.

### 1.5 Usuários

- Hoje só existem os 4 usuários demo. **A lista real de funcionários vem do RH** (Q2): CSV `matricula;nome;setor;cargo;perfil;papel_superior`, com dry-run e relatório.
- Os autores antigos (`USR-001` a `USR-004` e quem mais aparecer nos JSON de ator) viram usuários `legado = true`, **inativos e sem matrícula**, só para manter a integridade das chaves estrangeiras e a autoria.
- PINs temporários: gerados no import, entregues **em mão** por um superior, expiram em 72 h, troca obrigatória. O arquivo com os PINs é destruído depois.

### 1.6 Procedimento e virada

```
0. Backup: copiar a planilha atual; pg_dump do staging.
1. Inventário: contagens por aba, duplicatas, órfãos, datas inválidas.
2. Dry-run em staging -> relatório (importados / desvio para MIGRACAO / rejeitados, com motivo).
3. Revisão de uma amostra com o Almoxarifado; ajustar regras.
4. Importação em staging -> conferir: contagem por entidade, soma de quantidades,
   recebimentos por status, NF por registro (amostra de 10%).
5. Ensaio de rollback.
6. VIRADA (produção): repetir 1-4 com os dados finais; ligar REPOSITORY=postgres e
   AUTH_MODE=session; ligar o espelho na planilha NOVA; liberar os usuários.
7. Acompanhamento intensivo por 2 semanas. Planilha e pasta antigas ficam
   INTACTAS por pelo menos 90 dias.
```

**Rollback.** Antes da primeira escrita nova em produção: descartar o banco e voltar `REPOSITORY=sheets` (a planilha antiga não foi tocada). **Depois** da primeira escrita nova, voltar ao Sheets perde essas escritas; por isso o *go/no-go* acontece **antes** da liberação, e o `pg_dump` pré-virada é guardado.

## 2. Ambientes e configuração (D13)

| | Local | Staging | Produção |
|---|---|---|---|
| Banco | Supabase CLI (`supabase start`, Docker) | Projeto Supabase de staging | Projeto Supabase **Pro** |
| Aplicação | `npm run dev` + `npm run api` | Preview da Vercel com alias estável | Production da Vercel |
| Planilha | Dublê ou planilha de teste | Planilha de staging | Planilha espelho de produção (**nova**) |
| Drive | Dublê ou pasta de teste | Shared Drive ou pasta de staging | Shared Drive ou pasta de produção |
| Dados | Sintéticos | Sintéticos ou anonimizados | Reais |

- **Preview nunca com dados reais.** O handoff do Goran já registra o risco de um Preview apontar para a planilha de produção. Variáveis com escopo por ambiente; **lembrar que uma variável nova só vale em deploys novos** (hipótese do Goran: redeploy após mudar env).
- Preview protegido por **Vercel Authentication** (disponível no Hobby e no Pro `[DOC-OFICIAL]`).
- O plano Free do Supabase permite **2 projetos ativos** `[DOC-OFICIAL]`; o ambiente local pelo CLI evita um terceiro projeto hospedado.
- **Região:** criar o projeto Supabase em **São Paulo** **[A VERIFICAR na criação]** e fixar a função da Vercel em `gru1`; o padrão da Vercel é `iad1` (EUA) `[DOC-OFICIAL]`. Cada requisição faz pelo menos duas consultas ao banco; a latência entre regiões aparece.
- **Logs:** retenção curta (Vercel: 1 hora na Hobby, 1 dia na Pro `[DOC-OFICIAL]`). Para diagnóstico e auditoria técnica, enviar a um destino externo (log drain, plano Pro) ou gravar o essencial no banco.
- **Cabeçalhos de segurança** pelo `vercel.json`: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`.
- **Variáveis:** lista de nomes na parte 05, seção 5. Nunca com prefixo `VITE_`. Nunca no repositório (`.env` já está no `.gitignore` `[CÓDIGO]`).
- **Supabase:** schema `alm` fora das "Exposed schemas"; `public` vazio; backups ligados (Pro) mais `pg_dump` diário em local separado. Se a equipe adotar o Plano B de autenticação: desligar cadastro público e login anônimo.

## 3. Custos (verificados em 06/10/2026; confirmar antes de aprovar orçamento)

| Item | Preço | O que significa para o ALM |
|---|---|---|
| Supabase Free | US$ 0 | 500 MB de banco, 50 mil MAU, 1 GB de storage (não usado), 5 GB de egress, **2 projetos ativos**, **sem backup**, **pausa após 1 semana sem uso**, logs de 1 dia. Serve para desenvolvimento e staging |
| Supabase Pro | a partir de US$ 25/mês | 8 GB de disco por projeto, **backups diários por 7 dias**, sem pausa, logs de 7 dias; **compute cobrado por projeto adicional** |
| Supabase PITR | US$ 100/mês por 7 dias de retenção | Só se a empresa não aceitar perder até 24 h (Q10) |
| Vercel Hobby | US$ 0 | **Apenas uso não comercial e pessoal**; cron **1 vez por dia**. **Não serve** para a produção da empresa |
| Vercel Pro | US$ 20/mês por assento de desenvolvedor (visualizadores grátis) | **Uso comercial permitido**; cron por minuto; duração configurável até 800 s; logs de 1 dia; drains de log |
| Google Workspace | fora do escopo | Decisão da empresa (Q1) |

**Mínimo para produção:** US$ 25 + US$ 20 (1 assento) = **cerca de US$ 45/mês**, sem PITR e sem compute extra para o staging, mais impostos. A especificação do ChatGPT mencionava só o Supabase; a licença da Vercel muda a conta e é uma questão de conformidade, não só de custo.

## 4. Segurança e LGPD

### 4.1 Itens novos (além da v1 §8 e §18)

- `X-User-Id` removido; `AUTH_MODE=session` em produção desde o dia 1.
- `CORS_ORIGIN` fixo ou ausente (hoje o padrão é `*`).
- Cookies `__Host-`, CSRF, CSP e HSTS testados (parte 03).
- Schema `alm` fora da Data API e RLS ligada (delta SQL).
- Preview protegido e sem dados reais.
- `npm audit` e dependências revisadas no CI.
- Logs sem PIN, token, `sessionUrl` ou chave; teste que varre os logs.
- Neutralização de fórmulas no CSV (parte 05, seção 2.7).
- Pepper do PIN e demais segredos só no cofre da Vercel, com acesso restrito e rotação documentada.

### 4.2 LGPD `[validar com jurídico/DPO]`

- **Dados pessoais tratados:** nome, matrícula, cargo e setor, **IP e user-agent**, histórico de ações de cada pessoa.
- **Finalidade:** controle de recebimentos e rastreabilidade de quem fez o quê. A **base legal** é decisão do jurídico.
- **Minimização:** não gravar imagem nem texto bruto de OCR na Portaria; remover EXIF/GPS das fotos; IP e user-agent só visíveis com `auditoria.tecnica`.
- **Retenção:** da auditoria (Q11, padrão 5 anos), da quarentena (Q4, padrão 90 dias), dos backups.
- **Local e transferência:** banco em São Paulo; Vercel e Google podem processar fora do Brasil. Informar no aviso de privacidade.
- **Direitos do titular e incidentes:** definir quem atende pedidos de acesso/correção (administrador) e o runbook de incidente.

## 5. Testes e qualidade

**Hoje:** `npm test` roda 90 testes: anexos, scanner e os caminhos do repositório/Sheets ligados a anexos e NF. **Não há** teste de handler HTTP, do serviço de recebimentos de ponta a ponta, de autenticação, de concorrência nem de routing, e **não existe CI** (não há `.github/`). O bug de imports ausentes que chegou à produção (handoff do Lucas §8.5) teria sido pego por `ESLint no-undef`, que foi usado manualmente e **não está no projeto**.

| Camada | O que cobrir | Como | Dono |
|---|---|---|---|
| Unidade | Regras de domínio, PIN, normalização, **matriz de permissões** | `node --test` (já usado) | cada autor |
| Banco | Constraints, triggers, **50 inserts concorrentes geram códigos únicos e contíguos**, ator obrigatório, auditoria imutável, finalização, quarentena em recebimento finalizado, RLS (`alm_api` passa, `anon`/`authenticated` negados) | Postgres efêmero (Supabase CLI ou contêiner no CI) + `node --test` | Kobner, Marcelo |
| HTTP/integração | Todas as rotas × papéis, erros, idempotência, `If-Match`, com dublês de Drive e Sheets | handler em memória | Goran, Marcelo |
| E2E | Login, Portaria, criar, anexar, divergência, finalizar, buscar, excluir/restaurar, exportar, permissões | Playwright (já usado no scanner) | Marcelo |
| Smoke pós-deploy | `/api/v1/catalogos`, `/api/v1/auth/me` (401), `/api/v1/recebimentos/<id>`, rota profunda de anexos (leitura), health | script `curl`/Node | Marcelo |
| Carga | 100.000 recebimentos sintéticos; **busca p95 ≤ 500 ms, autocomplete p95 ≤ 250 ms, detalhe p95 ≤ 400 ms** (v1 §14) | script de carga | Goran, Marcelo |
| Caos | Sheets fora do ar; Drive com 5xx; função morta no meio do snapshot; timeout de banco | dublês com falha injetada | Marcelo |
| Segurança | Lockout, enumeração, CSRF, varredura de logs, `npm audit`, SAST/DAST básicos | automatizado + revisão | Kobner, Marcelo |
| Restauração | Restaurar backup em banco isolado e comparar | mensal; trimestral completo (v1 §12) | Marcelo |

**CI mínimo (F0):** `npm test`, validador de SQL (`docs/alm2/sql/validate-sql.mjs`), ESLint com `no-undef` e `react/jsx-no-undef`, `npm audit`, build do Vite. Critérios de aceite por fase, não porcentagem global de cobertura.

## 6. Roadmap

Estimativa `[ESTIMATIVA]` em semanas de calendário, **a recalibrar no fim da F0** com a disponibilidade real de cada pessoa. A v1 estimava 10 a 12 semanas para um projeto do zero com equipe dedicada; aqui há escopo novo (Portaria, matrícula + PIN, espelho do Sheets) e equipe parcial, mas boa parte da base (UI, scanner, upload) já existe.

| Fase | Sem. | Dono(s) | Entregas | Saída |
|---|---|---|---|---|
| **F0** Alinhar e destravar | 1 | todos | Respostas de Q1, Q2, Q7, Q9; D03 decidido (S2); `main` integrada à branch e **Preview validado (S7)**; Supabase local e staging (S1); CI mínimo; `CODEOWNERS` | Rotas profundas respondem no Preview; D03, D09 e D12 congeladas |
| **F1** Banco e repositório | 2–4 | Kobner, Goran, Marcelo | Migrations v1 + delta; `PostgresRecebimentosRepository` (leitura, depois escrita); `withActor`; flag `REPOSITORY`; código REC atômico; testes de banco | Suíte atual + testes do repositório verdes com `REPOSITORY=postgres` em staging; teste de concorrência verde |
| **F2** Identidade e permissões | 3–5 | Kobner, Lucas, Goran, Marcelo | Módulo de auth; `/auth/*`; matriz RBAC com testes gerados; login, troca de PIN e guarda de rotas na UI; `permissoes` na UI; remoção do `X-User-Id` | Nenhuma rota responde sem sessão (exceto login e health); 401/403 tratados; bloqueio e sessão testados |
| **F3** Arquivos | 5–6 | Goran, Lucas | Confirmação com sha256 e assinatura; quarentena, restauração, purga; reconciliador; download em streaming; limites | Matriz de falhas (05 §4) coberta; nenhum `files.delete` fora da purga |
| **F4** Espelho do Sheets e exportação | 6–7 | Goran, Lucas | Job de snapshot; estado; exportação formatada; CSV seguro; tela de integrações básica | Teste de caos: Sheets fora do ar não afeta a operação; atraso p95 ≤ 2 min |
| **F5** Portaria | 7–8 | Lucas, Goran, Kobner, Marcelo | `chegadas_portaria` (API); UI; scanner; vínculo; duplicidade | Fluxo completo em tablet real; duplicata recusada |
| **F6** Pesquisa, filtros e dashboard | 8–9 | Goran, Lucas, Kobner | Busca no servidor; filtros salvos; cursor; dashboard do servidor | Metas de latência com 100 mil sintéticos |
| **F7** Auditoria, administração e notificações | 9–10 | Lucas, Goran | Telas de auditoria, excluídos, usuários; 5 níveis de notificação; catálogo de mensagens | Revisão de segurança dos endpoints administrativos |
| **F8** Endurecimento | 11–12 | todos; Marcelo conduz | Teste de restauração; carga; segurança; LGPD; runbooks; E2E completo | Checklist da v1 §18 e desta parte marcados |
| **F9** Piloto e virada | 13–14 | todos | Treinamento; importação final (D19); virada; acompanhamento | Aceite do Almoxarifado, Suprimentos e Portaria |

```
F0 ─> F1 ─────────────> F3 ─> F4 ──────────────┐
        └─> F2 ───────────────> F5 ─> F6 ─> F7 ─> F8 ─> F9
```

Total: **cerca de 14 semanas** com esse paralelismo (F2 começa quando o schema existe; F3/F4 e F5/F6 se sobrepõem em pessoas diferentes). Sem o Marcelo (Q13), Goran e Lucas absorvem CI e E2E e o prazo de F8 sobe.

## 7. Equipe (D17)

Evidência do Git: 30 commits do Lucas, 7 do Goran (`Gorann0`), 2 do Kobner (`MatteusKobner`: modo escuro, remoção de dados fictícios), 2 de `paidoszz` (merge, remoção de dados fictícios), 1 de `shoitzsx` (inicial) `[CÓDIGO]`. `paidoszz` deve ser o Marcelo, mas é inferência pelo nome; confirmar.

| Pessoa | Responsabilidade | Entregáveis principais | Não é dono de |
|---|---|---|---|
| **Lucas** | Frontend, UX, scanner, produto | Login/PIN na UI, store servidor-autoridade, Portaria, pesquisa e filtros, notificações, telas de administração | Hash de PIN, RLS, migrations, OAuth do Drive |
| **Goran** | Backend, domínio, integrações, confiabilidade | Repositório Postgres, serviços, API, Drive (quarentena, reconciliação), espelho do Sheets, outbox e jobs, importação | Schema de identidade e matriz RBAC (revisa) |
| **Kobner** | Banco, identidade, RBAC | Migrations, roles e grants, módulo de auth, sessões, bloqueio, matriz de permissões e testes gerados, backup do banco | Regras de recebimento e integrações Google (revisa SQL do domínio com o Goran) |
| **Marcelo** (proposta) | QA, release, observabilidade | CI, smoke, E2E, banco de testes, carga, caos, restauração, checklist de virada, painéis e alertas | Escrever as funcionalidades |

Regras de convivência:

- **Quem escreve o SQL (Kobner) e quem escreve as consultas (Goran) revisam um ao outro.** É a fronteira mais fácil de gerar retrabalho.
- **Contrato primeiro:** OpenAPI e códigos de erro acordados antes de implementar; o Lucas trabalha contra mock.
- **Flags** para entregar em pedaços sem quebrar: `AUTH_MODE`, `REPOSITORY`, `REQUIRE_IF_MATCH`.
- **`CODEOWNERS`:** `supabase/**` e `backend/auth/**` → Kobner; `backend/integrations/**` e `backend/repositories/**` → Goran; `src/**` → Lucas; testes e CI → Marcelo.
- **Definição de pronto:** teste automatizado, evidência de auditoria quando mutar dado, nenhuma regra de negócio duplicada no cliente, documentação atualizada.

## 8. Spikes

Antes de congelar as decisões marcadas. Cada um tem critério objetivo; "passou" ou "não passou", sem opinião.

| # | Dono | Dias | Pergunta | Passa se |
|---|---|---|---|---|
| **S1** | Kobner | 1–2 | O DDL v1 + delta executa e o acesso por `pg` via pooler funciona? | `supabase db reset` aplica sem erro; `BEGIN; set_config(...); INSERT recebimento; COMMIT` pelo pooler transacional **sem** query nomeada; login técnico `alm_api_app` conecta; `unaccent` e `pg_trgm` presentes; 50 inserts concorrentes geram 50 códigos distintos e contíguos |
| **S2** | Kobner + Goran | 2 | Credenciais próprias (D03) ou Supabase Auth? | Hash p95 < 500 ms numa função da Vercel, sem problema de binário; bloqueio e sessão testados; revisão por 2ª pessoa. Senão, Plano B |
| **S3** | Goran | 1 | Streaming passa de 4,5 MB? | Download de ≥ 20 MB com `Range` pela função, sem estourar memória nem o limite de resposta |
| **S4** | Goran | 1–2 | O Drive entrega o que a v1 precisa? | `sha256Checksum` preenchido logo após o upload; `Range` de 4 KB lê a assinatura; `properties` aceitas na sessão resumível; mover entre pastas (`addParents`/`removeParents`); se houver Workspace, service account em Shared Drive; avaliar Drive Activity |
| **S5** | Goran | 1–2 | Onde a outbox roda? | `waitUntil` drena após a resposta; Cron de 1 min (Pro) dispara; alternativa `pg_cron` + `pg_net` avaliada; snapshot de 10 mil linhas no Sheets dentro da quota, escrevendo por cima sem esvaziar |
| **S6** | Lucas | 2–3 | O fluxo de login e Portaria funciona em tablet real? | Login com PIN pad, inatividade, "Trocar usuário"; protótipo da Portaria testado por 2 pessoas da operação |
| **S7** | Marcelo + Goran | 0,5–1 | O routing da Vercel funciona de ponta a ponta? | Depois do merge, Preview com **todas** as variáveis: `/api/v1/catalogos`, `/api/v1/auth/me`, `/api/v1/recebimentos/<id>`, `/api/v1/recebimentos/<id>/anexos` respondem do **backend** (não do `NOT_FOUND` da Vercel) |

## 9. Riscos principais

Os demais estão na v1 §17.

| Risco | Prob. | Impacto | Mitigação | Dono |
|---|---|---|---|---|
| Decisão de autenticação indefinida atrasa tudo | Média | Alta | S2 com prazo; Lucas avança contra mock | Kobner |
| Sem Google Workspace, o Drive fica preso a uma conta | Média | Alta | Plano B com saúde diária, consent screen em produção, conta dedicada | Goran |
| Troca do store (parte 06) subestimada | Alta | Alta | 4 passos, regressão a cada passo, estimativa G explícita | Lucas |
| Sobreposição Kobner/Goran no SQL | Média | Média | Revisão cruzada, `CODEOWNERS`, fronteira acordada | todos |
| Pouca cobertura de teste HTTP/E2E | Alta | Alta | CI na F0, matriz de permissões gerada, Marcelo | Marcelo |
| Dados reais em Preview | Média | Alta | Env por ambiente, Preview protegido | Marcelo |
| Vercel Hobby usada em produção | Média | Média | Q7 antes da virada | Lucas |
| Espelho sobrescreve a planilha antiga | Baixa | Alta | Planilha nova; nunca apontar para dados não importados | Goran |
| PIN fraco ou bloqueio de propósito | Média | Média | Parte 03, seções 3.3 e 7 | Kobner |
| Disponibilidade das pessoas | Alta | Alta | Recalibrar no fim da F0; escopo cortável: F6 e F7 | todos |
| Escopo crescer (XML, OCR de itens, antivírus) | Alta | Média | Ficam fora do MVP; entram por decisão explícita | Lucas |
| Quarentena sem backup independente | Média | Média | Backup S3 da v1 §12 como Fase 2; PITR conforme Q10 | Goran |

## 10. Fontes verificadas em 06/10/2026

- Preços e limites do Supabase: https://supabase.com/pricing
- Hobby, Pro e Cron na Vercel: https://vercel.com/docs/plans/hobby e https://vercel.com/docs/cron-jobs/usage-and-pricing
- Limites de função, regiões e logs: https://vercel.com/docs/functions/limitations
- Conexão com o Postgres: https://supabase.com/docs/guides/database/connecting-to-postgres
- **A verificar:** disponibilidade da região de São Paulo no Supabase e `gru1` na Vercel; `waitUntil`; `pg_cron` e `pg_net`; pooler com login técnico (S1, S4, S5).
