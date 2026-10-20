# ALLM — arquitetura vigente e escopo do banco (15/10/2026)

**Decisão vigente da equipe:** este documento prevalece sobre descrições
antigas que tratem Google Sheets como persistência principal ou Vercel como
requisito de implementação. Distinguir sempre **código atual**, **banco já
aplicado** e **arquitetura alvo**. Este documento não é uma migration.

## Arquitetura alvo

```text
Frontend React/Vite (desenvolvimento local)
    -> /api/v1 (backend Node.js local)
        -> PostgreSQL/Supabase (fonte oficial dos dados operacionais)
        -> Google Drive (bytes de anexos)
```

- **Supabase/PostgreSQL:** única fonte principal dos dados estruturados:
  usuários, perfis, matrículas/PIN (hash), sessões, recebimentos, itens,
  chegadas de portaria, divergências, histórico, auditoria e metadados /
  vínculos dos arquivos.
- **Google Drive:** guarda os **bytes** dos documentos e fotos; o banco
  contém metadados e referências. Não guardar binários no Sheets.
- **Google Sheets:** persistência **legada do backend atual**; migrar com
  segurança para PostgreSQL. **Não implementar** novos espelhos,
  sincronizações, eventos nem jobs direcionados a Sheets.
- **Consulta tipo planilha:** visualização **somente leitura** no dashboard,
  feita pelo frontend; dados vêm da API/PostgreSQL.
- **Exportação:** CSV gerado pela aplicação sobre dados da API/PostgreSQL;
  não requer exportação nem gravação em Sheets.
- **Vercel:** fora da arquitetura e do desenvolvimento atual. Desenvolver
  e validar **frontend e backend localmente**. Publicação/hospedagem será
  decisão posterior, se necessária. Não escolher migrations, pools, jobs,
  endpoints ou contratos por pressupostos de Vercel Functions/Cron/Preview.
- **Conexões Supavisor:** testes técnicos Session :5432 / Transaction :6543
  permaneceram válidos; selecionar modo de conexão conforme requisitos do
  driver e carga reais, **não** como dependência da Vercel.
- **Autenticação de pessoas:** matrícula + PIN e sessão verificada pelo
  backend. O navegador não recebe segredo do banco nem conecta ao
  PostgreSQL diretamente.
- **Domínio:** Portaria registra CHG; Almoxarifado trabalha com REC.
  Preservar distinções, integridade e relação CHG/REC.

## Situação atual, diferente da arquitetura alvo

1. O backend da branch atual ainda contém
   `backend/repositories/recebimentosRepository.mjs` com persistência em
   Sheets e `backend/integrations/googleSheets.mjs`; sua configuração
   `backend/config/env.mjs` ainda pede planilha. **Isso é legado a migrar
   pelo responsável pelo backend**, não autorização para novas integrações
   Sheets. Nenhum arquivo de backend foi editado nesta rodada.
2. Staging autorizado Supabase `Almoxarifado ALM`,
   ID `uxfstabcpvmujvzijyqw`, PostgreSQL 17.11: 11 migrations de
   domínio e 1 bootstrap de logins técnicos, 28 tabelas e 28 policies RLS
   validadas. Os dois logins técnicos passaram em ambos os modos do pooler.
   **Isso não torna o login funcional matrícula+PIN implementado no backend.**
3. A migration histórica
   `20261007160100_alm2_delta.sql` **já aplicada** criou estruturas ligadas
   a Sheets. Preservá-la exatamente como foi aplicada para não romper
   checksums e instalações limpas. A existência desses objetos não significa
   que Sheets continue fazendo parte da arquitetura alvo.

## Inventário de legado SQL e dependências conhecidas

| Objeto do banco | Estado histórico | Direção |
|---|---|---|
| `alm.espelho_sheets` | Tabela de estado de sincronização | Legado a analisar para desativação/remoção futura |
| `alm.outbox.tipo = 'SHEETS_ESPELHO'` | Valor permitido por CHECK | Valor legado; **não** criar novo produtor ou consumidor |
| `alm.exportacoes.formato = 'GOOGLE_SHEETS'` | Valor permitido por CHECK | Substituir por exportação CSV na aplicação, após análise |
| `alm.outbox` | Fila inclui também eventos `DRIVE_*` | **Preservar**: pode servir à orquestração do Drive |
| `alm.exportacoes` | Também aceita `CSV` | **Preservar** se necessário para auditoria/registro de exportação |

Os testes versionados em `supabase/tests/database.sql` ainda exercitam
`SHEETS_ESPELHO` e `alm.espelho_sheets`, pois validam a migration
histórica aplicada. Eles **não** devem ser usados para justificar uma
integração nova. Ao introduzir migration de retirada de legado, ajustar
a suíte conjuntamente e manter a instalação limpa validada.

## Próxima mudança de schema: somente após análise

Antes de escrever/aplicar migration de desativação/remoção:

1. Inspecionar no **código atual e no staging autorizado** dependências
   SQL, functions, triggers, grants, RLS, filas, dados preexistentes e
   processos que consultem `alm.espelho_sheets`, `SHEETS_ESPELHO` ou
   `GOOGLE_SHEETS`. Sem executar alterações.
2. Combinar com responsável pelo backend quando cessar escritas legadas
   no Sheets e o plano de migração/recuperação dos dados existentes.
3. Propor **uma nova migration versionada** que retire ou restrinja apenas
   o legado, preservando `outbox` para eventos de Drive e `CSV` onde
   apropriado. Verificar compatibilidade e rollback em PostgreSQL local.
4. Atualizar testes e documentação com nova condição esperada. Rodar
   testes locais e submeter PR para revisão.
5. **Não executar** `DROP TABLE`, alterar CHECKs, reescrever migrations
   antigas ou aplicar DDL no Supabase staging sem autorização expressa.

## Divisão de responsabilidades e fluxo Git

- **Kobner:** `supabase/`, esquema PostgreSQL, migrations, integridade,
  soft delete, roles, RLS, estruturas de autenticação/sessão, testes SQL e
  documentação do contrato para o backend.
- **Goran:** migração de persistência do backend para PostgreSQL; acesso
  do backend ao Drive.
- **Lucas:** frontend, scanner, visualização tipo planilha e experiência de
  login.
- Trabalhar em **branch própria**; propor alterações por **Pull Request**.
  Nunca realizar push direto na `main`.
- Antes de alterar `backend/`, `src/`, `api/`, deploy ou outros projetos
  Supabase, **avisar a equipe e aguardar confirmação**.

## Referências

- `supabase/migrations/REVISAO_BANCO.md` — histórico técnico aplicado.
- `supabase/tests/CONTRATO_MATRICULA_PIN.md` — contrato de auth.
- `supabase/tests/HANDOFF_BACKEND_MATRICULA_PIN.md` — integração do backend.
- `supabase/tests/STAGING_LOGINS_RUNBOOK.md` — evidências de conexões técnicas.
