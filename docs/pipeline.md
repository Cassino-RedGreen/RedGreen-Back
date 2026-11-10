# Pipeline Jenkins — RedGreen-Back

Pipeline de CI/CD do backend, executado por um Jenkins **em container** e configurado **inteiramente como código**:
nenhuma etapa, credencial ou job é criado pela interface do Jenkins.

## Visão geral

```
                Docker Desktop (host)
┌──────────────────────────────────────────────────────────────────────┐
│ projeto "redgreen-jenkins"  (jenkins/docker-compose.yml, sobe 1 vez) │
│   jenkins  :8080  ── /var/run/docker.sock ──► daemon Docker do host  │
│   mailpit  :8025 (UI)  :1025 (SMTP, só rede interna)                 │
├──────────────────────────────────────────────────────────────────────┤
│ projeto "redgreen-ci-<branch>-<build>" (1 por build, efêmero)        │
│   docker-compose.yml + docker-compose.ci.yml                         │
│   postgres ◄── api ◄── e2e-tests (network_mode: service:api)         │
│   unit-tests                                                         │
├──────────────────────────────────────────────────────────────────────┤
│ projeto "redgreen-back" (docker-compose.yml, ambiente de dev)        │
│   postgres (redgreen_postgres :5433) — não é tocado pelo pipeline    │
└──────────────────────────────────────────────────────────────────────┘
```

| Arquivo                          | Papel                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `docker/Dockerfile.jenkins`      | Imagem do Jenkins: Docker CLI + compose + buildx, Node 24, python3, git, plugins e JCasC |
| `jenkins/plugins.txt`            | Plugins instalados no build da imagem                                                    |
| `jenkins/casc.yaml`              | JCasC: usuário admin, credenciais e o job (Job DSL)                                      |
| `jenkins/docker-compose.yml`     | Infra de CI: Jenkins + Mailpit                                                           |
| `docker-compose.ci.yml`          | Override da stack de testes de cada build (api, unit-tests, e2e-tests, postgres isolado) |
| `Jenkinsfile`                    | Todas as etapas do pipeline                                                              |
| `scripts/send-pipeline-email.py` | Envio do e-mail de resultado                                                             |

## Como subir

Pré-requisito: apenas Docker Desktop. Nada é instalado na máquina.

1. Copie `.env.example` para `.env` (se ainda não tiver) e preencha as variáveis do bloco Jenkins/Docker Hub/E-mail.
   O `.env` é ignorado pelo Git.
2. Crie um access token no Docker Hub: _Account settings → Personal access tokens → Generate_ (permissão
   _Read & Write_). Coloque-o em `DOCKERHUB_TOKEN` e o repositório em `DOCKERHUB_REPO` (ex.: `usuario/redgreen-back`).
3. Na raiz do repositório:

   ```bash
   docker compose --env-file .env -f jenkins/docker-compose.yml up -d --build
   ```

   O `--env-file .env` é necessário porque, com `-f jenkins/...`, o compose procuraria o `.env` dentro de `jenkins/`.

4. Acesse:
   - Jenkins: <http://localhost:8080> (usuário/senha = `JENKINS_ADMIN_USER` / `JENKINS_ADMIN_PASSWORD`)
   - Mailpit: <http://localhost:8025> (caixa de entrada dos e-mails do pipeline)

Parar sem perder dados: `docker compose -f jenkins/docker-compose.yml down`.
Apagar tudo (inclusive histórico do Jenkins): acrescente `-v`.

Para trocar uma senha/token: edite o `.env` e rode o comando do passo 3 de novo. O JCasC reaplica a configuração a
cada inicialização, então qualquer alteração feita pela interface é sobrescrita.

## Como o pipeline roda

O job `RedGreen-Back` é um **multibranch pipeline** criado pelo Job DSL dentro do `casc.yaml`. Ele lê o repositório
`https://github.com/Cassino-RedGreen/RedGreen-Back.git` e cria um sub-job para cada branch que tenha `Jenkinsfile`.

- **Gatilho:** indexação periódica a cada 5 minutos (o Jenkins roda em `localhost`, então o GitHub não consegue
  chamar um webhook). Para rodar na hora: job `RedGreen-Back` → _Scan Repository Now_, ou _Build Now_ na branch.
- **O Jenkins lê o código do GitHub**, não da sua máquina: mudanças só entram no pipeline depois do `git push`.

