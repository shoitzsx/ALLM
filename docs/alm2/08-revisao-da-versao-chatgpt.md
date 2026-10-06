# 08 — Revisão da especificação do ChatGPT

Avaliação do `ALM_2_0_Especificacao_Arquitetura_Completa.md` (44 seções) e do diagrama "ALM – Arquitetura Híbrida". A conversa colada veio **truncada** no meio da "Parte 1", então avaliei só esses dois artefatos, que chegaram inteiros.

Legenda: ✅ confirmado · ⚠️ parcial, impreciso ou incompleto · ❌ errado ou inviável · ➕ lacuna · ❓ não verificável.

## 1. Veredito

**Boa síntese e boas decisões de princípio, mas insuficiente como especificação implementável.** Quatro razões:

1. **Ignorou o `ARQUITETURA_TECNICA_ALM.md`**, que já tem DDL pronto, auditoria por trigger, busca, arquivos, backup, migração e plano. Reinventou essas partes, em inglês e com menos rigor, criando uma terceira convenção de nomes.
2. **Deixou sem resposta as decisões de plataforma que determinam se o desenho funciona:** como o backend fala com o banco, onde a fila roda, de onde vem o limite de login, o que a Vercel permite.
3. **Contém afirmações que a documentação oficial contradiz** (lixeira do Drive, upsert no Sheets) ou que omitem um limite decisivo (bloqueio de PIN, cron da Vercel Hobby).
4. **Não foi conferida contra o código**: não mapeia os 4 perfis reais, os códigos de permissão em português, o `id` igual ao protocolo, o store local-first nem o CSV vulnerável.

## 2. O que acertou (e foi mantido)

- Separar **estado atual** de **proposta**, com marcas.
- **Supabase não substitui o backend**: regras de negócio continuam no serviço.
- **Monólito modular**, sem microsserviços.
- **Outbox transacional** para integrações externas (corrigida: snapshot no Sheets).
- **Auditoria separada do histórico** operacional, e **append-only**.
- **Papéis separados de cargo**; deny-by-default.
- **Portaria como entidade própria** (a chegada), não "recebimento com menos botões".
- **Soft delete com retenção**; nunca apagar o Drive de imediato; **nunca duas fontes da verdade**.
- **Filtros declarativos**, sem SQL do usuário; filtros salvos.
- **Cinco níveis de notificação**, acessibilidade, `aria-live`.
- **Ambientes separados** e **Preview sem dados reais**.
- **Scanner:** manter o pipeline, não reativar o ao vivo, XML como pipeline futuro.
- Observação de que a **chave secreta do Supabase nunca vai ao navegador**.

## 3. Correções críticas

| # | Problema | Onde foi corrigido |
|---|---|---|
| 1 | Desconhece o `ARQUITETURA_TECNICA_ALM.md` | partes 02 e 04 |
| 2 | Supabase Auth com e-mail sintético sem examinar bloqueio, limite por IP, sessão e o fato de o navegador não consultar o banco | parte 03, seção 2 (D03) |
| 3 | Não diz como o backend conecta ao banco; cliente REST não faz transação de vários comandos | parte 04, seção 2 (D02) |
| 4 | "Worker" da outbox sem dizer onde roda; cron da Vercel Hobby é **1 vez por dia** | parte 05, seção 3 (D11) |
| 5 | Omite que a Vercel Hobby é **não comercial** | parte 07, seção 3 (D12) |
| 6 | "Lixeira com retenção de 60/90 dias": a lixeira do Drive apaga em 30 | parte 05, seção 1.5 (D09) |
| 7 | "Upsert por ID" no Sheets, com quota de 60/min por usuário | parte 05, seção 2.3 (D10) |
| 8 | Auditoria gravada pela aplicação, mais frágil que trigger; sem log de acesso a arquivo | parte 04, seção 6 (D08) |
| 9 | 9 papéis inventados, sem mapear os 4 reais; permissões em inglês | parte 03, seção 8 (D05) |
| 10 | Evento "arquivar" sem coluna; `archived` e `deleted` misturados | parte 04, seção 4 (D07) |
| 11 | Frontend tratado como "tela de login" | parte 06 (D16) |
| 12 | Não viu o CSV sem proteção de fórmula | parte 05, seção 2.7 |
| 13 | Sem estimativa, sem spikes, sem critérios de saída | parte 07 |
| 14 | Sem LGPD, sem região, sem CI (que não existe) | parte 07 |

