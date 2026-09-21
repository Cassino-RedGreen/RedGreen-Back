const {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const Root = resolve(__dirname, '../..');
const Artifacts = resolve(Root, 'test/performance/artifacts');
const K6 = process.env.K6_BIN || 'k6';
mkdirSync(Artifacts, { recursive: true });
const Reports = [
  {
    id: 'load',
    title: 'Carga sustentada',
    script: 'sustained-load.js',
    json: 'test/performance/artifacts/load-report.json',
    html: 'test/performance/artifacts/load-report.html',
  },
  {
    id: 'stress',
    title: 'Estresse concorrente',
    script: 'session-concurrency.js',
    json: 'test/performance/artifacts/stress-report.json',
    html: 'test/performance/artifacts/stress-report.html',
  },
];

let FailedRuns = 0;

for (const Report of Reports) {
  console.log(`\n=== ${Report.title} ===\n`);
  const Result = spawnSync(
    K6,
    [
      'run',
      '--out',
      `json=${Report.json}`,
      `test/performance/${Report.script}`,
    ],
    {
      cwd: Root,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    }
  );

  if (Result.error || Result.status !== 0) FailedRuns += 1;
}

function EmbedReport(Report) {
  if (!existsSync(resolve(Root, Report.html))) {
    return `<section class="missing"><h2>${Report.title}</h2><p>Relatorio nao gerado.</p></section>`;
  }

  const Html = readFileSync(resolve(Root, Report.html));
  const Base64 = Html.toString('base64');
  return `<section class="report-panel" data-report="${Report.id}"><iframe title="${Report.title}" src="data:text/html;base64,${Base64}"></iframe></section>`;
}

const Combined = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Relatorio k6 - Carga e Estresse</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #f3f4f6; color: #17202a; }
    header { padding: 24px 32px 16px; background: #17202a; color: #fff; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    p { margin: 0; color: #cbd5e1; }
    nav { display: flex; gap: 8px; padding: 12px 32px; background: #fff; border-bottom: 1px solid #d9dee5; }
    button { border: 1px solid #b8c1cc; border-radius: 4px; padding: 8px 14px; background: #fff; color: #17202a; cursor: pointer; }
    button.active { background: #1769aa; border-color: #1769aa; color: #fff; }
    main { padding: 16px 32px 32px; }
    .report-panel { display: none; height: calc(100vh - 150px); min-height: 720px; background: #fff; border: 1px solid #d9dee5; }
    .report-panel.active { display: block; }
    iframe { width: 100%; height: 100%; min-height: 720px; border: 0; }
    .missing { padding: 24px; background: #fff; border: 1px solid #d9dee5; }
  </style>
</head>
<body>
  <header>
    <h1>Relatorio k6: carga e estresse</h1>
    <p>Relatorios gerados em ${new Date().toISOString()}</p>
  </header>
  <nav aria-label="Relatorios">
    <button class="tab active" data-target="load">Carga sustentada</button>
    <button class="tab" data-target="stress">Estresse concorrente</button>
  </nav>
  <main>
    ${Reports.map(EmbedReport).join('\n')}
  </main>
  <script>
    const Tabs = document.querySelectorAll('.tab');
    const Panels = document.querySelectorAll('.report-panel');
    function ShowReport(target) {
      Tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.target === target));
      Panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.report === target));
    }
    Tabs.forEach((tab) => tab.addEventListener('click', () => ShowReport(tab.dataset.target)));
    ShowReport('load');
  </script>
</body>
</html>`;

writeFileSync(resolve(Artifacts, 'combined-report.html'), Combined);
writeFileSync(resolve(Artifacts, 'index.html'), Combined);
console.log(
  '\nRelatorio combinado: test/performance/artifacts/combined-report.html'
);

if (FailedRuns > 0) {
  console.error(`\n${FailedRuns} teste(s) ultrapassaram threshold.`);
  process.exitCode = 1;
}
