# AGENTS

Este arquivo resume os padroes de arquitetura, stack tecnologica e convencoes do projeto para manter consistencia ao evoluir o backend (API) do Cassino Web.

**Visao Geral (Stack)**
- NestJS 11
- TypeScript
- PostgreSQL + TypeORM
- JWT Simetrico (HS256) + Passport
- Swagger / OpenAPI (Auto-gerado via NestJS CLI)
- Docker + Docker Compose (Infraestrutura Local)
- Jest (Unitario e E2E)

**Entradas e Fluxo**

- `src/main.ts` inicializa a aplicacao, aplica validações globais (ValidationPipe), configura o CORS e levanta a documentacao do Swagger.

- `src/app.module.ts` e o modulo raiz que orquestra a conexao com o banco de dados e importa os modulos de negocio.

- Filtros de excecao globais (`HttpExceptionFilter`) interceptam erros e padronizam as respostas de falha para o frontend.

- Estrutura Principal (Modular Clean Architecture)

- `src/core/` utilitarios globais, decorators customizados (ex: `@CurrentUser()`), guards (ex: `JwtAuthGuard`) e filtros.

- `src/modules/` diretorio contendo os dominios isolados da aplicacao (ex: auth, users, games, transactions). 
Dentro de CADA modulo (ex: `src/modules/games/`), a arquitetura e dividida em:
    -- `domain/`: Entidades do TypeORM (`.entity.ts`), DTOs e interfaces (contratos).
    -- `application/`: Servicos (`.service.ts`) contendo a regra de negocio pura (RNG, calculo de premios).
    -- `infrastructure/`: Repositorios customizados e integracoes externas.
    -- `presentation/`: Controladores HTTP (`.controller.ts`) que recebem a requisicao e retornam os dados.


**Padroes de Arquitetura e Negocio**

- Injecao de Dependencia (DI) obrigatoria para todas as classes.

- A regra de ouro do Cassino: NUNCA confie em calculos ou resultados vindos do frontend. Todo RNG (Random Number Generation) e resolucao de apostas deve ocorrer na camada `application/` do backend.

- Separacao de responsabilidades: Controladores lidam com HTTP, Servicos lidam com as regras do jogo, Repositorios lidam com o TypeORM.


**Transacoes e Banco de Dados (Critico)**

- O gerenciamento de Fichas (Wallet/Saldo) e estritamente sensivel.

- Ao processar uma aposta (descontar fichas e pagar premios), e OBRIGATORIO o uso de Transacoes do banco de dados (ex: QueryRunner do TypeORM) para evitar condicoes de corrida (race conditions) e duplicacao de saldo caso o usuario clique varias vezes.


**Roteamento e Permissoes**

- Controladores em `src/modules/<modulo>/presentation/` definem as rotas.

- Guards: Rotas de apostas e perfil devem ser protegidas pelo JwtAuthGuard. Rotas de `login/cadastro` sao publicas.

- O payload do JWT deve conter apenas dados nao-sensiveis (ex: `userId`, `role`).


**Configuracao e Environment**

- Uso do `@nestjs/config` para carregar o `.env`.

- Variaveis obrigatorias: `DATABASE_URL`, `JWT_SECRET`, `PORT`.

- Exemplo de env em `.env.example`.


**API e Documentacao (Swagger)**

- O plugin do Swagger no nest-cli.json esta ativado. Portanto, evite poluir o codigo com excesso de decorators `@ApiProperty()`. Apenas tipe corretamente os DTOs em TypeScript e o plugin fara o resto.

- Utilize `@ApiOperation()` nos metodos do controller para dar clareza a acao.


**Infraestrutura Local (Docker)**

- O banco de dados PostgreSQL (e eventuais servicos de cache/filas no futuro) DEVE rodar via Docker.

- O arquivo `docker-compose.yml` na raiz do projeto e a fonte da verdade para a infraestrutura de desenvolvimento.

- Variaveis de ambiente no `.env` devem apontar para os servicos configurados no Docker Compose (ex: `localhost:5432`).


**Testes (Jest)**

- Framework primario: Jest (ja integrado nativamente ao NestJS).

- Testes unitarios (`.spec.ts`) devem focar agressivamente na camada `application/` (Services). Use injecao de dependencia para mockar os repositorios do TypeORM, testando a matematica do cassino de forma isolada do banco de dados.

- Testes E2E (na pasta `test/`) sao usados para simular o fluxo completo de uma aposta (chamada `HTTP` -> `Controller` -> `Service` -> `Banco`).


**CI/CD e Automacao (GitHub Actions)**

- O projeto utiliza GitHub Actions como esteira de automacao.

- O pipeline e definido estritamente no arquivo `.github/workflows/ci.yml`.

- O pipeline DEVE garantir que nenhum codigo com falha de tipagem (TypeScript) ou testes quebrados seja buildado.

- Etapas exigidas no workflow: Instalacao de dependencias, Auditoria de seguranca, Linting, Formatacao, Testes Unitarios e Build de Producao (NestJS).

- O deploy roda como um job separado (`deploy`), com `needs: ci`, restrito a pushes na branch `main`.


**Qualidade e Scripts**

- ESLint e Prettier configurados no repo.

- Husky + lint-staged para pre-commit.

- Scripts principais: `npm run start:dev`, `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e`.


**Aliases de Importacao**

- `@core` -> `src/core`

- `@modules` -> `src/modules`

- `@config` -> `src/config`

- `@` -> `src`