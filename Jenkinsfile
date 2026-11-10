pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 45, unit: 'MINUTES')
  }

  environment {
    HUSKY = '0'
    COMPOSE_FILE = 'docker-compose.yml:docker-compose.ci.yml'
    POSTGRES_USER = 'postgres'
    POSTGRES_DB = 'redgreen'
  }

  stages {
    stage('Prepare') {
      steps {
        script {
          def branch = (env.BRANCH_NAME ?: 'local').toLowerCase().replaceAll('[^a-z0-9]+', '-')
          env.COMPOSE_PROJECT_NAME = "redgreen-ci-${branch}-${env.BUILD_NUMBER}"
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(7)}"
          env.API_IMAGE = env.DOCKERHUB_REPO ?: 'redgreen-back-api'
          env.DOCKER_CONFIG = "${env.WORKSPACE}/.docker"
        }
        echo "Projeto compose: ${env.COMPOSE_PROJECT_NAME} | imagem: ${env.API_IMAGE}:${env.IMAGE_TAG}"
        sh '''
          node --version
          npm --version
          docker version
          docker compose version
          docker compose config --quiet
          mkdir -p reports test-results package
        '''
      }
    }

    stage('Install Dependencies') {
      steps {
        sh 'npm ci --no-audit --no-fund'
      }
    }

    stage('Quality') {
      parallel {
        stage('Lint') {
          steps {
            sh 'npm run lint:check'
          }
        }
        stage('Format') {
          steps {
            sh 'npm run format:check'
          }
        }
        stage('Audit') {
          steps {
            sh 'npm audit --audit-level=high'
          }
        }
      }
    }

    stage('Unit Tests') {
      steps {
        sh 'docker compose build unit-tests'
        script {
          def status = sh(returnStatus: true, script: 'docker compose run -T --name "$COMPOSE_PROJECT_NAME-unit" unit-tests')
          sh 'docker cp "$COMPOSE_PROJECT_NAME-unit:/app/reports/." reports/ || echo "Aviso: relatorios unitarios nao encontrados."'
          if (status != 0) {
            error("Testes unitarios ou cobertura minima de 90% falharam (codigo ${status}).")
          }
        }
      }
    }

    stage('Build & Package') {
      steps {
        sh '''
          docker compose build api
          docker create --name "$COMPOSE_PROJECT_NAME-dist" "$API_IMAGE:$IMAGE_TAG"
          docker cp "$COMPOSE_PROJECT_NAME-dist:/app/dist" package/dist
          docker rm "$COMPOSE_PROJECT_NAME-dist"
          cp package.json package-lock.json package/
          tar -czf "redgreen-back-$IMAGE_TAG.tar.gz" -C package .
        '''
      }
    }

    stage('E2E Tests') {
      steps {
        withCredentials([
          string(credentialsId: 'postgres-password', variable: 'POSTGRES_PASSWORD'),
          string(credentialsId: 'jwt-secret', variable: 'JWT_SECRET'),
        ]) {
          sh 'docker compose build e2e-tests'
          sh 'docker compose up -d --no-build --wait --wait-timeout 180 api'
          script {
            def status = sh(returnStatus: true, script: 'docker compose run -T --no-deps --name "$COMPOSE_PROJECT_NAME-e2e" e2e-tests')
            sh 'docker cp "$COMPOSE_PROJECT_NAME-e2e:/app/test-results/." test-results/ || echo "Aviso: resultados E2E nao encontrados."'
            if (status != 0) {
              sh 'docker compose logs --no-color --tail 200 api'
              error("Testes E2E falharam (codigo ${status}).")
            }
          }
        }
      }
    }

    stage('Publish to Docker Hub') {
      when {
        branch 'main'
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'DOCKERHUB_USER', passwordVariable: 'DOCKERHUB_TOKEN')]) {
          sh '''
            : "${DOCKERHUB_REPO:?Defina DOCKERHUB_REPO no .env do Jenkins (ex.: usuario/redgreen-back)}"
            echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USER" --password-stdin
            docker push "$API_IMAGE:$IMAGE_TAG"
            docker tag "$API_IMAGE:$IMAGE_TAG" "$API_IMAGE:latest"
            docker push "$API_IMAGE:latest"
          '''
        }
        script {
          env.PUBLISHED_IMAGE = "${env.API_IMAGE}:${env.IMAGE_TAG} (e latest)"
        }
      }
    }
  }

  post {
    always {
      junit(allowEmptyResults: true, testResults: 'reports/unit/junit.xml, test-results/**/junit-*.xml')
      archiveArtifacts(
        allowEmptyArchive: true,
        fingerprint: true,
        artifacts: 'redgreen-back-*.tar.gz, reports/**, test-results/**'
      )
      withCredentials([string(credentialsId: 'smtp-password', variable: 'SMTP_PASSWORD')]) {
        script {
          withEnv([
            "BUILD_STATUS=${currentBuild.currentResult}",
            "BUILD_DURATION=${currentBuild.durationString.replace(' and counting', '')}",
          ]) {
            def status = sh(returnStatus: true, script: 'python3 scripts/send-pipeline-email.py')
            if (status != 0) {
              echo "Aviso: o e-mail de notificacao nao foi enviado (codigo ${status}). O resultado do build nao foi alterado."
            }
          }
        }
      }
    }
    cleanup {
      sh '''
        if [ -n "$COMPOSE_PROJECT_NAME" ]; then
          docker rm -f "$COMPOSE_PROJECT_NAME-unit" "$COMPOSE_PROJECT_NAME-e2e" "$COMPOSE_PROJECT_NAME-dist" >/dev/null 2>&1 || true
          docker compose down -v --remove-orphans --rmi local || true
          docker image rm "$API_IMAGE:$IMAGE_TAG" "$API_IMAGE:latest" >/dev/null 2>&1 || true
        fi
        docker logout >/dev/null 2>&1 || true
      '''
      cleanWs()
    }
  }
}
