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
        echo "Compose project: ${env.COMPOSE_PROJECT_NAME} | image: ${env.API_IMAGE}:${env.IMAGE_TAG}"
        sh '''
          node --version
          npm --version
          docker version
          docker compose version
          docker compose config --quiet
          mkdir -p reports test-results package
        '''
      }
      post {
        failure {
          markFailedStage()
        }
      }
    }

    stage('Install Dependencies') {
      steps {
        sh 'npm ci --no-audit --no-fund'
      }
      post {
        failure {
          markFailedStage()
        }
      }
    }

    stage('Quality') {
      parallel {
        stage('Lint') {
          steps {
            sh 'npm run lint:check'
          }
          post {
            failure {
              markFailedStage()
            }
          }
        }
        stage('Format') {
          steps {
            sh 'npm run format:check'
          }
          post {
            failure {
              markFailedStage()
            }
          }
        }
        stage('Audit') {
          steps {
            sh 'npm audit --audit-level=high'
          }
          post {
            failure {
              markFailedStage()
            }
          }
        }
      }
    }

    stage('Unit Tests') {
      steps {
        sh 'docker compose build unit-tests'
        script {
          def status = sh(returnStatus: true, script: 'docker compose run -T --name "$COMPOSE_PROJECT_NAME-unit" unit-tests')
          sh 'docker cp "$COMPOSE_PROJECT_NAME-unit:/app/reports/." reports/ || echo "Warning: unit test reports not found."'
          if (status != 0) {
            error("Unit tests or the 90% coverage threshold failed (exit code ${status}).")
          }
        }
      }
      post {
        failure {
          markFailedStage()
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
      post {
        failure {
          markFailedStage()
        }
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
            sh 'docker cp "$COMPOSE_PROJECT_NAME-e2e:/app/test-results/." test-results/ || echo "Warning: E2E test results not found."'
            if (status != 0) {
              sh 'docker compose logs --no-color --tail 200 api'
              error("E2E tests failed (exit code ${status}).")
            }
          }
        }
      }
      post {
        failure {
          markFailedStage()
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
            : "${DOCKERHUB_REPO:?Set DOCKERHUB_REPO in the Jenkins .env (e.g. user/redgreen-back)}"
            echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USER" --password-stdin
            docker push "$API_IMAGE:$IMAGE_TAG"
            docker tag "$API_IMAGE:$IMAGE_TAG" "$API_IMAGE:latest"
            docker push "$API_IMAGE:latest"
          '''
        }
        script {
          env.PUBLISHED_IMAGE = "${env.API_IMAGE}:${env.IMAGE_TAG} (and latest)"
        }
      }
      post {
        failure {
          markFailedStage()
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
              echo "Warning: notification email was not sent (exit code ${status}). The build result was not changed."
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

def markFailedStage() {
  env.FAILED_STAGE = env.FAILED_STAGE ? "${env.FAILED_STAGE}, ${env.STAGE_NAME}" : env.STAGE_NAME
}
