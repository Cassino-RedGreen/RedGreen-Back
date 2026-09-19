# TC-003 — Administrador pode utilizar funções restritas

Na mesma coleção dos TC-001/TC-002, o TC-003 aparece como um único item.
O script Pre-request faz `POST /auth/login`; a requisição principal faz
`POST /gambit-table`; o Post-response faz `GET /gambit-table/{Id}`.
Todas essas chamadas utilizam a API real, sem mocks.

## Execução local reproduzível

Com as dependências instaladas, configure `.env` conforme o projeto,
inicie o PostgreSQL do `docker-compose.yml` e o backend:

```sh
docker compose up -d postgres
npm run start:dev
```

Em outro terminal:

```sh
npm run test:api:tc003
```

Esse comando chama `node test/api/run-tc003.cjs`, que executa Newman pela
API JavaScript, selecionando somente a pasta TC-003. Requer Node com
`process.loadEnvFile` (o Jenkins do projeto usa Node 24).

O executor lê `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`,
`POSTGRES_PASSWORD` e `POSTGRES_DB` do ambiente ou `.env`, usando os mesmos
defaults de host/porta do backend. API e executor devem apontar para o mesmo
PostgreSQL local. `TC003_BASE_URL` permite alterar o endereço local da API;
o padrão é o `baseUrl` do ambiente Postman (`http://localhost:3000`).

Preparação e limpeza, exclusivas dos dados deste teste:

1. Gera e-mail, nickname e senha temporários em memória.
2. Cadastra o usuário por `POST /auth/register` e exige resposta `201`.
3. Atribui `Admin` no banco somente ao usuário recém-criado, identificado
   por ID, e-mail e nickname, confirmando a alteração pelo `RETURNING`.
4. Injeta as credenciais no ambiente Newman em memória e executa TC-003.
5. Em `finally`, remove a mesa com nome único desta execução e o usuário
   temporário, inclusive quando uma assertion falha. Erros de execução ou
   limpeza produzem código de saída diferente de zero.

Não é necessário cadastrar um administrador manualmente. Não são gravados
senhas, tokens ou credenciais de banco nos arquivos versionados. O acesso SQL
é usado somente para preparar o perfil e limpar os dados; o comportamento
administrativo e a persistência da mesa são verificados por HTTP. O executor
aceita apenas hosts locais para essa preparação.

## Verificações

As 10 assertions verificam login `200`, identidade e perfil `Admin` ativo,
estrutura do JWT recebido, envio do JWT no cabeçalho `Authorization`, criação
`201`, conteúdo JSON, campos enviados, `Active: true`, ID inteiro positivo,
consulta `200` e correspondência dos dados persistidos com a mesa criada.
O token ter três partes verifica apenas seu formato; a aceitação da operação
protegida pelo backend comprova sua utilização na autenticação real.

O payload usa `CardPrice: 10`, `MinimumChipsRequired: 0`, `TableMultiplier: 1`,
`MinimumCardsPurchased: 5` e `MaxCardsPurchased: 20`, respeitando as validações
de `CreateGambitTableDto`.

## Postman e Newman direto

Importe a coleção e o ambiente. Para execução diretamente no Postman, preencha
`tc003AdminEmail` e `tc003AdminPassword` com um administrador do ambiente de
testes, sem versionar esses valores. Clique em Send no único item TC-003.
Sem credenciais, a preparação falha explicitamente e pula a criação da mesa.

Com um ambiente privado contendo essas credenciais, o equivalente direto é:

```sh
npx newman run test/api/redgreen-api.postman_collection.json -e CAMINHO_DO_AMBIENTE_PRIVADO.json --folder "TC-003 - Administrador pode utilizar funcoes restritas"
```

O Postman/Newman direto não tem acesso ao PostgreSQL para preparar o perfil
Admin: para execução inteiramente automática, use `npm run test:api:tc003`.
Executar diretamente também deixa a mesa criada no banco; somente o executor
local faz a limpeza automática. O teste não depende de TC-001 ou TC-002.

## Implementação e Swagger

`GambitTableController.Create` usa `AdminGuard`, que autentica o JWT e exige
`UserType.Admin`. A estratégia JWT obtém o perfil atual pelo usuário do banco.
O Swagger `/api-json` declara Bearer, `CreateGambitTableDto` e resposta `201`;
a consulta por ID é pública e responde `200`, como observado na execução.

Diferença encontrada: `CreateUserDto`/Swagger expõem `UserType`, mas
`AuthService.Register` não copia esse campo e a entidade usa `User` como
default. Portanto, enviar `UserType: Admin` no cadastro não prepara um
administrador. Não há seed nem endpoint de promoção no projeto. A preparação
local resolve essa necessidade sem modificar autenticação, guards ou serviços.