## Etapas

| #            | Etapa                 | O que faz                                                                                                                         | Por quê                                                                                                        |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1            | Prepare               | Define `COMPOSE_PROJECT_NAME` único, `IMAGE_TAG = <build>-<sha7>`, `DOCKER_CONFIG` no workspace; mostra versões; valida o compose | Isolamento entre builds, rastreabilidade da imagem, falhar cedo se o compose estiver inválido                  |
| 2            | Install Dependencies  | `npm ci`                                                                                                                          | Instalação reprodutível a partir do lockfile, para lint/format/audit                                           |
| 3            | Quality (paralelo)    | `lint:check`, `format:check`, `npm audit --audit-level=high`                                                                      | Feedback rápido antes dos testes; em paralelo para economizar tempo                                            |
| 4            | Unit Tests            | `docker compose run unit-tests` (`npm run test:cov`), depois `docker cp` dos relatórios                                           | Threshold de 90% do Jest quebra o build; relatórios são copiados **antes** de falhar a etapa                   |
| 5            | Build & Package       | Builda a imagem da API; `docker create` + `docker cp` do `/app/dist`; gera `redgreen-back-<tag>.tar.gz`                           | O pacote é extraído da imagem: é exatamente o código que vai para o Docker Hub                                 |
| 6            | E2E Tests             | Sobe postgres + api isolados (`up --wait`, espera o healthcheck), roda `e2e-tests` (Newman), `docker cp` dos resultados           | Testa a imagem recém-buildada, com banco limpo, sem conflitar com o dev                                        |
| 7            | Publish to Docker Hub | `docker login` com a credencial, push de `<tag>` e `latest`                                                                       | Só na `main` (`when { branch 'main' }`): branches de feature são testadas mas não publicam                     |
| post/always  | Artefatos + e-mail    | `junit`, `archiveArtifacts`, `send-pipeline-email.py`                                                                             | Roda mesmo em falha: relatório e notificação são mais úteis justamente quando falha                            |
| post/cleanup | Limpeza               | `docker compose down -v --remove-orphans --rmi local`, remove a imagem local, `docker logout`, `cleanWs()`                        | Não deixa containers, volumes, imagens nem login para trás. Jenkins e Mailpit não são afetados (outro projeto) |

Se uma etapa falha, as seguintes são puladas, mas o `post` sempre roda.

> Estado atual: a cobertura unitária está em ~53% e o threshold é 90%, então o pipeline falha na etapa 4 até a
> cobertura subir. Isso é intencional.

## Artefatos e relatórios

Na página de cada build:

- **Artifacts:** `redgreen-back-<tag>.tar.gz`, `reports/unit/junit.xml`, `reports/unit/coverage/`
  (`cobertura-coverage.xml`, `lcov.info`, `lcov-report/index.html`) e `test-results/<timestamp>/` (JSON, HTML,
  JUnit e logs do Newman).
- **Test Result:** resultados JUnit dos unitários e dos casos E2E que geram JUnit (`test-results/**/junit-*.xml`).

## E-mail

`scripts/send-pipeline-email.py` usa só a biblioteca padrão do Python e lê tudo do ambiente:

| Variável                  | Obrigatória | Descrição                                        |
| ------------------------- | ----------- | ------------------------------------------------ |
| `EMAIL_TO`                | sim         | Destinatários separados por vírgula              |
| `EMAIL_FROM`              | sim         | Remetente                                        |
| `SMTP_HOST` / `SMTP_PORT` | sim         | Servidor SMTP (padrão `mailpit` / `1025`)        |
| `SMTP_USER`               | não         | Usuário SMTP (vazio = sem login)                 |
| `SMTP_PASSWORD`           | não         | Vem da credencial `smtp-password`                |
| `SMTP_STARTTLS`           | não         | `true` para STARTTLS. Porta `465` usa SSL direto |

Dados do build (job, número, status, branch, commit, duração, URL, imagem publicada) vêm das variáveis do Jenkins,
e o resumo de testes é lido dos JUnit XML. Códigos de saída: `0` enviado, `2` configuração faltando, `1` erro de SMTP.
O Jenkinsfile só registra um aviso se o e-mail falhar, sem alterar o resultado do build.

Teste manual (dentro do container do Jenkins):

