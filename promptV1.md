### Prompt pronto — Sistema de Registro de Recebimento de Materiais

> **Atue como especialista em análise de processos, UX/UI, gestão de materiais e desenvolvimento de sistemas corporativos.**
>
> Preciso projetar uma **ferramenta digital para registro, controle e consulta do recebimento de materiais**, substituindo um processo atualmente baseado em planilha, e-mails, WhatsApp, digitalização de documentos e pastas de rede.
>
> ### 1. Contexto atual
>
> Hoje o processo de recebimento envolve:
>
> * Digitalizar a cópia da **Nota Fiscal com carimbo da Portaria Fiscal**, DACTE, pedido de compra e demais documentos;
> * Fotografar pelo celular/WhatsApp os **volumes recebidos e os detalhes dos materiais**, como quantidade física, etiquetas, marcas e condições;
> * Criar manualmente pastas na rede corporativa para armazenar os registros;
> * Receber documentos digitalizados por e-mail e salvá-los manualmente;
> * Enviar fotos do WhatsApp para o e-mail e depois salvá-las na pasta correspondente;
> * Controlar os materiais por meio de uma planilha semelhante à apresentada.
>
> O objetivo do projeto é simplificar esse processo, permitindo upload de fotos e documentos, armazenamento seguro com acesso restrito e pesquisa rápida das informações. 
>
> ### 2. Estrutura principal dos registros
>
> Cada recebimento deverá possuir, no mínimo, os seguintes campos:
>
> * **Item**
> * **Quantidade**
> * **Unidade**
> * **Descrição do material**
> * **Pedido de Compra**
> * **Número da NF/documento**, quando disponível
> * **Data de recebimento**
> * **Fornecedor**
> * **Tipo de recebimento**
>
>   * Estoque
>   * Débito Direto
>   * Outros tipos configuráveis
> * **Responsável**
> * **Observações**
> * **Fotos do material**
> * **Nota Fiscal**
> * **DACTE**
> * **Pedido de Compra**
> * **Demais documentos relacionados**
>
> O sistema deve permitir que **um mesmo pedido tenha diversos itens**, mantendo todos vinculados ao mesmo processo de recebimento.
>
> ### 3. Fluxo desejado
>
> Estruture um processo no qual o usuário consiga:
>
> 1. Criar um novo registro de recebimento;
> 2. Informar ou pesquisar o número do Pedido de Compra;
> 3. Cadastrar os materiais recebidos;
> 4. Informar quantidade, unidade, fornecedor, tipo e data;
> 5. Tirar fotos diretamente pelo celular ou fazer upload de imagens;
> 6. Fazer upload da NF, DACTE, Pedido de Compra e demais documentos;
> 7. Adicionar observações e divergências encontradas;
> 8. Identificar o responsável pelo recebimento;
> 9. Finalizar o registro;
> 10. Armazenar automaticamente todos os documentos e fotos vinculados ao recebimento;
> 11. Permitir consultas posteriores de maneira rápida.
>
> ### 4. Tela principal
>
> Crie uma tela de consulta inspirada na planilha atual, utilizando uma tabela com colunas como:
>
> **Item | Quantidade | Unidade | Descrição | Pedido | NF | Data Recebimento | Fornecedor | Tipo | Responsável | Observações | Status**
>
> A tabela deverá permitir:
>
> * Pesquisa por palavra-chave;
> * Filtros;
> * Ordenação;
> * Paginação;
> * Filtro por período;
> * Pedido;
> * Item;
> * Fornecedor;
> * Tipo de recebimento;
> * Responsável;
> * Status;
> * Exportação para Excel;
> * Abertura do registro completo ao clicar em uma linha.
>
> ### 5. Tela de detalhes
>
> Ao abrir um recebimento, apresente:
>
> * Dados gerais;
> * Lista de itens recebidos;
> * Quantidade solicitada e quantidade recebida, quando essas informações estiverem disponíveis;
> * Fornecedor;
> * Pedido;
> * Data;
> * Responsável;
> * Observações;
> * Galeria de fotos;
> * Documentos anexados;
> * Histórico de alterações;
> * Status do recebimento.
>
> Crie também uma área específica para registrar **divergências**, como:
>
> * Quantidade incorreta;
> * Material avariado;
> * Material diferente do solicitado;
> * Falta de documentação;
> * Problema de embalagem;
> * Outros.
>
> ### 6. Segurança e rastreabilidade
>
> O sistema deverá possuir autenticação e níveis de acesso.
>
> Considere perfis como:
>
> * **Administrador**
> * **Almoxarifado**
> * **Suprimentos**
> * **Consulta**
>
> Registre automaticamente:
>
> * Usuário que criou o recebimento;
> * Data e hora;
> * Usuário que alterou;
> * Data da alteração;
> * Arquivos incluídos ou removidos;
> * Mudanças de status.
>
> Não permitir exclusão definitiva de informações importantes sem autorização administrativa.
>
> ### 7. Experiência mobile
>
> Como parte do processo ocorre fisicamente no recebimento de materiais, o sistema precisa funcionar muito bem em **celular e tablet**.
>
> No celular, priorize:
>
> * Botões grandes;
> * Poucos campos por etapa;
> * Uso da câmera;
> * Upload rápido;
> * Salvamento automático;
> * Possibilidade de anexar várias fotos;
> * Visualização simples dos itens do pedido.
>
> A intenção é **reduzir ou eliminar a necessidade de utilizar WhatsApp e e-mail para transferir as fotos e documentos**.
>
> ### 8. Organização dos arquivos
>
> Proponha uma estrutura automática para armazenamento dos documentos, evitando que o usuário tenha que criar pastas manualmente.
>
> Por exemplo:
>
> `Recebimentos / Ano / Mês / Fornecedor / Pedido /`
>
> Dentro de cada registro, classifique os anexos como:
>
> * Nota Fiscal;
> * DACTE;
> * Pedido;
> * Fotos;
> * Certificados;
> * Outros documentos.
>
> Os arquivos devem permanecer vinculados ao registro correspondente no sistema.
>
> ### 9. Dashboard
>
> Crie um painel gerencial mostrando, por exemplo:
>
> * Total de recebimentos no período;
> * Materiais recebidos hoje;
> * Recebimentos por fornecedor;
> * Recebimentos por tipo;
> * Pedidos com divergências;
> * Registros pendentes;
> * Quantidade de ocorrências;
> * Evolução mensal dos recebimentos.
>
> ### 10. Automação
>
> Identifique oportunidades para automatizar o processo, incluindo, quando tecnicamente viável:
>
> * Preenchimento automático da data;
> * Identificação automática do usuário;
> * Geração automática da estrutura de armazenamento;
> * Notificação quando houver divergência;
> * Aviso quando faltar algum documento obrigatório;
> * Leitura de dados da NF;
> * Vinculação automática entre Pedido, NF e fornecedor;
> * Geração de protocolo de recebimento;
> * Histórico/auditoria automática.
>
> ### 11. Resultado que quero de você
>
> Com base nesses requisitos, produza uma proposta completa contendo:
>
> **A. Diagnóstico do processo atual**
> Identifique tarefas manuais, retrabalho, riscos e gargalos.
>
> **B. Processo futuro (TO-BE)**
> Apresente o fluxo otimizado passo a passo.
>
> **C. Arquitetura da solução**
> Explique os módulos necessários e como se relacionam.
>
> **D. Estrutura do banco de dados**
> Defina as principais entidades/tabelas, campos, relacionamentos e chaves.
>
> **E. Protótipo das telas**
> Descreva detalhadamente cada tela e sua organização visual.
>
> **F. Regras de negócio**
> Liste validações, permissões, obrigatoriedades e situações excepcionais.
>
> **G. Automações**
> Explique quais etapas podem ser automatizadas.
>
> **H. Segurança**
> Defina permissões, armazenamento, auditoria e rastreabilidade.
>
> **I. MVP**
> Separe o que é essencial para a primeira versão do que pode ser implementado posteriormente.
>
> **J. Plano de implementação**
> Divida o projeto em fases, desde protótipo até implantação.
>
> ### 12. Diretrizes
>
> A solução deve ser:
>
> * Simples para o usuário do Almoxarifado;
> * Responsiva para computador, celular e tablet;
> * Fácil de pesquisar;
> * Segura;
> * Rastreável;
> * Capaz de centralizar fotos e documentos;
> * Preparada para crescer;
> * Mais eficiente que o uso atual de Excel + WhatsApp + e-mail + pastas de rede.
>
> **Antes de sugerir tecnologias, desenvolva primeiro o fluxo funcional e a experiência do usuário. Depois apresente 2 ou 3 alternativas tecnológicas, comparando custo, complexidade, manutenção, segurança e facilidade de implantação.**

Esse prompt transforma tanto a **planilha da imagem** quanto o objetivo descrito no projeto em requisitos para uma solução completa de recebimento de materiais. A principal evolução é não tratar a necessidade apenas como uma “planilha melhor”, mas como um fluxo centralizado de **Pedido → itens → recebimento → fotos/documentos → consulta → rastreabilidade**.
