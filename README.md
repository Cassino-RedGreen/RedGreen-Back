# Red & Green Cassino - API Backend

Responsável por gerenciar toda a inteligência e segurança do cassino, garantindo que a lógica dos jogos, a geração de números aleatórios (RNG) e as transações de fichas ocorram em um ambiente seguro e isolado.

---

## Índice

- [Funcionalidades](#funcionalidades)
- [Tecnologias e Ferramentas](#tecnologias-e-ferramentas)
- [Arquitetura](#arquitetura)
- [Pré-requisitos](#pré-requisitos)
- [Executando o Projeto](#executando-o-projeto)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Comandos Importantes](#comandos-importantes)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Pipeline de CI/CD](#pipeline-de-cicd)
- [Deploy](#deploy)
- [Testes](#testes)
- [Documentação da API](#documentação-da-api)
- [Histórias de Usuário](#histórias-de-usuário)
- [Metodologia de Desenvolvimento](#metodologia-de-desenvolvimento)
- [Dinâmica de Desenvolvimento](#dinâmica-de-desenvolvimento)
- [Autores](#autores)
- [Prompts](#prompts)

---

## Funcionalidades

- **Autenticação:** Gerenciamento de sessão de jogadores utilizando JWT.
- **Carteira:** Controle transacional e seguro das fichas (chips) dos usuários.
- **Motor de Regras:** Funcionamento dos jogos e cálculo de prêmios isolados do frontend (**Slot Machine** e **Gambit**).
- **Sessão única de plataforma:** Um jogador só pode ter **uma partida ativa por vez** em qualquer jogo, garantido por constraint no banco.
- **Histórico:** Registro de apostas e demais informações relevantes.

---

## Tecnologias e Ferramentas

| Categoria                    | Ferramentas                                      |
| ---------------------------- | ------------------------------------------------ |
| **Core**                     | NestJS 11, TypeScript                            |
| **Banco de Dados / ORM**     | PostgreSQL, TypeORM                              |
| **Autenticação**             | JWT (`@nestjs/jwt`), Passport                    |
| **Validação**                | class-validator, class-transformer               |
| **Documentação**             | Swagger (OpenAPI)                                |
| **Testes**                   | Jest, Supertest                                  |
| **Qualidade e Padronização** | ESLint, Prettier, Husky, Commitlint, lint-staged |
| **CI/CD**                    | Jenkins (Pipeline Multibranch)                   |
| **Deploy**                   | Render (API) + Neon (PostgreSQL)                 |
| **Infraestrutura Local**     | Docker / Docker Compose                          |

---

## Arquitetura

O projeto segue uma **arquitetura em camadas (layered/clean)**, organizada por domínio. Cada módulo é isolado e dividido nas seguintes camadas:

- **`domain/`** — Entidades (tabelas), DTOs, tipos e enums.
- **`application/`** — Regras de negócio (Services) e o motor dos jogos.
- **`presentation/`** — Controladores HTTP (rotas) e anotações do Swagger.

Os módulos de domínio são:

| Módulo             | Responsabilidade                                                                        |
| ------------------ | --------------------------------------------------------------------------------------- |
| **`auth`**         | Autenticação (JWT), usuários e carteira de fichas.                                      |
| **`slot-machine`** | Jogo Slot Machine e suas sessões.                                                       |
| **`gambit`**       | Jogo Gambit (motor de cartas: queima, eventos e efeitos) e suas sessões.                |
| **`sessions`**     | Registro de sessão única por usuário (lock de plataforma via `SessionRegistryService`). |

Código transversal (decorators, filters, guards) fica em `src/core/`.

---

## Pré-requisitos

Certifique-se de ter instalado em sua máquina:

- **Node.js 24** (a versão é fixada em [`.node-version`](.node-version))
- **Docker** (para subir o PostgreSQL localmente)

---

## Executando o Projeto

#### 1. Copie o arquivo `.env`

```bash
cp .env.example .env
```

#### 2. Instale as dependências do projeto

```bash
npm install
```

#### 3. Suba o container do banco (Docker)

```bash
docker-compose up -d
```

#### 4. Inicie o servidor do NestJS

```bash
npm run start:dev
```

#### 5. Acesse a Documentação (Swagger)

```
http://localhost:3000/api
```

---

## Variáveis de Ambiente

Definidas no `.env` (veja o template em [`.env.example`](.env.example)). A aplicação lê as variáveis `POSTGRES_*` individuais.

| Variável            | Descrição                                             | Exemplo                 |
| ------------------- | ----------------------------------------------------- | ----------------------- |
| `POSTGRES_HOST`     | Host do PostgreSQL                                    | `localhost`             |
| `POSTGRES_PORT`     | Porta do PostgreSQL                                   | `5433`                  |
| `POSTGRES_USER`     | Usuário do banco                                      | `postgres`              |
| `POSTGRES_PASSWORD` | Senha do banco                                        | `postgres`              |
| `POSTGRES_DB`       | Nome do banco                                         | `redgreen`              |
| `POSTGRES_SSL`      | Habilita TLS na conexão (use `true` em produção/Neon) | `false`                 |
| `JWT_SECRET`        | Segredo usado para assinar os tokens JWT              | _(gere um valor forte)_ |
| `PORT`              | Porta em que a API sobe                               | `3000`                  |

> Em produção (Render + Neon), o `POSTGRES_HOST` aponta para o host do Neon e `POSTGRES_SSL=true`.

---

## Comandos Importantes

| Comando                | Descrição                                           |
| ---------------------- | --------------------------------------------------- |
| `npm run start:dev`    | Sobe o servidor em modo _watch_ (desenvolvimento).  |
| `npm run start:prod`   | Sobe o servidor de produção (`node dist/main`).     |
| `npm run build`        | Compila o projeto (`nest build`).                   |
| `npm test`             | Executa os testes unitários (Jest).                 |
| `npm run test:cov`     | Executa os testes com relatório de cobertura.       |
| `npm run test:e2e`     | Executa os testes end-to-end.                       |
| `npm run lint`         | Roda o ESLint corrigindo automaticamente (`--fix`). |
| `npm run lint:check`   | Roda o ESLint apenas verificando (usado no CI).     |
| `npm run format`       | Formata o código com o Prettier (`--write`).        |
| `npm run format:check` | Verifica a formatação com o Prettier (usado no CI). |

---

## Estrutura do Projeto

```text
RedGreen-Back/
├── src/
│   ├── main.ts                 # Bootstrap (Nest + Swagger + ValidationPipe)
│   ├── app.module.ts           # Módulo raiz (TypeORM, JWT e módulos)
│   ├── core/                   # Código global (decorators, filters, guards)
│   └── modules/                # Domínios da aplicação
│       ├── auth/               # Autenticação (JWT), usuários e carteira
│       ├── slot-machine/       # Jogo Slot Machine + sessões
│       ├── gambit/             # Jogo Gambit (motor de cartas) + sessões
│       └── sessions/           # Sessão única por usuário (lock de plataforma)
│
├── test/                       # Testes (Jest)
├── Jenkinsfile                 # Pipeline de CI/CD (pipeline-as-code)
├── docker-compose.yml          # Container do PostgreSQL (local)
├── .node-version               # Versão do Node (24)
└── nest-cli.json               # Configurações do compilador
```

Cada módulo segue o padrão de camadas `domain/` · `application/` · `presentation/`.

---

## Pipeline de CI/CD

A pipeline é definida como código no [`Jenkinsfile`](Jenkinsfile) (raiz do projeto) e executada por um **Jenkins (Pipeline Multibranch)** hospedado numa instância **AWS EC2**.

- **Gatilho:** um **webhook do GitHub** dispara a pipeline a cada _push_ em qualquer branch e em _Pull Requests_.
- **Visibilidade:** o resultado aparece no GitHub como o check **`ci-cd/jenkins`** (ao lado do commit / dentro da PR).
- **Node:** fixado na versão **24** (`tools { nodejs 'node24' }`).

### Etapas (stages)

| Stage               | O que faz                                                         | Quando roda                 | Autor             |
| ------------------- | ----------------------------------------------------------------- | --------------------------- | ----------------- |
| **Dependencies**    | `npm ci` + `npm audit --audit-level=high`                         | sempre                      | Antonio Feliciano |
| **Lint and Format** | `npm run lint:check` (ESLint) + `npm run format:check` (Prettier) | sempre                      | Antonio Feliciano |
| **Tests**           | `npm test` (Jest)                                                 | sempre                      | Antonio Feliciano |
| **Build**           | `npm run build` (`nest build`)                                    | sempre                      | Antonio Feliciano |
| **Deploy**          | Dispara o deploy no Render (POST no _Deploy Hook_)                | **apenas na branch `main`** | Patrick Augusto   |

Os stages rodam **em ordem** — se qualquer um falha, a pipeline aborta e o deploy **não acontece**. O stage **Deploy** é protegido por `when { branch 'main' }`, então PRs e demais branches rodam **só o CI** (sem deploy). Ao final, o workspace é limpo (`cleanWs()`).

---

## Deploy

O deploy é **disparado pela própria pipeline**, somente quando o CI passa na branch `main`.

| Componente         | Serviço                                          | Observação                                                                                          |
| ------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **API**            | [Render](https://render.com) (Web Service)       | _Auto-deploy desligado_ — o deploy é acionado pelo stage **Deploy** do Jenkins via **Deploy Hook**. |
| **Banco de Dados** | [Neon](https://neon.com) (PostgreSQL serverless) | Persiste os dados; a API conecta via `POSTGRES_*` com `POSTGRES_SSL=true`.                          |

**Fluxo:** merge na `main` → CI passa (Lint, Tests, Build) → stage **Deploy** faz `curl` no Render Deploy Hook → o Render reconstrói e publica a nova versão.

---

## Testes

Execute todos os cenários automatizados Newman/Postman com um único comando:

```bash
npm run test:all
```

O comando executa apenas os cenários `test:api:*` em sequência, continuando mesmo
quando um cenário falha. Ao final, soma as estatísticas dos relatórios Newman em
uma única tabela com colunas `executed` e `failed` e linhas `iterations`,
`requests`, `test-scripts`, `prerequest-scripts` e `assertions`.
Testes Jest e de ferramentas não entram nessa execução.
Os logs completos e o resumo `summary.json` ficam em `test-results/<execução>/`.
O comando retorna código 1 se qualquer cenário falhar. Relatórios ausentes ou
inválidos são informados como erro e os totais são identificados como parciais.

Para os cenários de API, inicie previamente o PostgreSQL via Docker Compose e a
API local, com o `.env` configurado. Os cenários TC-003 e TC-005 utilizam também
acesso direto ao banco local.

Os testes são escritos com **Jest** (unitários, com mocks de repositórios e transações — não exigem banco real).

```bash
# todos os testes
npm test
```

---

## Documentação da API

A documentação interativa (Swagger / OpenAPI) é gerada automaticamente e fica disponível em:

```
/api
```

Localmente: `http://localhost:3000/api`.

---

## Histórias de Usuário

### História 1 — Cadastro de usuário · Prioridade: Alta

> Como **visitante**, eu quero criar uma conta com e-mail e senha para que eu possa acessar o cassino e receber meu saldo inicial de fichas.

**Critérios de aceitação:**

- **Dado** que estou na tela de cadastro, **quando** preencho e-mail válido e senha forte e confirmo, **então** minha conta é criada e recebo um saldo inicial de fichas.
- **Dado** que informo um e-mail já cadastrado, **quando** submeto, **então** recebo mensagem de erro e o cadastro não é concluído.
- **Dado** que a senha não atende às regras de validação, **quando** submeto, **então** o Zod bloqueia o envio e exibe o erro antes de chamar a API.

**Rastreabilidade:**

- **Back:** #2 (Feat/create user entity), #3 (Feat/auth user routes)
- **Front:** [#4](https://github.com/C14-INATEL/RedGreen-Front/pull/4) (Feat loginpage creation)

### História 2 — Reroll de slot · Prioridade: Alta

> Como **jogador do cassino**, eu quero selecionar um slot específico para realizar um reroll para que eu possa tentar melhorar minha combinação e aumentar minhas chances de obter uma recompensa maior.

**Critérios de aceitação:**

- **Dado** que possuo rerolls disponíveis, **quando** seleciono um dos slots permitidos, **então** o sistema destaca visualmente o slot escolhido.
- **Dado** que um slot foi selecionado, **quando** confirmo a ação de reroll, **então** apenas o slot escolhido executa novamente a animação de giro.
- **Dado** que o reroll foi concluído, **quando** o backend retorna o novo resultado, **então** o símbolo exibido no slot corresponde exatamente ao valor recebido.
- **Dado** que um reroll foi utilizado, **quando** a operação é concluída, **então** a quantidade restante de rerolls é atualizada na interface.
- **Dado** que não possuo mais rerolls disponíveis, **quando** tento realizar um novo reroll, **então** o sistema não permite a ação e mantém o estado atual dos slots.

**Rastreabilidade:**

- **Back:** #22 (Feat/integrating slot machines)
- **Front:** [#18](https://github.com/C14-INATEL/RedGreen-Front/pull/18) (Feat/adding logic to slot machine), [#21](https://github.com/C14-INATEL/RedGreen-Front/pull/21) (Feat/slot machine organization)

### História 3 — Ranking de jogadores · Prioridade: Média

> Como **jogador competitivo**, eu quero ver um ranking dos jogadores para que eu possa comparar meu desempenho com os demais.

**Critérios de aceitação:**

- **Dado** que existem jogadores cadastrados, **quando** acesso a tela de ranking, **então** vejo a lista ordenada pelo saldo de fichas.
- **Dado** que meu saldo é alterado, **quando** o ranking é recalculado, **então** minha posição reflete a mudança.

**Rastreabilidade:**

- **Back:** #17 (Feat/new user routes)
- **Front:** [#11](https://github.com/C14-INATEL/RedGreen-Front/pull/11) (Feat: homepage creation), [#30](https://github.com/C14-INATEL/RedGreen-Front/pull/30) (Feat: add rank route)

### História 4 — Bônus diário · Prioridade: Média

> Como **jogador autenticado**, eu quero resgatar meu bônus diário de fichas para que eu possa aumentar meu saldo e continuar jogando.

**Critérios de aceitação:**

- **Dado** que estou logado e ainda não resgatei o bônus do dia, **quando** acesso o painel de bônus diário, **então** vejo o dia atual da sequência e posso resgatar a recompensa.
- **Dado** que o bônus diário já foi resgatado, **quando** acesso o painel novamente, **então** o botão de resgate aparece bloqueado com a informação de que o bônus já foi coletado.
- **Dado** que o resgate é concluído com sucesso, **quando** a API retorna a recompensa, **então** o saldo de fichas é atualizado na interface.

**Rastreabilidade:**

- **Back:** #7 (feat/user-profile-routes)
- **Front:** [#15](https://github.com/C14-INATEL/RedGreen-Front/pull/15) (add-diary-rewards)

### História 5 — Gerenciamento de mesas de jogo · Prioridade: Alta

> Como **administrador**, eu quero criar, editar, desativar e remover mesas de jogo para que eu possa controlar quais mesas estarão disponíveis aos jogadores.

**Critérios de aceitação:**

- **Dado** que estou autenticado como administrador, **quando** acesso a tela de mesas, **então** vejo a opção de criar uma nova mesa.
- **Dado** que informo dados inválidos ao criar ou editar uma mesa, **quando** tento salvar, **então** recebo uma mensagem de erro e a operação não é concluída.
- **Dado** que uma mesa está ativa, **quando** tento excluí-la, **então** a exclusão fica bloqueada até que a mesa seja desativada.
- **Dado** que uma mesa possui sessões ativas, **quando** tento desativá-la, **então** o sistema exibe um aviso antes de concluir a operação.

**Rastreabilidade:**

- **Back:** #6 (feat/create-SlotMachine-entity), #8 (feat/admin-guard), #15 (fix/Slot-game-logic)
- **Front:** [#26](https://github.com/C14-INATEL/RedGreen-Front/pull/26) (feat-table-system)

---

## Metodologia de Desenvolvimento

No começo do desenvolvimento do projeto não chegamos a pensar e formalizar uma metodologia específica. Em vez disso, definimos alguns combinados para que o projeto progredisse da melhor maneira possível, adotando, na prática, um fluxo ágil informal e adaptado à realidade do grupo.

Começamos nos dividindo em 3 duplas, em que cada integrante seria responsável por validar e testar as Pull Requests da sua dupla. Cada dupla ficou responsável por um aspecto do projeto: uma com o front na parte de Interface e Integração de Usuário, outra com o front na parte de Motor Gráfico e Animações dos jogos, e a última com o backend — Regras de Negócio e Persistência de Dados.

Definimos também duas reuniões semanais, uma na terça-feira e outra na quinta-feira, cada uma com um intuito diferente. Na reunião de terça-feira, apresentávamos e explicávamos o que fizemos ao decorrer da semana para os outros e já alinhávamos quais seriam as próximas funções que faríamos. Nas de quinta-feira, nos reuníamos para colocar a mão na massa e progredir no projeto.

Nosso principal meio de comunicação foi o Discord, onde fazíamos as reuniões. Além disso, também usamos o WhatsApp para dar feedbacks mais informais e o próprio fluxo das PRs no GitHub, onde já apontávamos mais detalhadamente o que deveria ser mudado.

Vale destacar que não definimos uma Definição de Pronto (DoD) nem uma Definição de Preparado (DoR), e não tivemos sprints propriamente ditas — trabalhamos com uma cadência fixa de reuniões em vez de ciclos formais.

---

## Dinâmica de Desenvolvimento

As decisões técnicas foram tomadas, em sua maioria, pelas próprias duplas responsáveis por cada camada, já que cada uma tinha o maior contexto sobre o que estava construindo. Ainda assim, o feedback dos demais integrantes era sempre bem-vindo, principalmente no momento da revisão das Pull Requests, onde pontos de melhoria e abordagens alternativas eram discutidos abertamente. No início, as decisões sobre o que implementar foram guiadas por cobrir os requisitos pedidos no laboratório; conforme o projeto avançou, a priorização passou a ser orientada pela próxima funcionalidade que cada dupla precisava para destravar seu trabalho.

Para manter o histórico do repositório limpo e legível, estabelecemos um padrão obrigatório tanto para commits quanto para Pull Requests. Os commits seguiam o formato de tipo e descrição (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `style:`), e as branches seguiam a convenção `tipo/escopo-descrição-curta` (`feat/`, `bugfix/`, `hotfix/`, `chore/`). As Pull Requests também seguiam um modelo padronizado, com seções explicando o porquê e o que foi feito, como testar e as evidências de funcionamento. Esse padrão facilitou bastante a visualização do que cada PR entregava e tornou as revisões entre as duplas mais ágeis.

O maior desafio da dinâmica de desenvolvimento veio da criação do Gambit, um jogo completamente original concebido por nós. Por não ser baseado em um jogo já existente, não tínhamos, no início, uma definição clara de como ele deveria funcionar. Muitas regras e mecânicas só foram se consolidando ao longo do desenvolvimento, e novas ideias surgiam à medida que o jogo ganhava forma. Isso gerou atrasos e exigiu diversas alterações e refactors em código que já havia sido escrito, tanto no backend (regras de negócio e persistência) quanto no front (motor gráfico e fluxo de telas). Em vários momentos foi necessário voltar a partes já "prontas" para adaptá-las a uma nova decisão de design.

Esses ajustes também geraram bloqueios pontuais entre as duplas, já que mudanças na lógica do Gambit no backend impactavam diretamente o trabalho das duplas de front, que dependiam dessas definições para avançar. Nesses casos, nos reorganizamos priorizando as implementações que destravavam o trabalho das outras duplas.

A principal lição aprendida foi sobre a importância de definir melhor o escopo e as regras de uma funcionalidade original antes de começar a implementá-la. Boa parte dos refactors do Gambit poderia ter sido evitada com um planejamento inicial mais detalhado das mecânicas do jogo. Também percebemos que a ausência de uma Definição de Pronto (DoD) clara deixou alguns critérios de "terminado" subjetivos, e que adotá-la desde o início teria tornado as entregas mais previsíveis. Em um próximo projeto, investiríamos mais tempo no alinhamento de escopo logo no começo e formalizaríamos esses combinados que, neste projeto, ficaram apenas implícitos.

---

## Autores

Projeto desenvolvido pelas equipes de **Backend** (este repositório) e **Frontend** ([RedGreen-Front](https://github.com/C14-INATEL/RedGreen-Front)).

### Backend

| Autor                                   | GitHub                                         |
| --------------------------------------- | ---------------------------------------------- |
| Patrick Augusto Lins de Oliveira Damião | [@Pack0042](https://github.com/Pack0042)       |
| Antonio Feliciano                       | [@AntonioFSN2](https://github.com/AntonioFSN2) |

### Frontend

| Autor                         | GitHub                                               |
| ----------------------------- | ---------------------------------------------------- |
| Danilo Henrique Maia da Silva | [@DaniloSilva31](https://github.com/DaniloSilva31)   |
| Pedro Henrique Andrade        | [@phandrad3](https://github.com/phandrad3)           |
| Pedro Armengol de Oliveira    | [@Armengolz](https://github.com/Armengolz)           |
| Pedro R. Nogueira             | [@PedroRNogueira](https://github.com/PedroRNogueira) |

---

## Prompts

Esta seção documenta os principais _prompts_ utilizados com ferramentas de IA durante o desenvolvimento, para fins de transparência e rastreabilidade.

### Patrick Augusto Lins de Oliveira Damião

Foi utilizado o Claude Code, sempre com o contexto do README explicando a estrutura do projeto (com foco na stack) e o PDF com as orientações da tarefa.

> **Prompt:** "Estou desenvolvendo um projeto (Backend/Frontend) e preciso do setup inicial com base na stack que enviei. Pode dar uma olhada no README e criar a base do projeto?"

Gerou um bom resultado a partir do README que montamos antes de dar início ao desenvolvimento do projeto tanto no back quanto no front, só precisou de alguns ajustes na estrutura e a mudança de algumas lógicas. A maioria do que foi executado foram os comandos de inicialização dessa stack, mas ela agilizou bastante o processo. Também deixei de fora a parte sobre testes e pipeline durante a criação inicial, já que essas partes seriam feitas futuramente.

> **Prompt:** "Poderia criar testes para cobrir a lógica do jogo?"

Mais uma vez a IA mostrou não ser muito boa em gerar testes unitários, alguns fazem bastante sentido mas a grande maioria (principalmente em casos mais complexos, como esses da lógica de jogo) acaba gerando testes redundantes ou que nem sequer se encaixam no contexto.

> **Prompt:** "Gere uma versão atualizada do README com as mudanças que fizemos, incluíndo a nova pipeline, onde estamos hospedando os serviços, os autores, novas funcionalidades e etc..."

Resultado foi muito bom, separou o README em índices e descreveu muito bem os processos. Quase não foram necessários ajustes.

### Antonio Feliciano

**Prompt 1 — Implementação de código (espelhando padrão existente)**

- **Modelo:** Claude (extensão VSCode)
- **Resumo do prompt:** "Adicionar um campo TableColor ao GambitTable (NestJS + TypeORM + PostgreSQL), reaproveitando o enum de cor que já existe no módulo de slot machine. Antes de qualquer mudança, ler os arquivos relevantes. NÃO criar migration (o projeto usa synchronize). Promover o enum SlotMachineColor para um local compartilhado e renomeá-lo para GameTableColor, atualizando todas as referências. Usar PascalCase em todos os nomes. Espelhar exatamente como TableColor funciona no SlotMachine. Não deixar código morto, comentado ou imports não usados."
- **Resultado:** Ajustado. Gerou o refactor seguindo a maior parte dos padrões pedidos, mas revisei manualmente as referências do enum e os testes, corrigindo pontos que não bateram com o resto do código antes de commitar.
- **Observação:** Esse nível de detalhe no prompt foi resultado direto do problema que tive antes com ChatGPT/Copilot ignorando PascalCase — passei a explicitar as regras.

**Prompt 2 — Configuração de CI/CD (com pushback)**

- **Modelo:** Claude (extensão VSCode)
- **Resumo do prompt:** "Adicionar stages de qualidade (dependências, lint+format, testes, build) antes do Deploy no Jenkinsfile, sem alterar o stage de Deploy existente."
- **Resultado:** Ajustado. A proposta inicial foi útil, mas rejeitei a sugestão de aumentar o timeout de 5 para 15 minutos (mantive 5), pedi para deixar as strings do Jenkinsfile em inglês, e troquei o stage de testes de cobertura (test:cov) para testes unitários (npm test), que era o que realmente queríamos.
- **Observação:** Bom exemplo de que a IA propõe, mas a decisão final foi do grupo.

**Prompt 3 — Documentação (este README)**

- **Modelo:** Claude (chat)
- **Resumo do prompt:** "Estou escrevendo a parte de dinâmica de desenvolvimento do README e quero priorizar a honestidade. Vou mandar o que escrevi de cabeça e gostaria de um feedback, principalmente se ficou bom e se faltou algo."
- **Resultado:** Ajustado. Usei o feedback para reorganizar o texto e cobrir itens que faltavam (conflitos/bloqueios, lições aprendidas), mas o conteúdo factual — como as coisas realmente aconteceram no grupo — foi escrito por mim.