## 4. Afirmação por afirmação

### 4.1 Estado atual

| # | Afirmação (seção do original) | | Evidência |
|---|---|---|---|
| 1 | Pesquisa já ignora acento e caixa, no cliente (§2.1) | ✅ | Handoff do Lucas §9 |
| 2 | Pipeline do scanner, live oculto, sem XML (§2.2, §13) | ✅ | Handoff do Lucas §5 |
| 3 | Agregado montado por `batchGet`; `replaceChildren` regrava as abas filhas (§2.4) | ✅ | `recebimentosRepository.mjs:132-156` `[CÓDIGO]` |
| 4 | `X-User-Id` falsificável, fallback para Administrador (§2.6) | ✅ | `backend/app.mjs:75` `[CÓDIGO]` |
| 5 | Drive pode apagar fisicamente (§2.5) | ✅ | `googleDrive.mjs:179` `[CÓDIGO]` |
| 6 | Os handoffs divergem sobre o fix do routing; validar (§2.7) | ⚠️ | **Os dois estão certos**: o fix está só na branch; `main` e branch divergiram; merge sem conflito `[TESTE]` |
| 7 | 90 testes passam (§28.1) | ✅ | `npm test`: 90/90 na branch `[TESTE]` |
| 8 | Kobner e Marcelo sem implementação (§5.3, §5.4) | ⚠️ | Têm 2 commits cada, de pouco peso (modo escuro, remoção de dados fictícios) `[CÓDIGO]` |
| 9 | Auditoria atual é texto sem antes/depois (§2.4) | ✅ | Handoff do Goran §8 |

### 4.2 Plataforma

