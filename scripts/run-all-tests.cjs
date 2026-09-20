const { spawn } = require('node:child_process');
const {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { resolve, join } = require('node:path');
const { scripts } = require('../package.json');

const root = resolve(__dirname, '..');
const reportDir = join(
  root,
  'test-results',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const categories = {
  iterations: 'iterations',
  requests: 'requests',
  'test-scripts': 'testScripts',
  'prerequest-scripts': 'prerequestScripts',
  assertions: 'assertions',
};

function runScenario(script) {
  return new Promise((resolveRun) => {
    const name = script.replace(/:/g, '-');
    const report = join(reportDir, `${name}.json`);
    const log = `${name}.log`;
    const fd = openSync(join(reportDir, log), 'w');
    const args = [process.env.npm_execpath, 'run', script];
    if (scripts[script].startsWith('newman ')) {
      args.push(
        '--',
        '--reporters',
        'cli,json',
        '--reporter-json-export',
        report
      );
    }
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: {
        ...process.env,
        CI: 'true',
        FORCE_COLOR: '0',
        TEST_CASE_REPORT: report,
      },
      stdio: ['ignore', fd, fd],
    });
    let error;
    child.on('error', (cause) => {
      error = cause.message;
    });
    child.on('close', (exitCode, signal) => {
      closeSync(fd);
      resolveRun({ script, report, log, exitCode, signal, error });
    });
  });
}

function printTable(totals) {
  const widths = [19, 12, 12];
  const border = (left, middle, right) =>
    left + widths.map((width) => '─'.repeat(width)).join(middle) + right;
  const row = (values) =>
    '│' +
    values
      .map((value, index) => String(value).padStart(widths[index] - 1) + ' ')
      .join('│') +
    '│';
  console.log(border('┌', '┬', '┐'));
  console.log(row(['', 'executed', 'failed']));
  for (const [name, stats] of Object.entries(totals)) {
    console.log(border('├', '┼', '┤'));
    console.log(row([name, stats.executed, stats.failed]));
  }
  console.log(border('└', '┴', '┘'));
}

async function main() {
  if (!process.env.npm_execpath)
    throw new Error('Execute com npm run test:all.');
  const scenarios = Object.keys(scripts).filter((name) =>
    name.startsWith('test:api:')
  );
  if (!scenarios.length)
    throw new Error('Nenhum cenario Newman/Postman encontrado.');
  mkdirSync(reportDir, { recursive: true });
  const totals = Object.fromEntries(
    Object.keys(categories).map((name) => [name, { executed: 0, failed: 0 }])
  );
  const results = [];
  for (const script of scenarios) {
    console.log(`Executando ${script}...`);
    const result = await runScenario(script);
    try {
      const report = JSON.parse(readFileSync(result.report, 'utf8'));
      // Validate the whole report before adding any counts to the totals.
      for (const key of Object.values(categories)) {
        const stats = report.run?.stats?.[key];
        if (
          !Number.isInteger(stats?.total) ||
          !Number.isInteger(stats?.failed)
        ) {
          throw new Error(`Estatisticas Newman ausentes ou invalidas: ${key}`);
        }
      }
      for (const [name, key] of Object.entries(categories)) {
        totals[name].executed += report.run.stats[key].total;
        totals[name].failed += report.run.stats[key].failed;
      }
      result.failures = report.run.failures?.length || 0;
    } catch (cause) {
      result.error = [
        result.error,
        `Relatorio indisponivel/invalido: ${cause.message}`,
      ]
        .filter(Boolean)
        .join('; ');
    }
    results.push(result);
  }
  console.log('\nTotal consolidado Newman/Postman:');
  printTable(totals);
  const failed = results.filter(
    (result) => result.exitCode !== 0 || result.error || result.failures
  );
  for (const result of failed) {
    console.error(
      `${result.script}: FALHOU. ${result.error || 'Consulte o log para detalhes.'} Log: ${result.log}`
    );
  }
  if (results.some((result) => result.error)) {
    console.error(
      'Totais parciais: cenarios sem relatorio valido nao foram somados.'
    );
  }
  console.log(`Logs e summary.json: ${reportDir}`);
  writeFileSync(
    join(reportDir, 'summary.json'),
    JSON.stringify({ totals, scenarios: results }, null, 2) + '\n'
  );
  process.exitCode =
    failed.length || Object.values(totals).some((stats) => stats.failed > 0)
      ? 1
      : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
