Prompt pronto (v2) — Sistema de Registro de Recebimento de Materiais (Projeto ALM)

Atue como especialista em análise de processos, UX/UI, gestão de materiais e desenvolvimento de sistemas corporativos.

Preciso projetar uma ferramenta digital para registro, controle e consulta do recebimento de materiais do Almoxarifado, substituindo um processo atualmente baseado em planilha, e-mails, grupo de WhatsApp, digitalização de documentos e pastas de rede.

1. Contexto atual (processo real, confirmado)

Hoje o processo de recebimento envolve:

Escanear a cópia da Nota Fiscal com carimbo da Portaria Fiscal, DACTE, impressão do Pedido de Compra e demais registros;
Fotografar, usando um grupo de WhatsApp, os volumes recebidos e detalhes dos materiais (quantidade física, etiquetas, marcas, condições);
Criar manualmente pastas na rede corporativa (hoje em L:\Compartilhado\Suprimentos\Suprimentos\NFE's) para armazenar os registros;
Receber documentos digitalizados por e-mail e salvá-los manualmente na rede;
Reenviar as fotos do grupo de WhatsApp para e-mail e depois salvá-las na pasta correspondente;
Controlar os materiais por meio de uma planilha com as colunas: Item, Quantidade, Unidade, Descrição, Pedido, Nº NF/documento, Data de Recebimento, Fornecedor, Tipo, Observações.

Limitações identificadas na planilha atual (usar como diagnóstico, não como modelo a copiar):

Não existe campo de Responsável — quem lançou o recebimento hoje é anotado, às vezes, dentro do campo "Observações" (informal e inconsistente).
Não existe campo de Status — o acompanhamento de conferência/divergência/pendência é feito de memória ou por fora do sistema.
"Unidade" e "Tipo" já seguem padrões na prática (ex.: PÇ, UN, kg / Estoque, Débito Direto), mas são digitados livremente, sem lista de valores controlada.
O número da NF/documento às vezes fica em branco no momento do lançamento (chega depois) — a obrigatoriedade desse campo precisa ser condicional/em duas etapas, não bloqueante na criação do registro.

O objetivo do projeto é simplificar esse processo, permitindo upload de fotos e documentos, armazenamento seguro com acesso restrito e pesquisa rápida das informações — eliminando a dependência do grupo de WhatsApp e do reenvio manual por e-mail.

2. Estrutura principal dos registros

Cada recebimento deverá possuir, no mínimo, os seguintes campos:

Item
Quantidade
Unidade (lista controlada e configurável — ex.: PÇ, UN, KG, M, valores já em uso na planilha atual)
Descrição do material
Pedido de Compra (considerar, se existir ERP de origem desses números, integração/consulta futura em vez de digitação livre)
Número da NF/documento — obrigatório para fechamento do registro, mas pode ficar pendente no momento da criação (documento chega depois)
Data de recebimento
Fornecedor
Tipo de recebimento (lista controlada e configurável)
Estoque
Débito Direto
Outros tipos configuráveis
Responsável (usuário autenticado, preenchido automaticamente — não mais digitado em "Observações")
Status do recebimento (obrigatório, com fluxo definido — ver abaixo)
Observações
Fotos do material
Nota Fiscal
DACTE
Pedido de Compra (arquivo)
Demais documentos relacionados

O sistema deve permitir que um mesmo pedido tenha diversos itens, mantendo todos vinculados ao mesmo processo de recebimento.

Fluxo de Status sugerido: Em digitação → Aguardando documentação → Em conferência → Divergência identificada → Conferido/Finalizado. Definir quem pode mover cada status (ex.: Almoxarifado abre e conclui; Suprimentos resolve divergências).

3. Fluxo desejado

Estruture um processo no qual o usuário consiga:

Criar um novo registro de recebimento;
Informar ou pesquisar o número do Pedido de Compra;
Cadastrar os materiais recebidos;
Informar quantidade, unidade, fornecedor, tipo e data;
Tirar fotos diretamente pelo celular ou fazer upload de imagens;
Fazer upload da NF, DACTE, Pedido de Compra e demais documentos (podendo ficar como pendência se ainda não chegaram);
Adicionar observações e divergências encontradas;
Confirmar o responsável pelo recebimento (preenchido automaticamente pelo usuário logado);
Finalizar o registro, movendo o status conforme o fluxo definido;
Armazenar automaticamente todos os documentos e fotos vinculados ao recebimento;
Permitir consultas posteriores de maneira rápida.
4. Tela principal

Crie uma tela de consulta inspirada na planilha atual, utilizando uma tabela com colunas como:

Item | Quantidade | Unidade | Descrição | Pedido | NF | Data Recebimento | Fornecedor | Tipo | Responsável | Status | Observações

A tabela deverá permitir:

Pesquisa por palavra-chave;
Filtros (incluindo por Status e por registros com NF pendente);
Ordenação;
Paginação;
Filtro por período;
Pedido;
Item;
Fornecedor;
Tipo de recebimento;
Responsável;
Status;
Exportação para Excel (compatível com o formato da planilha atual, para transição suave);
Abertura do registro completo ao clicar em uma linha.
5. Tela de detalhes

Ao abrir um recebimento, apresente:

Dados gerais;
Lista de itens recebidos;
Quantidade solicitada e quantidade recebida, quando essas informações estiverem disponíveis;
Fornecedor;
Pedido;
Data;
Responsável;
Status atual e histórico de mudanças de status;
Observações;
Galeria de fotos;
Documentos anexados (com indicação clara de quais ainda estão pendentes);
Histórico de alterações;

Crie também uma área específica para registrar divergências, como:

Quantidade incorreta;
Material avariado;
Material diferente do solicitado;
Falta de documentação;
Problema de embalagem;
Outros.
6. Segurança e rastreabilidade

O sistema deverá possuir autenticação e níveis de acesso.

Considere perfis como:

Administrador
Almoxarifado
Suprimentos
Consulta

Registre automaticamente:

Usuário que criou o recebimento;
Data e hora;
Usuário que alterou;
Data da alteração;
Arquivos incluídos ou removidos;
Mudanças de status.

Não permitir exclusão definitiva de informações importantes sem autorização administrativa.

7. Experiência mobile

Como parte do processo ocorre fisicamente no recebimento de materiais, o sistema precisa funcionar muito bem em celular e tablet.

No celular, priorize:

Botões grandes;
Poucos campos por etapa;
Uso da câmera;
Upload rápido, com possibilidade de anexar várias fotos de uma vez (substituindo o grupo de WhatsApp);
Salvamento automático;
Visualização simples dos itens do pedido.

A intenção é eliminar a necessidade de utilizar o grupo de WhatsApp e o e-mail para transferir fotos e documentos.

8. Organização dos arquivos

Proponha uma estrutura automática para armazenamento dos documentos, evitando que o usuário tenha que criar pastas manualmente (hoje feito à mão em L:\Compartilhado\Suprimentos\Suprimentos\NFE's).

Estrutura sugerida:

Recebimentos / Ano / Mês / Fornecedor / Pedido /

Dentro de cada registro, classifique os anexos como:

Nota Fiscal;
DACTE;
Pedido;
Fotos;
Certificados;
Outros documentos.

Incluir um plano de migração/importação do histórico já salvo na pasta de rede atual, para não perder os registros existentes.

9. Dashboard

Crie um painel gerencial mostrando, por exemplo:

Total de recebimentos no período;
Materiais recebidos hoje;
Recebimentos por fornecedor;
Recebimentos por tipo;
Pedidos com divergências;
Registros com documentação pendente;
Registros por status;
Evolução mensal dos recebimentos.
10. Automação

Identifique oportunidades para automatizar o processo, incluindo, quando tecnicamente viável:

Preenchimento automático da data;
Identificação automática do usuário (Responsável);
Geração automática da estrutura de armazenamento;
Notificação quando houver divergência;
Aviso quando faltar algum documento obrigatório;
Vinculação automática entre Pedido, NF e fornecedor;
Geração de protocolo de recebimento;
Histórico/auditoria automática;
Integração com o ERP de origem dos Pedidos de Compra, se existir, para evitar digitação manual do número do pedido;
Leitura automática de dados da NF (OCR) — tratar como evolução futura (fase 2), não pré-requisito do MVP, dado que o processo atual é 100% manual/escaneado.
11. Resultado que quero de você

Com base nesses requisitos, produza uma proposta completa contendo:

A. Diagnóstico do processo atual Identifique tarefas manuais, retrabalho, riscos e gargalos.

B. Processo futuro (TO-BE) Apresente o fluxo otimizado passo a passo.

C. Arquitetura da solução Explique os módulos necessários e como se relacionam.

D. Estrutura do banco de dados Defina as principais entidades/tabelas, campos, relacionamentos e chaves.

E. Protótipo das telas Descreva detalhadamente cada tela e sua organização visual.

F. Regras de negócio Liste validações, permissões, obrigatoriedades (inclusive quais são condicionais, como o número da NF) e situações excepcionais.

G. Automações Explique quais etapas podem ser automatizadas, separando o que é viável agora do que depende de OCR/integração externa.

H. Segurança Defina permissões, armazenamento, auditoria e rastreabilidade.

I. MVP Separe o que é essencial para a primeira versão do que pode ser implementado posteriormente (deixando OCR de NF e integração com ERP como fase 2).

J. Plano de implementação Divida o projeto em fases, desde protótipo até implantação, incluindo a migração dos registros históricos da pasta de rede atual.

12. Diretrizes

A solução deve ser:

Simples para o usuário do Almoxarifado;
Responsiva para computador, celular e tablet;
Fácil de pesquisar;
Segura;
Rastreável;
Capaz de centralizar fotos e documentos;
Preparada para crescer;
Mais eficiente que o uso atual de Excel + grupo de WhatsApp + e-mail + pastas de rede.

Antes de sugerir tecnologias, desenvolva primeiro o fluxo funcional e a experiência do usuário. Depois apresente 2 ou 3 alternativas tecnológicas, comparando custo, complexidade, manutenção, segurança e facilidade de implantação.

O que mudou em relação à v1 (resumo das correções)
Responsável deixa de ser algo anotado informalmente em "Observações" e vira campo obrigatório, preenchido pelo usuário logado.
Status ganha um fluxo definido (5 estados), em vez de aparecer só como coluna sem regra.
Unidade e Tipo viram listas de valores controladas, baseadas nos valores já usados na planilha real (PÇ, UN, kg / Estoque, Débito Direto).
Número da NF passa a ser obrigatoriedade condicional — pode ficar pendente no lançamento inicial, já que na prática às vezes chega depois.
Processo atual reformulado para citar o grupo de WhatsApp especificamente (não WhatsApp em geral) — é o gargalo social real a substituir.
Caminho de rede real (L:\Compartilhado\Suprimentos\Suprimentos\NFE's) citado como referência para um plano de migração do histórico.
Sugerida investigação de integração com ERP para os números de Pedido, em vez de tratá-los como digitação livre do zero.
OCR de NF reclassificado como fase 2, não MVP, por ser um salto técnico grande frente a um processo hoje 100% manual.