| # | Afirmação | | Evidência |
|---|---|---|---|
| 10 | Senha do Supabase Auth se liga a e-mail ou telefone (§7.2) | ✅ | Documentação oficial |
| 11 | Recomenda ≥ 8 caracteres (§7.5) | ✅ | "Menos de 8 não é recomendado"; numérico é permitido |
| 12 | Senhas guardadas com bcrypt (§43) | ❓ | A documentação consultada não cobre este ponto |
| 13 | "Evitar" credenciais próprias no backend (§7.4) | ⚠️ | Recomendação invertida, com evidência: parte 03 |
| 14 | Bloqueio e limite de tentativas "junto com o backend" (§7.8) | ⚠️ | Certo na intenção. Omite que o hook nativo de bloqueio é de **Teams/Enterprise** e que o login tem **30 por 5 min por IP** |
| 15 | Custom Access Token Hook para RBAC (§8.5) | ✅ | Existe (Free e Pro); desnecessário num desenho só com backend |
| 16 | Operações normais "com o JWT do usuário, quando possível" (§8.6) | ⚠️ | Contradiz o desenho: o navegador não consulta o banco; o backend usa role técnica |
| 17 | Transação `BEGIN…COMMIT` a partir do backend (§22.1) | ⚠️ | Conceito certo; não diz como. Exige driver Postgres via pooler |
| 18 | "Worker busca eventos pendentes" (§22.2) | ❌ | Sem processo de fundo na Vercel; Hobby só roda cron 1×/dia |
| 19 | Free: 500 MB, 50 mil MAU, 1 GB, 5 GB, pausa em 1 semana, sem backup (§30) | ✅ | Página de preços |
| 20 | Pro a partir de US$ 25; backups "conforme o plano" (§30) | ⚠️ | Backups de 7 dias; **PITR é +US$ 100/mês** |
| 21 | Três ambientes Dev, Staging, Prod (§6.3) | ⚠️ | Free permite **2 projetos ativos**; produção precisa de Pro |
| 22 | "Pro por confiabilidade, não por MAU" (§30) | ✅ | Boa observação |
| 23 | Mover para a lixeira com retenção de 60/90 dias (§14.2) | ❌ | A lixeira do Drive apaga em **30 dias** |
| 24 | Drive Activity ou auditoria do Workspace, "futuramente" (§14.5) | ✅ | Cauteloso; segue **[A VERIFICAR]** |
| 25 | Shared Drive institucional "avaliar" (§14.4) | ⚠️ | Exige **Workspace**; não perguntou (Q1) |
| 26 | Marcadores `appProperties` (§14.1, §2.5) | ⚠️ | São **privadas** ao app; outra identidade não as lê |
| 27 | Espelho protegido, sem sincronização bidirecional (§15.3) | ✅ | |
| 28 | Sincronizar por upsert de ID (§15.2, §22) | ❌ | Sheets não tem upsert; quota de 60/min por usuário |
| 29 | Exportação formatada por API (§15.4) | ⚠️ | Não considerou o layout legado nem o acesso sem e-mail |
| 30 | Segredos só no servidor, nunca `VITE_` (§25.3) | ✅ | |
| 31 | Smoke de rotas simples e profundas (§25.1) | ✅ | Incorporado (S7) |
| 32 | Magic bytes e antivírus "no futuro" (§31.4) | ⚠️ | A v1 os põe no MVP; são incompatíveis com a Vercel. Decisão explícita (Q8) |
| 33 | Vercel Hobby × Pro | ➕ | **Omitido**: Hobby é não comercial |
| 34 | Refresh token do Drive em "Testing" expira em 7 dias | ➕ | **Omitido** |

### 4.3 Arquitetura, dados e produto

| # | Afirmação | | Evidência |
|---|---|---|---|
| 35 | Supabase não substitui o backend (§3.2) | ✅ | |
| 36 | Monólito modular (§3.5) | ✅ | Igual à v1 |
| 37 | Tabelas e colunas em inglês (§9) | ❌ | Conflita com v1, código e diagrama (português) |
| 38 | `receipts.id uuid` + protocolo único (§9.6) | ⚠️ | Boa ideia, mas hoje o `id` **é** o protocolo; faltou `codigo_legado` |
| 39 | Protocolo por função transacional e `UNIQUE` (§10) | ✅ | A v1 já tem. **Não viu** que a trigger recusa código informado (afeta a migração) |
| 40 | `audit_events` gravada pelo app, `ip`, `before/after` (§9.13) | ⚠️ | Menos robusto que trigger; sem `arquivo_acessos` |
| 41 | Catálogo de eventos de auditoria (§16, §39) | ✅ | Incorporado |
| 42 | 9 papéis (§8.2) | ⚠️ | Não mapeados; a v1 e o código têm 4 |
| 43 | Códigos `receipts.read` etc. (§8.3) | ⚠️ | O código já usa `recebimentos.read` |
| 44 | Evento `RECEIPT_ARCHIVED` (§39) sem coluna `archived_*` (§9.6) | ❌ | Inconsistência interna |
| 45 | `unaccent` e `pg_trgm` (§18.2) | ✅ | A v1 §4–5 tem DDL e consultas |
| 46 | Filtros declarativos sem SQL livre (§18.3) | ✅ | Incorporado (parte 04, seção 7) |
| 47 | Notificações em 5 níveis (§19) | ✅ | Incorporado (parte 06, seção 8) |
| 48 | `gate_arrivals` para a Portaria (§9.10, §11) | ✅ | Incorporado como `chegadas_portaria` |
| 49 | Dashboard no servidor (§20) | ✅ | O endpoint já existe e não é usado |
| 50 | Migração com importador idempotente (§27) | ⚠️ | Conceito certo; sem as armadilhas do DDL (parte 07, seção 1.3) |
| 51 | Reorganizar pastas em módulos (§26) | ⚠️ | Desnecessário para entregar; refatorar por domínio quando tocar |
| 52 | Roadmap em 10 fases (§32) | ⚠️ | Sem estimativa; a ordem difere do próprio diagrama |
| 53 | Divisão da equipe (§5) | ✅ | Plausível; Marcelo é proposta (Q13) |
| 54 | Critérios mínimos de produção (§33) | ✅ | Útil; somados aos da v1 §18 |
| 55 | LGPD, região, CI, store local-first, contrato camelCase, limite de 4,5 MB, `SET LOCAL` | ➕ | **Omitidos** |

