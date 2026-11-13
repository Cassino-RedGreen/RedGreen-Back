const {
  existsSync: ExistsSync,
  readFileSync: ReadFileSync,
  readdirSync: ReadDirSync,
  statSync: StatSync,
  writeFileSync: WriteFileSync,
} = require('node:fs');
const {
  basename: Basename,
  join: Join,
  resolve: Resolve,
} = require('node:path');

const EntityMap = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function Escape(Value) {
  return String(Value ?? '').replace(/[&<>"']/g, (Character) => {
    const Entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return Entities[Character];
  });
}

function Attributes(Tag) {
  return Object.fromEntries(
    [...Tag.matchAll(/([:\w-]+)="([^"]*)"/g)].map(([, Key, Value]) => [
      Key,
      Value.replace(
        /&(?:amp|lt|gt|quot|apos);/g,
        (Entity) => EntityMap[Entity]
      ),
    ])
  );
}

function Page(Title, Build, Body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${Escape(Title)} · RedGreen reports</title>
    <style>
      :root { color-scheme: light dark; --bg: #f6f8fa; --panel: #fff; --fg: #1f2328; --muted: #656d76; --line: #d1d9e0; --accent: #0969da; --ok: #1a7f37; --bad: #cf222e; }
      @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --panel: #161b22; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --accent: #58a6ff; --ok: #3fb950; --bad: #f85149; } }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, sans-serif; }
      header { padding: 2rem max(1.25rem, calc((100% - 64rem) / 2)); background: #172b4d; color: #fff; }
      header p { margin: .25rem 0 0; color: #d6e2f0; }
      h1 { margin: 0; font-size: clamp(1.4rem, 3vw, 2rem); }
      main { max-width: 64rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
      .back { display: inline-block; margin-bottom: 1rem; color: var(--accent); }
      .build { color: var(--muted); font-size: .9rem; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .85rem; margin: 1.25rem 0; }
      .metric, .panel { padding: 1rem 1.1rem; background: var(--panel); border: 1px solid var(--line); border-radius: .65rem; }
      .metric strong { display: block; font-size: 1.65rem; line-height: 1.25; }
      .metric span, .muted { color: var(--muted); }
      .ok { color: var(--ok); } .bad { color: var(--bad); }
      .panel { overflow-x: auto; margin: 1rem 0; }
      h2 { margin: 0 0 .75rem; font-size: 1.1rem; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: .6rem .65rem; border-bottom: 1px solid var(--line); text-align: left; }
      th { color: var(--muted); font-size: .8rem; text-transform: uppercase; }
      tr:last-child td { border-bottom: 0; }
      a { color: var(--accent); }
      .actions { display: flex; flex-wrap: wrap; gap: .65rem; margin: 1rem 0; }
      .button { display: inline-block; padding: .6rem .85rem; border: 1px solid var(--line); border-radius: .45rem; background: var(--panel); text-decoration: none; }
      footer { color: var(--muted); font-size: .85rem; margin-top: 1.5rem; }
    </style>
  </head>
  <body>
    <header>
      <h1>${Escape(Title)}</h1>
      <p>RedGreen · relatórios de CI</p>
    </header>
    <main>
      <a class="back" href="/">&larr; Todos os relatórios</a>
      <div class="build">Build: ${Escape(Build)}</div>
${Body}
      <footer>Relatório gerado pela pipeline Jenkins.</footer>
    </main>
  </body>
</html>
`;
}

function UnitReport(JunitPath, OutputPath, Build, JenkinsBuildUrl) {
  if (!ExistsSync(JunitPath)) {
    throw new Error(`JUnit report not found: ${JunitPath}`);
  }
  const Xml = ReadFileSync(JunitPath, 'utf8');
  const Root = Xml.match(/<(?:testsuites|testsuite)\b[^>]*>/)?.[0];
  if (!Root) throw new Error(`Invalid JUnit report: ${JunitPath}`);
  const Stats = Attributes(Root);
  const Suites = [...Xml.matchAll(/<testsuite\b[^>]*>/g)]
    .map(([Tag]) => Attributes(Tag))
    .filter((Suite) => Suite.name);
  const Failures = Number(Stats.failures || 0) + Number(Stats.errors || 0);
  const Status = Failures ? 'Failed' : 'Passed';
  const SuiteRows = Suites.map((Suite) => {
    const Failed = Number(Suite.failures || 0) + Number(Suite.errors || 0);
    return `          <tr><td>${Escape(Suite.name)}</td><td class="${Failed ? 'bad' : 'ok'}">${Failed ? 'Failed' : 'Passed'}</td><td>${Escape(Suite.tests || 0)}</td><td>${Escape(Failed)}</td><td>${Escape(Suite.skipped || 0)}</td></tr>`;
  }).join('\n');
  const Links = [
    '<a class="button" href="coverage/lcov-report/index.html">Open coverage report</a>',
    '<a class="button" href="junit.xml">Download JUnit XML</a>',
  ];
  if (JenkinsBuildUrl) {
    Links.push(
      `<a class="button" href="${Escape(`${JenkinsBuildUrl}testReport/`)}">Detailed results in Jenkins</a>`
    );
  }
  const Body = `      <div class="grid">
        <div class="metric"><strong>${Escape(Stats.tests || 0)}</strong><span>Tests</span></div>
        <div class="metric"><strong class="${Failures ? 'bad' : 'ok'}">${Status}</strong><span>Unit test result</span></div>
        <div class="metric"><strong>${Escape(Failures)}</strong><span>Failures and errors</span></div>
        <div class="metric"><strong>${Escape(Stats.skipped || 0)}</strong><span>Skipped</span></div>
      </div>
      <div class="actions">${Links.join('\n        ')}</div>
      <section class="panel">
        <h2>Test suites</h2>
        <table>
          <thead><tr><th>Suite</th><th>Result</th><th>Tests</th><th>Failures</th><th>Skipped</th></tr></thead>
          <tbody>
${SuiteRows || '            <tr><td colspan="5" class="muted">No test suite details found.</td></tr>'}
          </tbody>
        </table>
      </section>`;
  WriteFileSync(OutputPath, Page('Unit tests', Build, Body));
}

function E2eReport(ResultsDir, Build, JenkinsBuildUrl) {
  const Runs = ReadDirSync(ResultsDir, { withFileTypes: true })
    .filter(
      (Entry) =>
        Entry.isDirectory() &&
        ExistsSync(Join(ResultsDir, Entry.name, 'summary.json'))
    )
    .map((Entry) => Entry.name)
    .sort();
  const LatestRun = Runs.at(-1);
  if (!LatestRun) throw new Error(`E2E summary not found in ${ResultsDir}`);

  const RunDir = Join(ResultsDir, LatestRun);
  const Summary = JSON.parse(
    ReadFileSync(Join(RunDir, 'summary.json'), 'utf8')
  );
  const Scenarios = Summary.scenarios || [];
  if (!Scenarios.length) throw new Error(`No E2E scenarios found in ${RunDir}`);

  const Rows = Scenarios.map((Scenario) => {
    const JsonName = Basename(Scenario.report || '');
    const HtmlName = `report-${JsonName.replace(/\.json$/i, '')}.html`;
    const JsonPath = Join(RunDir, JsonName);
    let Report;
    if (ExistsSync(JsonPath))
      Report = JSON.parse(ReadFileSync(JsonPath, 'utf8'));
    const Stats = Report?.run?.stats;
    const Failed =
      Scenario.exitCode !== 0 ||
      Boolean(Scenario.error) ||
      Number(Scenario.failures || 0) > 0;
    const Requests = Stats?.requests?.total ?? '-';
    const Assertions = Stats
      ? `${Stats.assertions.total - Stats.assertions.failed}/${Stats.assertions.total}`
      : '-';
    const Duration = Report?.run?.timings
      ? `${((Report.run.timings.completed - Report.run.timings.started) / 1000).toFixed(1)}s`
      : '-';
    const Link = ExistsSync(Join(RunDir, HtmlName))
      ? `<a href="${Escape(`${LatestRun}/${HtmlName}`)}">Open HTML report</a>`
      : '<span class="muted">Not generated</span>';
    return `          <tr><td>${Escape(Scenario.script)}</td><td class="${Failed ? 'bad' : 'ok'}">${Failed ? 'Failed' : 'Passed'}</td><td>${Escape(Requests)}</td><td>${Escape(Assertions)}</td><td>${Escape(Duration)}</td><td>${Link}</td></tr>`;
  });
  const FailedCount = Scenarios.filter(
    (Scenario) =>
      Scenario.exitCode !== 0 ||
      Boolean(Scenario.error) ||
      Number(Scenario.failures || 0) > 0
  ).length;
  const JenkinsLink = JenkinsBuildUrl
    ? `<a class="button" href="${Escape(`${JenkinsBuildUrl}testReport/`)}">Detailed results in Jenkins</a>`
    : '';
  const Body = `      <div class="grid">
        <div class="metric"><strong>${Scenarios.length}</strong><span>Scenarios</span></div>
        <div class="metric"><strong class="${FailedCount ? 'bad' : 'ok'}">${FailedCount ? 'Failed' : 'Passed'}</strong><span>E2E result</span></div>
        <div class="metric"><strong>${FailedCount}</strong><span>Failed scenarios</span></div>
      </div>
      <div class="actions">${JenkinsLink}<a class="button" href="${Escape(`${LatestRun}/summary.json`)}">Run summary JSON</a></div>
      <section class="panel">
        <h2>API scenarios</h2>
        <table>
          <thead><tr><th>Scenario</th><th>Result</th><th>Requests</th><th>Assertions passed</th><th>Duration</th><th>Report</th></tr></thead>
          <tbody>
${Rows.join('\n')}
          </tbody>
        </table>
      </section>`;
  WriteFileSync(
    Join(ResultsDir, 'index.html'),
    Page('API end-to-end tests', Build, Body)
  );
}

function ReportDirectoryIndex(Type, ReportsDir) {
  const IsUnit = Type === 'unit';
  if (!IsUnit && Type !== 'e2e') {
    throw new Error(`Unknown report type: ${Type}`);
  }
  const Builds = ReadDirSync(ReportsDir, { withFileTypes: true })
    .filter(
      (Entry) =>
        Entry.isDirectory() &&
        ExistsSync(Join(ReportsDir, Entry.name, 'index.html'))
    )
    .map((Entry) => ({
      Name: Entry.name,
      Modified: StatSync(Join(ReportsDir, Entry.name)).mtimeMs,
    }))
    .sort(
      (Left, Right) =>
        Right.Modified - Left.Modified ||
        Right.Name.localeCompare(Left.Name, undefined, { numeric: true })
    );
  const Rows = Builds.map(({ Name }) => {
    const Path = encodeURIComponent(Name);
    const IndexLink = `<a href="${Path}/index.html">Open summary</a>`;
    const ExtraLink = IsUnit
      ? `<a href="${Path}/coverage/lcov-report/index.html">Coverage</a>`
      : '';
    return `          <tr><td>${Escape(Name)}</td><td>${IndexLink}</td><td>${ExtraLink || '<span class="muted">—</span>'}</td></tr>`;
  });
  const Body = Builds.length
    ? `      <section class="panel">
        <h2>Available builds</h2>
        <table>
          <thead><tr><th>Build</th><th>${IsUnit ? 'Unit test results' : 'E2E test results'}</th><th>${IsUnit ? 'Coverage' : ' '}</th></tr></thead>
          <tbody>
${Rows.join('\n')}
          </tbody>
        </table>
      </section>`
    : '      <section class="panel"><p class="muted">No reports have been published yet.</p></section>';
  const Title = IsUnit ? 'Unit tests and coverage' : 'API end-to-end tests';
  WriteFileSync(
    Join(ReportsDir, 'index.html'),
    Page(Title, 'All builds', Body)
  );
}

function Main() {
  const [Type, ...Args] = process.argv.slice(2);
  if (Type === 'unit' && Args.length >= 3) {
    UnitReport(Resolve(Args[0]), Resolve(Args[1]), Args[2], Args[3] || '');
    return;
  }
  if (Type === 'e2e' && Args.length >= 2) {
    E2eReport(Resolve(Args[0]), Args[1], Args[2] || '');
    return;
  }
  if (Type === 'listing' && Args.length === 2) {
    ReportDirectoryIndex(Args[0], Resolve(Args[1]));
    return;
  }
  throw new Error(
    'Usage: node scripts/build-ci-report-index.cjs unit <junit.xml> <output.html> <build> [jenkins-build-url] | e2e <results-dir> <build> [jenkins-build-url] | listing <unit|e2e> <reports-dir>'
  );
}

Main();
