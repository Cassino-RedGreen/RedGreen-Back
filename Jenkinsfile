pipeline {
  agent any

  parameters {
    booleanParam(
      name: 'RUN_PERFORMANCE',
      defaultValue: false,
      description: 'Executa a suíte completa de performance (k6).'
    )
  }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 90, unit: 'MINUTES')
  }

  environment {
    HUSKY = '0'
    POSTGRES_IMAGE = 'postgres:15'
    POSTGRES_USER = 'postgres'
    POSTGRES_DB = 'redgreen'
    API_HEALTH_CMD = 'node -e "fetch(\'http://localhost:3000/\').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"'
  }

  stages {
    stage('Prepare') {
      steps {
        script {
          def branch = (env.BRANCH_NAME ?: 'local').toLowerCase().replaceAll('[^a-z0-9]+', '-')
          env.CI_PREFIX = "redgreen-ci-${branch}-${env.BUILD_NUMBER}"
          env.CI_NETWORK = "${env.CI_PREFIX}-net"
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(7)}"
          env.API_IMAGE = 'redgreen-back-api'
          env.CI_WORKSPACE = "/workspace/${env.CI_PREFIX}"
          env.COVERAGE_REPORT_URL = "${env.REPORT_SERVER_URL}/reports/unit/${env.CI_PREFIX}/coverage/lcov-report/index.html"
          env.E2E_REPORT_URL = "${env.REPORT_SERVER_URL}/reports/e2e/${env.CI_PREFIX}/"
        }
        echo "CI prefix: ${env.CI_PREFIX} | image: ${env.API_IMAGE}:${env.IMAGE_TAG}"
        sh '''
          node --version
          npm --version
          docker version
          mkdir -p reports test-results package performance-results
          tar -czf runner-source.tar.gz \
            --exclude=.git \
            --exclude='.env*' \
            --exclude=runner-source.tar.gz \
            --exclude=node_modules \
            --exclude=dist \
            --exclude=coverage \
            --exclude=reports \
            --exclude=test-results \
            --exclude=test/performance/artifacts \
            --exclude=temp \
            .
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
        script {
          def runner = prepareRunner('unit-tests', true)
          env.UNIT_RUNNER_ID = runner
          def status = sh(
            returnStatus: true,
            script: "docker exec --workdir '${env.CI_WORKSPACE}' '${runner}' npm run test:cov"
          )
          copyFromContainer(runner, "${env.CI_WORKSPACE}/reports/.", 'reports/')
          if (fileExists('reports/unit/junit.xml')) {
            junit(testResults: 'reports/unit/junit.xml')
            sh "node scripts/build-ci-report-index.cjs unit reports/unit/junit.xml reports/unit/index.html '${env.CI_PREFIX}' '${env.BUILD_URL}'"
          }
          if (hasFiles('reports', '*')) {
            archiveArtifacts(artifacts: 'reports/**')
          }
          publishReport('unit', 'reports/unit')
          echo "Unit tests and coverage report: ${env.COVERAGE_REPORT_URL}"
          requireReports([
            'reports/unit/junit.xml',
            'reports/unit/coverage/cobertura-coverage.xml',
            'reports/unit/coverage/lcov-report/index.html',
          ], status)
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
        script {
          if (!fileExists('docker/Dockerfile.api')) {
            error('docker/Dockerfile.api not found: the API image is required for Build & Package and E2E Tests.')
          }
        }
        sh '''
          docker build -f docker/Dockerfile.api -t "$API_IMAGE:$IMAGE_TAG" .
          docker create --name "$CI_PREFIX-dist" "$API_IMAGE:$IMAGE_TAG"
          docker cp "$CI_PREFIX-dist:/app/dist" package/dist
          docker rm "$CI_PREFIX-dist"
          cp package.json package-lock.json package/
          tar -czf "redgreen-back-$IMAGE_TAG.tar.gz" -C package .
        '''
        script {
          def packageFile = "redgreen-back-${env.IMAGE_TAG}.tar.gz"
          requireReports([packageFile], 0)
          archiveArtifacts(artifacts: packageFile, fingerprint: true)
        }
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
          sh '''
            docker network create "$CI_NETWORK"
            docker run -d --name "$CI_PREFIX-pg" --network "$CI_NETWORK" \
              -e POSTGRES_USER -e POSTGRES_PASSWORD -e POSTGRES_DB \
              --health-cmd 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
              --health-interval 5s --health-timeout 5s --health-retries 24 \
              "$POSTGRES_IMAGE"
          '''
          waitHealthy("${env.CI_PREFIX}-pg", 120)
          sh '''
            docker run -d --name "$CI_PREFIX-api" --network "$CI_NETWORK" --network-alias api \
              -e PORT=3000 -e POSTGRES_HOST="$CI_PREFIX-pg" -e POSTGRES_PORT=5432 \
              -e POSTGRES_USER -e POSTGRES_PASSWORD -e POSTGRES_DB -e POSTGRES_SSL=false -e JWT_SECRET \
              --health-cmd "$API_HEALTH_CMD" \
              --health-interval 5s --health-timeout 5s --health-retries 24 --health-start-period 10s \
              "$API_IMAGE:$IMAGE_TAG"
          '''
          waitHealthy("${env.CI_PREFIX}-api", 180)
          script {
            def runner = prepareRunner('e2e-tests', true)
            env.E2E_RUNNER_ID = runner
            sh "docker network connect '${env.CI_NETWORK}' '${runner}'"
            def status = sh(
              returnStatus: true,
              script: "docker exec --workdir '${env.CI_WORKSPACE}' --env API_BASE_URL=http://api:3000 '${runner}' npm run test:all"
            )
            copyFromContainer(runner, "${env.CI_WORKSPACE}/test-results/.", 'test-results/')
            if (hasFiles('test-results', '*')) {
              if (findFiles(glob: 'test-results/*/summary.json').length > 0) {
                sh "node scripts/build-ci-report-index.cjs e2e test-results '${env.CI_PREFIX}' '${env.BUILD_URL}'"
              }
              archiveArtifacts(artifacts: 'test-results/**')
              publishReport('e2e', 'test-results')
              echo "E2E HTML reports: ${env.E2E_REPORT_URL}"
            }

            verifyE2eReports(status)
            if (status != 0) {
              sh 'docker logs --tail 200 "$CI_PREFIX-api" || true'
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

    stage('Performance Tests') {
      when {
        expression { params.RUN_PERFORMANCE }
      }
      steps {
        script {
          def runner = prepareRunner('performance')
          env.PERFORMANCE_RUNNER_ID = runner
          sh "docker network connect '${env.CI_NETWORK}' '${runner}'"
          def status = sh(
            returnStatus: true,
            script: "docker exec --workdir '${env.CI_WORKSPACE}' --env BASE_URL=http://api:3000 '${runner}' node test/performance/run-all.cjs"
          )
          copyFromContainer(
            runner,
            "${env.CI_WORKSPACE}/test/performance/artifacts/.",
            'performance-results/'
          )
          if (hasFiles('performance-results', '*')) {
            archiveArtifacts(artifacts: 'performance-results/**')
          }
          if (status != 0) {
            error("Performance tests failed (exit code ${status}).")
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
      sh '''
        if [ -n "${CI_PREFIX:-}" ]; then
          for runner in "${E2E_RUNNER_ID:-}" "${PERFORMANCE_RUNNER_ID:-}"; do
            if [ -n "$runner" ]; then
              docker network disconnect "$CI_NETWORK" "$runner" >/dev/null 2>&1 || true
            fi
          done
          docker rm -f "$CI_PREFIX-dist" "$CI_PREFIX-api" "$CI_PREFIX-pg" >/dev/null 2>&1 || true
          docker network rm "$CI_NETWORK" >/dev/null 2>&1 || true
          docker image rm "$API_IMAGE:$IMAGE_TAG" >/dev/null 2>&1 || true
        fi
      '''
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
      cleanWs()
    }
  }
}

def markFailedStage() {
  env.FAILED_STAGE = env.FAILED_STAGE ? "${env.FAILED_STAGE}, ${env.STAGE_NAME}" : env.STAGE_NAME
}

def prepareRunner(String service, boolean installDependencies = false) {
  def output = sh(
    returnStdout: true,
    script: "docker ps -q --filter label=com.docker.compose.project=redgreen --filter label=com.docker.compose.service='${service}'"
  ).trim()
  def runners = output ? output.split('\n') : []
  if (runners.length != 1) {
    def command = service == 'performance'
      ? 'docker compose --profile performance up -d --build performance'
      : 'docker compose up -d --build'
    error("Expected one running Compose runner for '${service}', found ${runners.length}. Start it with '${command}'.")
  }

  def runner = runners[0]
  withEnv(["RUNNER_ID=${runner}", "RUNNER_WORKSPACE=${env.CI_WORKSPACE}"]) {
    sh '''
      docker exec "$RUNNER_ID" mkdir -p "$RUNNER_WORKSPACE"
      docker cp "$WORKSPACE/runner-source.tar.gz" "$RUNNER_ID:/tmp/runner-source.tar.gz"
      docker exec "$RUNNER_ID" tar -xzf /tmp/runner-source.tar.gz -C "$RUNNER_WORKSPACE"
      docker exec "$RUNNER_ID" rm /tmp/runner-source.tar.gz
    '''
    if (installDependencies) {
      sh "docker exec --workdir '${env.CI_WORKSPACE}' '${runner}' npm ci --no-audit --no-fund"
    }
  }
  return runner
}

def publishReport(String type, String source) {
  if (!hasFiles(source, '*')) {
    echo "No files found at ${source}; nothing to publish for ${type}."
    return
  }
  withEnv([
    "REPORT_TYPE=${type}",
    "REPORT_SOURCE=${source}",
    "REPORT_BUILD_KEY=${env.CI_PREFIX}",
  ]) {
    sh '''
      target="$REPORTS_VOLUME_PATH/$REPORT_TYPE/$REPORT_BUILD_KEY"
      mkdir -p "$target"
      cp -a "$REPORT_SOURCE"/. "$target"/
      node scripts/build-ci-report-index.cjs listing "$REPORT_TYPE" "$REPORTS_VOLUME_PATH/$REPORT_TYPE"
    '''
  }
}

def copyFromContainer(String container, String source, String target) {
  def status = sh(returnStatus: true, script: "docker cp '${container}:${source}' '${target}'")
  if (status != 0) {
    echo "Warning: docker cp from ${container}:${source} failed (exit code ${status}). The report checks below list what is missing."
  }
}

def hasFiles(String dir, String name) {
  return sh(returnStatus: true, script: "find '${dir}' -type f -name '${name}' 2>/dev/null | grep -q .") == 0
}

def recordMissing(String path, String kind) {
  def entry = "${path} (${env.STAGE_NAME}, ${kind})"
  env.MISSING_REPORTS = env.MISSING_REPORTS ? "${env.MISSING_REPORTS}; ${entry}" : entry
}

def requireReports(List paths, int testStatus) {
  def missing = []
  for (path in paths) {
    if (!fileExists(path)) {
      missing << path
    }
  }
  failOnMissing(missing, testStatus)
}

def failOnMissing(List missing, int testStatus) {
  if (!missing) {
    return
  }
  for (path in missing) {
    recordMissing(path, 'required')
  }
  def note = testStatus != 0 ? " The test command also exited with code ${testStatus}." : ''
  error("Required report missing in stage '${env.STAGE_NAME}': ${missing.join(', ')}.${note}")
}

// Applies the E2E report rules after test-results/ is copied from the container:
// a required file missing => FAILURE (via failOnMissing); no JUnit file at all => UNSTABLE.
def verifyE2eReports(int testStatus) {
  def result = checkE2eReports('test-results')

  // JUnit is optional: only some scenarios produce it today.
  if (findFiles(glob: 'test-results/*/junit-*.xml').length > 0) {
    junit(testResults: 'test-results/*/junit-*.xml')
    if (result.withoutJunit) {
      echo "Info: E2E scenarios without a JUnit report: ${result.withoutJunit.join(', ')}."
    }
  } else {
    recordMissing('test-results/<timestamp>/junit-*.xml', 'optional')
    unstable("Optional E2E JUnit reports (test-results/<timestamp>/junit-*.xml) not found in stage '${env.STAGE_NAME}'. Results are only in the Newman JSON/HTML files.")
  }

  failOnMissing(result.missing, testStatus)
}

// Lists what the E2E run should have produced but did not.
// Returns [missing: required paths not found, withoutJunit: scenarios without a JUnit file].
def checkE2eReports(String resultsDir) {
  // 1. Each run is written to <resultsDir>/<timestamp>/; the most recent one is checked.
  //    findFiles only returns files, so the run folders come from the files inside them.
  //    The timestamp format (ISO 8601) sorts correctly as text.
  def latestRun = null
  for (file in findFiles(glob: "${resultsDir}/*/*")) {
    def run = file.path.substring(0, file.path.lastIndexOf('/'))
    if (latestRun == null || run > latestRun) {
      latestRun = run
    }
  }
  if (latestRun == null) {
    return [missing: ["${resultsDir}/<timestamp>/"], withoutJunit: []]
  }

  // 2. summary.json is written by the runner at the end and lists the scenarios that ran.
  //    Without it there is no way to know which reports should exist.
  def summary = "${latestRun}/summary.json"
  if (!fileExists(summary)) {
    return [missing: [summary], withoutJunit: []]
  }

  // 3. Read the scenario list. Invalid JSON or an empty list means the run cannot be trusted.
  //    returnPojo gives plain Map/List/null values instead of net.sf.json types.
  def data = null
  try {
    data = readJSON(file: summary, returnPojo: true)
  } catch (err) {
    return [missing: ["${summary} (invalid JSON)"], withoutJunit: []]
  }
  def scenarios = (data instanceof Map) ? data.scenarios : null
  if (!(scenarios instanceof List) || scenarios.isEmpty()) {
    return [missing: ["${summary} (no scenarios listed)"], withoutJunit: []]
  }

  // 4. Check each scenario. The paths in summary.json are runner-container paths,
  //    so only the file name is kept and looked up in the copied run folder.
  //    Newman JSON missing => required (FAILURE); JUnit missing => only listed (optional).
  def missing = []
  def withoutJunit = []
  for (scenario in scenarios) {
    def name = scenario.script ?: '?'
    def reportPath = scenario.report ? scenario.report.toString() : ''
    if (!reportPath) {
      missing << "${summary} (scenario ${name} has no report path)"
      continue
    }
    def reportFile = reportPath.substring(reportPath.lastIndexOf('/') + 1)
    if (!fileExists("${latestRun}/${reportFile}")) {
      missing << "${latestRun}/${reportFile}"
    }
    def baseName = reportFile.endsWith('.json') ? reportFile.substring(0, reportFile.length() - 5) : reportFile
    if (!fileExists("${latestRun}/junit-${baseName}.xml")) {
      withoutJunit << name
    }
  }
  return [missing: missing, withoutJunit: withoutJunit]
}

def waitHealthy(String container, int seconds) {
  def status = 0
  withEnv(["WAIT_CONTAINER=${container}", "WAIT_SECONDS=${seconds}"]) {
    status = sh(returnStatus: true, script: '''
      deadline=$(( $(date +%s) + WAIT_SECONDS ))
      while [ "$(date +%s)" -lt "$deadline" ]; do
        state=$(docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "$WAIT_CONTAINER" 2>/dev/null || echo missing)
        case "$state" in
          */healthy) exit 0 ;;
          */unhealthy) echo "$WAIT_CONTAINER is unhealthy"; exit 1 ;;
          running/*) sleep 3 ;;
          *) echo "$WAIT_CONTAINER stopped ($state)"; exit 1 ;;
        esac
      done
      echo "$WAIT_CONTAINER did not become healthy within ${WAIT_SECONDS}s"
      exit 1
    ''')
  }
  if (status != 0) {
    sh "docker logs --tail 200 '${container}' || true"
    error("Container ${container} did not become healthy.")
  }
}