## 5. O diagrama "ALM – Arquitetura Híbrida"

Serve como **visão geral** para quem não é técnico. Como especificação, tem problemas que contradizem o próprio texto:

| Ponto no diagrama | Problema | Correto |
|---|---|---|
| Fluxo, passo 6: "Registra auditoria" **depois** do Sheets e do Drive | Auditoria fora da transação pode se perder | Auditoria na **mesma transação** do dado (passo 2) |
| Passo 5: "Faz upload de arquivos para o Google Drive" pelo backend | Hoje o navegador envia direto; a Vercel limita corpo a 4,5 MB | Upload direto + confirmação (parte 05) |
| "Em caso de erro, registra na tabela `sync_sheets` e tenta novamente" | Se o processo morre entre o commit e o registro, o evento se perde | Linha na `outbox` **na mesma transação** |
| Tabelas em português (`funcionarios`, `recebimentos`…) | O texto do ChatGPT usa inglês | Português, igual à v1 |
| `funcionarios.perfil (text)` | Sem papéis superiores, sem permissões, sem matrícula única nem bloqueio | `usuarios`, `usuario_papeis`, `credenciais_pin` |
| `anexos` com `storage_key` "link do Drive" | A regra é nunca expor link nem ID do Drive ao cliente | `storage_object_id` opaco; sem URL |
| Sem `deleted_*`/exclusão lógica, sem `versao`, sem outbox, sem sessões | Falta o que sustenta os requisitos | Delta SQL |
| Sem Portaria nem Almoxarifado | É o principal pedido novo | `chegadas_portaria`; parte 03 e 06 |
| Fases: "Implementar API para usar o Supabase" antes de "Autenticação" | O texto põe a autenticação primeiro | F1 e F2 em paralelo (parte 07) |
| Caixa `anexos` ilegível (texto sobreposto) | Artefato da renderização | Refazer |
| "Supabase Storage (opcional)" | O texto diz que Storage não é necessário | Remover |

**Recomendação:** substituir pelo diagrama da parte 01 (ASCII, versionado no repositório) e usar o da imagem só como apresentação.

## 6. Limites desta revisão

- Não avaliei a "Parte 1" da conversa, que foi cortada.
- Não vi o relatório da turma (PDF) citado no handoff do Lucas.
- Não validei nada na Vercel real, nas APIs reais do Google nem em dispositivos físicos.
- Nenhum SQL foi executado; só a sintaxe foi validada.
- Preços e limites foram lidos em 06/10/2026; mudam.

## 7. Para o próximo uso de IA no projeto

1. **Entregue o repositório documental inteiro**, não só os handoffs: aqui, o documento mais importante (`ARQUITETURA_TECNICA_ALM.md`) ficou de fora.
2. **Peça a fonte** de cada afirmação de plataforma (limite, preço, plano) e marque o que não tiver.
3. **Peça conferência contra o código** antes de aceitar um "estado atual". Os handoffs são bons, mas foram escritos em momentos diferentes e divergem entre si.