```bash
docker cp scripts/send-pipeline-email.py redgreen-jenkins-jenkins-1:/tmp/
docker exec -e BUILD_STATUS=SUCCESS redgreen-jenkins-jenkins-1 python3 /tmp/send-pipeline-email.py
```

### Trocar o Mailpit por um SMTP real

Só o `.env` muda. Exemplo com Gmail (exige verificação em duas etapas e uma _senha de app_):

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_USER=seu-email@gmail.com
SMTP_PASSWORD=<senha de app>
EMAIL_FROM=seu-email@gmail.com
```

Depois: `docker compose --env-file .env -f jenkins/docker-compose.yml up -d`.

## Decisões técnicas

| Decisão                                                          | Justificativa                                                                                                                                                                                      | Trade-off                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Jenkins em container com Dockerfile próprio                      | Requisito; ambiente reproduzível e versionado                                                                                                                                                      | Imagem precisa ser rebuildada para mudar plugins/ferramentas                                                                                   |
| JCasC + Job DSL                                                  | Nenhuma configuração pela UI (critério eliminatório); Jenkins descartável e recriável                                                                                                              | Curva de aprendizado da sintaxe                                                                                                                |
| `jenkins/lts-jdk21`                                              | Linha LTS com o JDK padrão atual (`lts` aponta para ela)                                                                                                                                           | Tag móvel: um rebuild pode trazer um LTS mais novo                                                                                             |
| Plugins sem versão fixa                                          | Simplicidade; `jenkins-plugin-cli` resolve versões compatíveis com o LTS                                                                                                                           | Rebuild futuro pode mudar versões. Para fixar: `docker exec <jenkins> jenkins-plugin-cli --list` e copiar `plugin:versão` para o `plugins.txt` |
| Socket do Docker do host (não Docker-in-Docker)                  | Simples, sem container privilegiado, reaproveita o cache de imagens do host                                                                                                                        | Quem acessa o socket controla o daemon (equivale a root na VM do Docker Desktop). Aceitável em ambiente local e acadêmico                      |
| `group_add: DOCKER_SOCKET_GID` (0 no Docker Desktop)             | O Jenkins continua rodando como usuário `jenkins` (não root) e ganha só o grupo do socket. No Docker Desktop o socket é `root:root 660`                                                            | Em Linux nativo o GID costuma ser outro: `stat -c %g /var/run/docker.sock`                                                                     |
| `docker cp` em vez de bind mount                                 | O daemon é o do host: o caminho do workspace só existe dentro do container Jenkins, então `-v $WORKSPACE/...` montaria uma pasta vazia                                                             | Um passo extra por etapa                                                                                                                       |
| `docker/Dockerfile.jenkins` com context `./jenkins`              | O Dockerfile segue o padrão `docker/Dockerfile.<servico>`, mas o build envia só a pasta `jenkins/` (`plugins.txt` e `casc.yaml`); o `.dockerignore` da raiz não interfere e o contexto fica mínimo | O Dockerfile fica fora do context (suportado pelo Compose/BuildKit)                                                                            |
| Secrets do compose (`/run/secrets`)                              | Senhas não ficam no `env` do container (que todo `sh` herdaria); o JCasC lê os arquivos e cria credenciais, usadas só via `withCredentials` (mascaradas no log)                                    | Secret vazio (ex.: `SMTP_PASSWORD`) não gera arquivo; o JCasC usa o padrão vazio                                                               |
| Multibranch em vez de pipeline simples                           | `BRANCH_NAME` nativo e `when { branch 'main' }` para publicar só na main; histórico por branch                                                                                                     | Constrói qualquer branch com `Jenkinsfile`, inclusive branches antigas do repositório                                                          |
| Projeto compose por build + `docker-compose.ci.yml` com `!reset` | Remove `container_name` e porta fixa do postgres só no CI, sem alterar o serviço do colega; builds isolados entre si e do dev                                                                      | Requer Docker Compose ≥ 2.24                                                                                                                   |
| `network_mode: service:api` no E2E                               | O environment Postman usa `localhost:3000` fixo; compartilhando a rede da API, `localhost` é a API, sem alterar `test/api/`                                                                        | O container E2E só existe enquanto a API existe                                                                                                |
| Healthcheck da API com `node -e fetch(...)`                      | A imagem `node:slim` não tem curl/wget; `fetch` é nativo no Node 24                                                                                                                                | Depende de a imagem da API ter `node`                                                                                                          |
| Node 24 copiado da imagem oficial `node:24`                      | Mesma versão dos containers de teste, sem repositório apt extra                                                                                                                                    | Atualiza junto com o rebuild da imagem                                                                                                         |
| Pacote extraído da imagem                                        | O artefato arquivado é idêntico ao que roda no Docker Hub                                                                                                                                          | Depende do layout `/app/dist` da imagem da API                                                                                                 |
| `DOCKER_CONFIG` no workspace                                     | Login do Docker Hub não fica salvo no home do Jenkins; some no `cleanWs`                                                                                                                           | —                                                                                                                                              |
| Mailpit como SMTP padrão                                         | Testa o e-mail sem conta real nem risco de spam; trocar por SMTP real é só `.env`                                                                                                                  | Não entrega para caixas reais                                                                                                                  |
| `disableConcurrentBuilds` + timeout de 45 min                    | Evita builds simultâneos da mesma branch disputando recursos; nenhum build fica preso                                                                                                              | Builds da mesma branch entram em fila                                                                                                          |

## Contrato com o `docker/Dockerfile.api`

O pipeline espera que a imagem da API:

- seja baseada em Node (o healthcheck usa `node`);
- tenha o build em `/app/dist`;
- escute na porta definida por `PORT` (o compose de CI usa `3000`);
- inicie a API com `node dist/main` (ou equivalente).

## Como adicionar uma etapa

1. Crie um `stage('Nome') { steps { sh '...' } }` no `Jenkinsfile`, na posição desejada, com um comentário curto acima.
2. Se precisar de container, adicione o serviço no `docker-compose.ci.yml` e use `docker compose run -T --name "$COMPOSE_PROJECT_NAME-<x>" <serviço>`.
   Copie arquivos para fora com `docker cp`, nunca com `-v $WORKSPACE`.
3. Se precisar de segredo, adicione a variável no `.env.example`, um `secret` em `jenkins/docker-compose.yml`, a
   credencial no `casc.yaml` e use `withCredentials` no stage.
4. Se precisar de uma ferramenta no próprio Jenkins, instale-a no `docker/Dockerfile.jenkins`.

## Problemas comuns

| Sintoma                                                 | Causa / solução                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `permission denied ... docker.sock`                     | GID do socket diferente: ajuste `DOCKER_SOCKET_GID` (`docker exec <jenkins> stat -c %g /var/run/docker.sock`)       |
| Etapa 5 falha com `docker/Dockerfile.api: no such file` | O Dockerfile da API ainda não existe na branch                                                                      |
| Login no Jenkins falha                                  | Senha vem do `.env` na subida; recrie o container após mudar                                                        |
| Job não aparece                                         | Veja `docker logs redgreen-jenkins-jenkins-1` (procure `createOrUpdateConfig for RedGreen-Back`)                    |
| Branch nova não aparece                                 | Aguarde a indexação (5 min) ou _Scan Repository Now_; confira se a branch tem `Jenkinsfile` e foi enviada ao GitHub |
| E-mail não chega                                        | Veja o aviso no log do build; com Mailpit, confira <http://localhost:8025>                                          |

## Perguntas prováveis

- **Onde estão as etapas?** Só no `Jenkinsfile`. O job é criado pelo Job DSL no `casc.yaml`; não há configuração pela UI.
- **Como o Jenkins builda imagens estando num container?** Pelo socket do Docker do host montado no container; o
  Docker CLI dentro do Jenkins conversa com o daemon do host.
- **Por que não montar o workspace nos containers de teste?** O daemon é o do host e não enxerga o filesystem do
  container Jenkins; por isso os arquivos saem com `docker cp`.
- **Como os segredos chegam ao pipeline?** `.env` → secrets do compose (`/run/secrets`) → JCasC cria as credenciais →
  `withCredentials` injeta só no stage que precisa, mascarado no log.
- **Por que o build falha hoje?** A cobertura unitária (~53%) está abaixo do threshold de 90% do Jest, como deve ser.
- **O que garante que a imagem publicada foi testada?** A mesma tag `<build>-<sha>` buildada na etapa 5 é a que
  sobe no E2E (etapa 6, `--no-build`) e é publicada na etapa 7.
- **Por que publicar só na main?** Branches de feature não são versões entregáveis; o multibranch dá `BRANCH_NAME`
  para a condição `when { branch 'main' }`.
