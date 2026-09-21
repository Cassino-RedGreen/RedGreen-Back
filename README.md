# Red & Green Cassino - API Backend

[![CI/CD](https://github.com/Cassino-RedGreen/RedGreen-Back/actions/workflows/ci.yml/badge.svg)](https://github.com/Cassino-RedGreen/RedGreen-Back/actions/workflows/ci.yml)

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
- [Refatorações](#refatorações)
- [Autores](#autores)
- [Uso de IA](#Uso-de-IA)

---

## Funcionalidades

- **Autenticação:** Gerenciamento de sessão de jogadores utilizando JWT.
- **Carteira:** Controle transacional e seguro das fichas (chips) dos usuários.
- **Motor de Regras:** Funcionamento dos jogos e cálculo de prêmios isolados do frontend (**Slot Machine** e **Gambit**).
- **Sessão única de plataforma:** Um jogador só pode ter **uma partida ativa por vez** em qualquer jogo, garantido por constraint no banco.
- **Histórico:** Registro de apostas e demais informações relevantes.

---

## Tecnologias e Ferramentas

| Categoria                    | Ferramentas                                         |
| ---------------------------- | --------------------------------------------------- |
| **Core**                     | NestJS 11, TypeScript                               |
| **Banco de Dados / ORM**     | PostgreSQL, TypeORM                                 |
| **Autenticação**             | JWT (`@nestjs/jwt`), Passport                       |
| **Validação**                | class-validator, class-transformer                  |
| **Documentação**             | Swagger (OpenAPI)                                   |
| **Testes**                   | Jest, ts-jest, Newman/Postman, node:test, Supertest |
| **Qualidade e Padronização** | ESLint, Prettier, Husky, Commitlint, lint-staged    |
| **CI/CD**                    | GitHub Actions                                      |
| **Deploy**                   | Render (API) + Neon (PostgreSQL)                    |
| **Infraestrutura Local**     | Docker / Docker Compose                             |

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
docker compose up -d
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
| `npm run test:e2e`     | Configuração Jest E2E, ainda sem casos.             |
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
└── test/
    ├── api/
    │   ├── reports/
    │   ├── api-report-path.cjs
    │   ├── redgreen-api.postman_collection.json
    │   ├── redgreen.local.postman_environment.json
    │   ├── run-api-case.cjs
    │   ├── run-newman-case.cjs
    │   ├── run-tc003.cjs
    │   ├── run-tc005.cjs
    │   ├── run-tc006.cjs
    │   ├── run-tc007.cjs
    │   ├── run-tc008.cjs
    │   ├── run-tc009.cjs
    │   └── run-tc010.cjs
    │
    ├── tooling/
    ├── app.controller.spec.ts
    ├── auth.service.spec.ts
    ├── gambit-session.service.spec.ts
    ├── gambit-table.service.spec.ts
    ├── jest-e2e.json
    ├── session-management.spec.ts
    ├── session-registry.service.spec.ts
    ├── slot-machine.service.spec.ts
    └── slot-session.service.spec.ts
```

Cada módulo segue o padrão de camadas `domain/` · `application/` · `presentation/`.

---

## Pipeline de CI/CD

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) executa no GitHub Actions com Node definido em [`.node-version`](.node-version), cache npm e instalação por `npm ci`. O badge no topo abre as execuções do workflow.

Os gatilhos são pushes em qualquer branch, PRs de forks e execução manual. PRs internas são cobertas pelo push para evitar execuções duplicadas. Um novo evento na mesma referência cancela a execução anterior.

| Job              | Validação                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`           | ESLint: `npm run lint:check`.                                                                                                                        |
| `format`         | Prettier: `npm run format:check`.                                                                                                                    |
| `audit`          | Dependências: `npm audit --audit-level=high`.                                                                                                        |
| `test`           | Testes unitários Jest e compatibilidade Newman com `node:test`.                                                                                      |
| `build`          | Após os quatro jobs anteriores, compila TypeScript com `npm run build`.                                                                              |
| `Publish Report` | Após os cinco jobs anteriores, o relatorio é gerado e o link segue no badge do readme`.                                                              |
| `api`            | Sobe PostgreSQL via Docker Compose e API compilada; executa os 25 cenários com `npm run test:all`. Publica logs e relatórios mesmo em caso de falha. |
| `ci`             | Consolida o sucesso do build e dos testes de API.                                                                                                    |
| `deploy`         | Depende de `ci`; dispara o Deploy Hook do Render apenas em push na `main`.                                                                           |

### Evolução do CI e dos Relatórios — PR #10

A [PR #10 — ci: added test e2e job](https://github.com/Cassino-RedGreen/RedGreen-Back/pull/10), na branch `ci/add-test-e2e-job`, propõe as mudanças abaixo. **Ainda pendentes de integração na `main`**, elas descrevem o workflow dessa PR e não substituem a configuração atual documentada acima. Referência revisada: commit `286ba23`.

| Recurso                   | Comportamento proposto na PR                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job `test-e2e`            | Executa `npm run test:all` contra a API real, após lint, formatação e auditoria. O nome E2E se refere à suite Newman, não ao comando Jest `test:e2e`.                              |
| Banco e API no CI         | PostgreSQL 15 como serviço Docker do GitHub Actions; compila e inicia a API, aguardando a rota raiz responder antes dos testes.                                                    |
| Ordem de validação        | Jest e Newman rodam em jobs paralelos após os checks iniciais; o job final `build` depende do sucesso de ambos.                                                                    |
| Relatórios adicionais     | Adiciona `newman-reporter-htmlextra` e exportação JUnit, além dos logs e JSON existentes. Os nomes previstos são `report-test-api-tcNNN.html` e `junit-test-api-tcNNN.xml`.        |
| Resumo no Actions         | `scripts/write-e2e-summary.cjs` escreve no resumo da execução: resultado, requisições, assertions, duração por cenário e detalhes das falhas.                                      |
| Artefato para download    | `e2e-test-results`, com retenção de 14 dias; o upload é tentado mesmo quando os testes falham.                                                                                     |
| Publicação dos relatórios | `publish-report` gera o site em `_site/` e publica no GitHub Pages em pushes na `main`, inclusive quando a suite falha, desde que não tenha sido ignorada ou a execução cancelada. |

#### Configuração exigida pela PR

Em **Settings → Secrets and variables → Actions**, configure os valores usados pelo serviço PostgreSQL e pela API do runner:

| Tipo     | Nome                | Configuração                                                                        |
| -------- | ------------------- | ----------------------------------------------------------------------------------- |
| Variable | `PORT`              | Porta da API; use `3000` para corresponder ao `baseUrl` padrão do ambiente Postman. |
| Variable | `POSTGRES_HOST`     | `localhost`, para acessar o serviço Docker pelo runner.                             |
| Variable | `POSTGRES_PORT`     | Porta publicada no runner, por exemplo `5433`; o container usa internamente `5432`. |
| Variable | `POSTGRES_USER`     | Usuário criado no PostgreSQL de testes.                                             |
| Variable | `POSTGRES_DB`       | Banco criado no PostgreSQL de testes.                                               |
| Variable | `POSTGRES_SSL`      | `false` para o serviço local de testes.                                             |
| Secret   | `POSTGRES_PASSWORD` | Senha do PostgreSQL de testes.                                                      |
| Secret   | `JWT_SECRET`        | Segredo para assinatura dos tokens da API no CI.                                    |

O job verifica se os valores estão preenchidos sem imprimi-los. Para publicar os relatórios, configure **Settings → Pages → Build and deployment → Source: GitHub Actions**. O job usa o ambiente `github-pages` e permissões `pages: write` e `id-token: write`; o link publicado aparece no resumo da execução.

#### Consulta dos resultados após a integração

Na aba **Actions**, abra a execução para consultar o resumo ou baixar `e2e-test-results`. O site gerado por `scripts/build-pages-index.cjs` mostra resultado por cenário, requisições, assertions aprovadas, duração e links para os relatórios HTML disponíveis, além de data, commit e execução.

O site publica somente o índice e os arquivos `report-*.html`; JSON, JUnit e logs permanecem no artefato. O reporter HTML usa `skipSensitiveData`. Se não houver resultados, o site informa essa ausência; cenários sem HTML aparecem sem link para relatório.

A PR altera o agregador e o runner compartilhado para exportar os novos formatos. Como os runners desta branch já evoluíram, a integração deve conferir a geração de HTML/JUnit em cada cenário e conciliar `test-e2e` com o job `api` atual, evitando executar a mesma suite duas vezes. Os scripts de resumo e publicação citados nesta seção pertencem à PR e ainda não estão disponíveis nesta branch.

---

### Deploy

Configure o secret `RENDER_DEPLOY_HOOK` em **Settings → Secrets and variables → Actions** e desative o auto-deploy do serviço Render para que a publicação dependa do CI. Sem o secret, a etapa informa que o deploy não está configurado e não envia a requisição.

O POST no hook solicita o deploy; o sucesso desse passo não confirma que a publicação no Render terminou. A API utiliza PostgreSQL no Neon em produção, com `POSTGRES_SSL=true` e as demais variáveis `POSTGRES_*` configuradas no serviço.

---

## Testes

Há três suites: testes unitários com **Jest**, testes HTTP com **Newman/Postman** e testes de compatibilidade das ferramentas com **node:test**. Os cenários de API cobrem fluxos de sucesso, rejeições e concorrência usando a API e o banco reais.

> **Testadores de caixa cinza:** os integrantes que elaboraram e executaram os testes automatizados atuaram como testadores de caixa cinza, pois tinham conhecimento parcial da estrutura interna da aplicação. Esse conhecimento sobre a API, as regras de negócio e os dados de teste foi utilizado para definir os cenários e validar os resultados.

### Testes unitários e funcionalidades cobertas

A configuração Jest fica em [package.json](package.json): ambiente `node`, transformação TypeScript com `ts-jest`, aliases de importação e arquivos `test/*.spec.ts`. Repositórios, transações e dependências são simulados por injeção de dependência; essa suite não exige PostgreSQL.

| Arquivo                                                                   | Funcionalidades verificadas                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [auth.service.spec.ts](test/auth.service.spec.ts)                         | Perfil sem senha, atualização de dados e validações do usuário.                                          |
| [slot-machine.service.spec.ts](test/slot-machine.service.spec.ts)         | Criação, edição, remoção e validação de cores de mesas Slot.                                             |
| [slot-session.service.spec.ts](test/slot-session.service.spec.ts)         | Cálculo de prêmios, geração de símbolos, criação de sessão, reroll e cash-out.                           |
| [gambit-table.service.spec.ts](test/gambit-table.service.spec.ts)         | Criação, consulta, edição, remoção e desativação de mesas Gambit.                                        |
| [gambit-session.service.spec.ts](test/gambit-session.service.spec.ts)     | Multiplicadores, tabuleiro, queima de cartas, efeitos, eventos e liquidação da partida.                  |
| [session-registry.service.spec.ts](test/session-registry.service.spec.ts) | Aquisição e liberação da sessão única de plataforma.                                                     |
| [session-management.spec.ts](test/session-management.spec.ts)             | Conflito de sessões, tratamento de concorrência e desativação administrativa com pagamento ou reembolso. |
| [app.controller.spec.ts](test/app.controller.spec.ts)                     | Resposta da rota raiz.                                                                                   |

```bash
npm test -- --runInBand
npm run test:watch
npm run test:cov -- --runInBand
npm test -- --runInBand slot-session.service.spec.ts
npm run test:tooling
```

A cobertura instrumenta o código de `src/` e é gravada em `coverage/` (relatório HTML em `coverage/lcov-report/index.html`). Os testes de [compatibilidade Newman](test/tooling/newman-compat.test.cjs) verificam as adaptações aplicadas por [patch-newman.cjs](scripts/patch-newman.cjs), incluindo variáveis dinâmicas do Postman e idempotência do patch executado no `postinstall`.

### Cenários automatizados de API

A coleção [redgreen-api.postman_collection.json](test/api/redgreen-api.postman_collection.json) contém **25 cenários**, cada um selecionado por pasta. O ambiente local fica em [redgreen.local.postman_environment.json](test/api/redgreen.local.postman_environment.json).

| Caso     | Funcionalidade / resultado esperado                                       | Condições e recursos utilizados                                                                        |
| :------- | :------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------- |
| `TC-001` | Acesso a jogos sem autenticação é recusado.                               | API real; chamadas às rotas de jogo sem token de autenticação.                                         |
| `TC-002` | Jogador comum não pode executar funções administrativas.                  | API real; jogador comum tenta acessar operações restritas a administradores.                           |
| `TC-003` | Administrador consegue executar funções restritas.                        | API real e conta administradora; preparação e limpeza da mesa por HTTP.                                |
| `TC-004` | Bônus diário não pode ser resgatado duas vezes no mesmo dia.              | API real; duas tentativas de resgate do bônus diário pela mesma conta.                                 |
| `TC-005` | Um jogador não pode usar a sessão de outro.                               | API real; dois jogadores e tentativa de acesso à sessão pertencente ao outro.                          |
| `TC-006` | Administrador cria e configura uma mesa ativa.                            | API local e administrador do seed; cria uma mesa Slot e a remove ao final.                             |
| `TC-007` | Ranking exibe os jogadores na ordem esperada de saldo.                    | API local; cria 12 jogadores com saldos distintos e verifica a ordem e o limite de 10 posições.        |
| `TC-008` | Conclusão de Slot e entrada no Gambit com o saldo atualizado.             | API local, novo jogador e mesas Slot 1 e Gambit 1; confere saldo após giro, reroll e cash-outs.        |
| `TC-009` | Bloqueio de duas sessões simultâneas de Slot para o mesmo usuário.        | API local, novo jogador e mesa Slot 1; tenta abrir outra sessão com uma partida ativa.                 |
| `TC-010` | Sessão ativa em um jogo bloqueia a entrada no outro.                      | API local e mesas Slot 1 e Gambit 1; verifica o bloqueio de troca de jogo nos dois sentidos.           |
| `TC-011` | Bônus completa o saldo mínimo e libera a sessão de Slot.                  | API real; compara o saldo e a elegibilidade para iniciar a sessão antes e depois do bônus.             |
| `TC-012` | Exclusão de mesa somente após o cash-out administrativo.                  | API real e operações administrativas; verifica a exclusão da mesa após encerrar as sessões.            |
| `TC-013` | Reroll cobra o valor da mesa e é recusado sem saldo ou tentativas.        | API real; verifica o débito do reroll e as rejeições por saldo ou tentativas esgotadas.                |
| `TC-014` | Gambit não expõe cartas ainda não reveladas.                              | API real; inspeciona as respostas da sessão para verificar a ocultação das cartas.                     |
| `TC-015` | Edição da mesa afeta sessões futuras e preserva a configuração da atual.  | API real; altera a mesa durante uma partida e compara a sessão atual com uma posterior.                |
| `TC-016` | Reautenticação recupera e permite continuar a sessão de Slot.             | API real; novo login da mesma conta, recuperação do estado e continuidade da partida Slot.             |
| `TC-017` | Reautenticação recupera e permite continuar a sessão de Gambit.           | API real; novo login da mesma conta, recuperação do estado e continuidade da partida Gambit.           |
| `TC-018` | Dois jogadores usam a mesma mesa de Slot com estados independentes.       | API real; duas contas jogam na mesma mesa Slot e mantêm sessões independentes.                         |
| `TC-019` | Dois jogadores usam a mesma mesa de Gambit com estados independentes.     | API real; duas contas jogam na mesma mesa Gambit e mantêm sessões independentes.                       |
| `TC-020` | Dois clientes do mesmo usuário compartilham o estado da sessão de Slot.   | API real; dois clientes autenticados na mesma conta consultam e alteram a sessão Slot.                 |
| `TC-021` | Dois clientes do mesmo usuário compartilham o estado da sessão de Gambit. | API real; dois clientes autenticados na mesma conta consultam e alteram a sessão Gambit.               |
| `TC-022` | Falha de reautenticação preserva a sessão de Slot.                        | API real; tentativa de login inválida durante uma partida Slot e conferência do estado preservado.     |
| `TC-023` | Ação com token inválido preserva a sessão de Gambit.                      | API real; requisição com token inválido durante uma partida Gambit e conferência do estado preservado. |
| `TC-024` | Cash-outs concorrentes de Slot não duplicam o pagamento.                  | API real; envia cash-outs concorrentes para a mesma sessão Slot e verifica pagamento único.            |
| `TC-025` | Cash-outs concorrentes de Gambit não duplicam o pagamento.                | API real; envia cash-outs concorrentes para a mesma sessão Gambit e verifica pagamento único.          |

Execute qualquer caso com `npm run test:api:tcNNN`, substituindo `NNN` pelo número com três dígitos.

### Preparação e execução

1. Instale as dependências com `npm ci` e copie `.env.example` para `.env`.
2. Inicie PostgreSQL com `docker compose up -d --wait`.
3. Em outro terminal, execute `npm run start:dev` e aguarde a API em `http://localhost:3000`.
4. Confira o seed e o ambiente Postman conforme as instruções abaixo.
5. Execute a suite ou um cenário individual:

```bash
# Todos os 25 casos, continua após falhas e consolida resultados
npm run test:all

# Todos os 25 casos, interrompe na primeira falha
npm run test:api

# Um caso individual
npm run test:api:tc024
```

`test:all` descobre todos os scripts `test:api:*` em `package.json` e os executa sequencialmente. Não inclui Jest nem testes de ferramentas. TC-003 e TC-005 fazem preparação e limpeza por HTTP, sem acesso direto ao PostgreSQL. TC-006 a TC-010 exigem uma URL local; alguns desses runners atualizam o arquivo de ambiente Postman, portanto execute a suite em sequência.

#### Seed e ambiente Postman

A inicialização executa [DatabaseSeedService](src/core/database/database-seed.service.ts), que cria ou atualiza o administrador e as mesas oficiais. `npm run seed` também executa esse processo. O seed reaplica configurações, saldo e senha do administrador; não o execute durante uma suite.

| Recurso               | Valores usados no ambiente local                                              |
| --------------------- | ----------------------------------------------------------------------------- |
| API                   | `http://localhost:3000`                                                       |
| Administrador do seed | `admin@admin.com` / `admin123`                                                |
| Slot 1                | Ativa; saldo mínimo 100, giro 10 e reroll 5.                                  |
| Gambit 1              | Ativa; saldo mínimo 100, carta 10, multiplicador 1 e compra de 5 a 20 cartas. |
| Outras mesas oficiais | Slot 2, Slot 3, Gambit 2 e Gambit 3.                                          |

O ambiente [redgreen.local.postman_environment.json](test/api/redgreen.local.postman_environment.json) deve apontar para essa API em `baseUrl`. Confira `adminEmail`/`adminPassword`, `tc003AdminEmail`/`tc003AdminPassword` e `tc005AdminEmail`/`tc005AdminPassword` com as credenciais do administrador local. As credenciais acima são dados de desenvolvimento do seed existente.

TC-003 e TC-005 aceitam sobrescritas `TC003_BASE_URL`, `TC003_ADMIN_EMAIL`, `TC003_ADMIN_PASSWORD` e os equivalentes `TC005_*` no ambiente do processo ou `.env`. O runner genérico dos demais casos lê diretamente o ambiente Postman, sem aplicar essas sobrescritas. TC-006 a TC-010 aceitam `TCNNN_BASE_URL`, mas exigem host local; mantenha `baseUrl` do JSON igual ao endereço escolhido.

TC-008 a TC-010 procuram mesas ativas pelos nomes `Slot 1` e/ou `Gambit 1`. Se não forem encontradas, confira o seed e a conexão da API com o PostgreSQL do Docker Compose (porta local padrão 5433).

Revise o diff do ambiente Postman após os testes antes de versionar alterações feitas pelos runners.

### Relatórios de navegador no GitHub Pages — frontend

A [PR #9 do frontend — Ci/e2e report GitHub pages](https://github.com/Cassino-RedGreen/RedGreen-Front/pull/9) adiciona um site para consultar os testes E2E do **Playwright**, complementando os resultados Newman da API. A PR estava aberta na revisão do commit `f625212`; os comandos e arquivos desta seção pertencem ao **RedGreen-Front**.

**Acesso:** [relatório E2E do frontend](https://cassino-redgreen.github.io/RedGreen-Front/) — endereço informado na PR para a publicação no GitHub Pages.

| Conteúdo             | O que consultar                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Página inicial       | Indicadores gerais e uma linha por cenário.                                                    |
| `report-TC-XXX.html` | Resultado do caso, informações do arquivo, tempos, resumo por navegador e detalhes das falhas. |
| Evidências           | Screenshots e vídeos disponíveis para cada execução.                                           |
| `report/index.html`  | Relatório completo gerado pelo Playwright.                                                     |
| Artefatos do Actions | `playwright-report` e `playwright-test-results`, com retenção de 7 dias no workflow da PR.     |

#### Preparação local com o backend

1. Inicie o PostgreSQL e a API conforme [Preparação e execução](#preparação-e-execução). O seed do backend prepara o administrador e as mesas utilizadas pelos testes.
2. No **frontend**, copie `.env.example` para `.env` e configure a conexão com a API. Preencha `E2E_ADMIN_EMAIL` e `E2E_ADMIN_PASSWORD` com a conta administradora do ambiente de teste. Segundo a PR, sem essas credenciais os casos TC-004, TC-005, TC-006, TC-007 e TC-009 são ignorados.
3. Com as alterações da PR disponíveis no checkout do **frontend**, execute nessa pasta:

```bash
npm run test:e2e
npm run report:site
```

O gerador `scripts/BuildReportSite.mjs` usa módulos nativos do Node para ler `playwright-report/results.json` e as evidências de `test-results/`, produzindo o site em `_site/`. A pasta gerada é ignorada pelo Git. Após uma execução com falhas, o site também pode ser gerado a partir dos resultados disponíveis.

#### Publicação e acompanhamento

No repositório **RedGreen-Front**, configure **Settings → Pages → Build and deployment → Source: GitHub Actions**. O job `pages`, exibido como **Publish E2E Report**, roda depois de `e2e` na referência `main`, inclusive quando os testes falham, desde que o job E2E não tenha sido cancelado ou ignorado. A PR adiciona `workflow_dispatch` para execução manual; a publicação também exige selecionar `main`.

Acompanhe o job na aba **Actions** e abra o endereço do ambiente `github-pages`. A publicação depende do artefato `playwright-report`; a ausência do artefato opcional de evidências não interrompe seu download como etapa obrigatória. O workflow revisado não inicia o backend nem configura as credenciais E2E: a disponibilidade da API e dessas credenciais continua sendo um pré-requisito dos cenários que usam integração real.

### Relatórios e limites da cobertura

`test:all` salva logs por caso, relatórios Newman JSON e `summary.json` em `test-results/<execução>/`. O terminal mostra totais `executed` e `failed` para iterations, requests, test-scripts, prerequest-scripts e assertions. Falhas ou relatórios ausentes/inválidos retornam código 1; totais incompletos são identificados como parciais. Os runners com [api-report-path.cjs](test/api/api-report-path.cjs) também salvam relatórios individuais automaticamente; TC-006 a TC-010 recebem o destino JSON pelo agregador via `TEST_CASE_REPORT`.

Use uma base destinada a testes: os cenários criam contas, alteram saldo e mesas e nem todos removem todos os registros. Desativação de conta preserva histórico. Testes unitários com mocks não comprovam locks reais; TC-024 e TC-025 exercitam requisições concorrentes contra a API para verificar pagamento único.

`npm run test:e2e` possui configuração Jest em [jest-e2e.json](test/jest-e2e.json), mas ainda não há arquivos `*.e2e-spec.ts`: o comando termina com “No tests found”. A integração HTTP automatizada existente é executada pelos cenários Newman acima. Os testes de navegador ficam no repositório do frontend.

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

### História 2 — Reroll de slot · Prioridade: Alta

> Como **jogador do cassino**, eu quero selecionar um slot específico para realizar um reroll para que eu possa tentar melhorar minha combinação e aumentar minhas chances de obter uma recompensa maior.

**Critérios de aceitação:**

- **Dado** que possuo rerolls disponíveis, **quando** seleciono um dos slots permitidos, **então** o sistema destaca visualmente o slot escolhido.
- **Dado** que um slot foi selecionado, **quando** confirmo a ação de reroll, **então** apenas o slot escolhido executa novamente a animação de giro.
- **Dado** que o reroll foi concluído, **quando** o backend retorna o novo resultado, **então** o símbolo exibido no slot corresponde exatamente ao valor recebido.
- **Dado** que um reroll foi utilizado, **quando** a operação é concluída, **então** a quantidade restante de rerolls é atualizada na interface.
- **Dado** que não possuo mais rerolls disponíveis, **quando** tento realizar um novo reroll, **então** o sistema não permite a ação e mantém o estado atual dos slots.

### História 3 — Ranking de jogadores · Prioridade: Média

> Como **jogador competitivo**, eu quero ver um ranking dos jogadores para que eu possa comparar meu desempenho com os demais.

**Critérios de aceitação:**

- **Dado** que existem jogadores cadastrados, **quando** acesso a tela de ranking, **então** vejo a lista ordenada pelo saldo de fichas.
- **Dado** que meu saldo é alterado, **quando** o ranking é recalculado, **então** minha posição reflete a mudança.

### História 4 — Bônus diário · Prioridade: Média

> Como **jogador autenticado**, eu quero resgatar meu bônus diário de fichas para que eu possa aumentar meu saldo e continuar jogando.

**Critérios de aceitação:**

- **Dado** que estou logado e ainda não resgatei o bônus do dia, **quando** acesso o painel de bônus diário, **então** vejo o dia atual da sequência e posso resgatar a recompensa.
- **Dado** que o bônus diário já foi resgatado, **quando** acesso o painel novamente, **então** o botão de resgate aparece bloqueado com a informação de que o bônus já foi coletado.
- **Dado** que o resgate é concluído com sucesso, **quando** a API retorna a recompensa, **então** o saldo de fichas é atualizado na interface.

### História 5 — Gerenciamento de mesas de jogo · Prioridade: Alta

> Como **administrador**, eu quero criar, editar, desativar e remover mesas de jogo para que eu possa controlar quais mesas estarão disponíveis aos jogadores.

**Critérios de aceitação:**

- **Dado** que estou autenticado como administrador, **quando** acesso a tela de mesas, **então** vejo a opção de criar uma nova mesa.
- **Dado** que informo dados inválidos ao criar ou editar uma mesa, **quando** tento salvar, **então** recebo uma mensagem de erro e a operação não é concluída.
- **Dado** que uma mesa está ativa, **quando** tento excluí-la, **então** a exclusão fica bloqueada até que a mesa seja desativada.
- **Dado** que uma mesa possui sessões ativas, **quando** tento desativá-la, **então** o sistema exibe um aviso antes de concluir a operação.

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

## Refatorações

As 5 refatorações mais relevantes do projeto, cobrindo três tipos do catálogo: **Movimentação**, **Extração** e **Renomeação**.

1. **Movimentação de utilitário entre camadas** — _move Cookies utility from ui to infrastructure_
   - **Tipo:** Movimentação
   - **Por quê:** move um utilitário para a camada correta, respeitando a arquitetura em camadas.
   - **Commit:** [`bd6c603`](https://github.com/C14-INATEL/RedGreen-Front/commit/bd6c603)

2. **Enum `SlotMachineColor` → `GameTableColor`** — promovido a um local compartilhado
   - **Tipo:** Movimentação + Renomeação
   - **Por quê:** o enum servia só ao Slot, mas passou a servir Slot e Gambit; promovê-lo a um local compartilhado e renomeá-lo evita duplicação e reflete o novo papel.
   - **Commit:** _a definir_

3. **Extração da busca de usuário para hook** — _fetch user from useUserProfile hook_
   - **Tipo:** Extração
   - **Por quê:** lógica de busca de usuário extraída para um hook reutilizável.
   - **Commit:** [`291d2b0`](https://github.com/C14-INATEL/RedGreen-Front/commit/291d2b0)

4. **Padronização de nomenclatura (PascalCase)** — _simplify UserProfile interface to PascalCase only_
   - **Tipo:** Renomeação
   - **Por quê:** padronização de nomenclatura segundo a convenção do projeto (ver [Prompts](#prompts)).
   - **Commit:** [`1018199`](https://github.com/C14-INATEL/RedGreen-Front/commit/1018199)

5. **Renomeação de componente** — _name change to GambitBetPanel_
   - **Tipo:** Renomeação
   - **Por quê:** o nome anterior não refletia bem a responsabilidade do componente; renomear melhora a legibilidade.
   - **Commit:** [`edda7c1`](https://github.com/C14-INATEL/RedGreen-Front/commit/edda7c1)

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

## Uso de IA

Pedro Ribeiro Nogueira

Durante o desenvolvimento do projeto, utilizei o ChatGPT e o Codex como ferramentas de apoio na criação e revisão dos testes de integração. A IA foi utilizada para auxiliar na estruturação dos cenários de teste, elaboração das descrições dos casos, análise de possíveis falhas e apoio na implementação e correção do código dos testes. Também foi utilizada para revisar conflitos encontrados durante o desenvolvimento, auxiliar na documentação do projeto, incluindo a organização do Plano de Testes. As decisões sobre quais cenários deveriam ser testados e por fim a validação dos resultados, utilizando a IA como suporte durante o processo de desenvolvimento.

Danilo Henrique Maia da Silva

Durante o desenvolvimento do projeto, a IA foi utilizada como apoio na organização e padronização da suíte de testes de API construída com Postman/Newman, consolidando casos de teste fragmentados em um formato único e consistente, convertendo scripts para o padrão de nomenclatura adotado no projeto e corrigindo falhas na geração automática de relatórios de teste. Também foi utilizada para investigar e diagnosticar a causa raiz de falhas reportadas pela equipe. Exemplo: "Preciso reorganizar a suíte de testes de API do projeto, que utiliza Postman e Newman. Alguns casos de teste (TC-006, TC-008, TC-009 e TC-010) estão fragmentados em múltiplas requisições visíveis no Postman Runner, enquanto os demais casos seguem um padrão de item único por pasta. Solicito a consolidação desses casos para o mesmo padrão, mantendo toda a lógica de negócio e as asserções existentes, e garantindo que, nos testes de caminho infeliz, a requisição visível seja aquela que retorna o status de erro esperado. Além disso, peço a verificação de possíveis relatórios de falha incorretos ao executar a suíte completa de testes, identificando e corrigindo a causa raiz, caso exista."

Pedro Armengol de Oliveira

O ChatGPT foi utilizada como ferramenta de apoio durante o desenvolvimento do projeto, auxiliando na compreensão das tecnologias utilizadas, na análise e organização dos casos de teste, na identificação de cenários positivos e negativos, na interpretação dos resultados e na elaboração da documentação. Também foi utilizado o Codex para auxiliar na implementação dos testes automatizados, enquanto a execução e validação dos testes foram realizadas no próprio projeto.

Pedro Henrique de Paula Andrade

Usei o Claude (Anthropic) pela extensão do VSCode como apoio na construção da
suíte de testes de API. A definição dos casos de teste foi feita por mim, partindo
das regras de negócio do backend, como autenticação, permissões de usuário, bônus
diário, continuidade de sessão após reautenticação e cash-out concorrente. Com o
cenário já pensado e escrito, eu passava para a IA o contexto do projeto e o
comportamento esperado de cada requisição, e ela me ajudava a escrever as
requisições da collection do Postman e os runners em Node que executam a collection
pelo Newman. A execução dos testes, a análise dos resultados e a validação final de
cada cenário foram feitas por mim, então a IA atuou como apoio na escrita do código
e não como responsável pela autoria dos testes.
