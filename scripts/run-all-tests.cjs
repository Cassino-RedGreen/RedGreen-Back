const { spawn: Spawn } = require('node:child_process');
const {
  mkdirSync: MkdirSync,
  openSync: OpenSync,
  closeSync: CloseSync,
  readFileSync: ReadFileSync,
  writeFileSync: WriteFileSync,
} = require('node:fs');
const { resolve: Resolve, join: Join } = require('node:path');
const { scripts: Scripts } = require('../package.json');

const Root = Resolve(__dirname, '..');
const ReportDir = Join(
  Root,
  'test-results',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const Categories = {
  iterations: 'iterations',
  requests: 'requests',
  'test-scripts': 'testScripts',
  'prerequest-scripts': 'prerequestScripts',
  assertions: 'assertions',
};

function RunScenario(Script) {
  return new Promise((ResolveRun) => {
    const Name = Script.replace(/:/g, '-');
    const Report = Join(ReportDir, `${Name}.json`);
    const Log = `${Name}.log`;
    const Fd = OpenSync(Join(ReportDir, Log), 'w');
    const Args = [process.env.npm_execpath, 'run', Script];
    if (Scripts[Script].startsWith('newman ')) {
      Args.push(
        '--',
        '--reporters',
        'cli,json',
        '--reporter-json-export',
        Report
      );
    }
    const Child = Spawn(process.execPath, Args, {
      cwd: Root,
      env: {
        ...process.env,
        CI: 'true',
        FORCE_COLOR: '0',
        TEST_CASE_REPORT: Report,
      },
      stdio: ['ignore', Fd, Fd],
    });
    let ErrorObject;
    Child.on('error', (Cause) => {
      ErrorObject = Cause.message;
    });
    Child.on('close', (ExitCode, Signal) => {
      CloseSync(Fd);
      ResolveRun({
        script: Script,
        report: Report,
        log: Log,
        exitCode: ExitCode,
        signal: Signal,
        error: ErrorObject,
      });
    });
  });
}

function PrintTable(Totals) {
  const Widths = [19, 12, 12];
  const Border = (Left, Middle, Right) =>
    Left + Widths.map((Width) => '─'.repeat(Width)).join(Middle) + Right;
  const Row = (Values) =>
    '│' +
    Values.map(
      (Value, Index) => String(Value).padStart(Widths[Index] - 1) + ' '
    ).join('│') +
    '│';
  console.log(Border('┌', '┬', '┐'));
  console.log(Row(['', 'executed', 'failed']));
  for (const [Name, Stats] of Object.entries(Totals)) {
    console.log(Border('├', '┼', '┤'));
    console.log(Row([Name, Stats.executed, Stats.failed]));
  }
  console.log(Border('└', '┴', '┘'));
}

async function Main() {
  if (!process.env.npm_execpath)
    throw new Error('Execute com npm run test:all.');
  const Scenarios = Object.keys(Scripts).filter((Name) =>
    Name.startsWith('test:api:')
  );
  if (!Scenarios.length)
    throw new Error('Nenhum cenario Newman/Postman encontrado.');
  MkdirSync(ReportDir, { recursive: true });
  const Totals = Object.fromEntries(
    Object.keys(Categories).map((Name) => [Name, { executed: 0, failed: 0 }])
  );
  const Results = [];
  for (const Script of Scenarios) {
    console.log(`Executando ${Script}...`);
    const Result = await RunScenario(Script);
    try {
      const Report = JSON.parse(ReadFileSync(Result.report, 'utf8'));
      // Validate the whole report before adding any counts to the totals.
      for (const Key of Object.values(Categories)) {
        const Stats = Report.run?.stats?.[Key];
        if (
          !Number.isInteger(Stats?.total) ||
          !Number.isInteger(Stats?.failed)
        ) {
          throw new Error(`Estatisticas Newman ausentes ou invalidas: ${Key}`);
        }
      }
      for (const [Name, Key] of Object.entries(Categories)) {
        Totals[Name].executed += Report.run.stats[Key].total;
        Totals[Name].failed += Report.run.stats[Key].failed;
      }
      Result.failures = Report.run.failures?.length || 0;
    } catch (Cause) {
      Result.error = [
        Result.error,
        `Relatorio indisponivel/invalido: ${Cause.message}`,
      ]
        .filter(Boolean)
        .join('; ');
    }
    Results.push(Result);
  }
  console.log('\nTotal consolidado Newman/Postman:');
  PrintTable(Totals);
  const Failed = Results.filter(
    (Result) => Result.exitCode !== 0 || Result.error || Result.failures
  );
  for (const Result of Failed) {
    console.error(
      `${Result.script}: FALHOU. ${Result.error || 'Consulte o log para detalhes.'} Log: ${Result.log}`
    );
  }
  if (Results.some((Result) => Result.error)) {
    console.error(
      'Totais parciais: cenarios sem relatorio valido nao foram somados.'
    );
  }
  console.log(`Logs e summary.json: ${ReportDir}`);
  WriteFileSync(
    Join(ReportDir, 'summary.json'),
    JSON.stringify({ totals: Totals, scenarios: Results }, null, 2) + '\n'
  );
  process.exitCode =
    Failed.length || Object.values(Totals).some((Stats) => Stats.failed > 0)
      ? 1
      : 0;
}

Main().catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
