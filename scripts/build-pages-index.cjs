const {
  copyFileSync: CopyFileSync,
  existsSync: ExistsSync,
  mkdirSync: MkdirSync,
  readdirSync: ReadDirSync,
  readFileSync: ReadFileSync,
  rmSync: RmSync,
  writeFileSync: WriteFileSync,
} = require('node:fs');
const {
  basename: Basename,
  join: Join,
  resolve: Resolve,
} = require('node:path');

// Builds the GitHub Pages site (_site/) published by the single `publish-pages`
// job. The site holds both reports side by side:
//   _site/index.html              landing page linking the two sections
//   _site/e2e/                    `npm run test:all` reports
//   _site/performance/            `npm run test:performance` k6 reports
// Only *.html is copied: logs, JUnit, JSON and summary.json are never published
// because they can hold sensitive data.
// In CI: node scripts/build-pages-index.cjs
const Root = Resolve(__dirname, '..');
const ResultsRoot = Join(Root, 'test-results');
const PerformanceRoot = Join(Root, 'test', 'performance', 'artifacts');
const SiteDir = Join(Root, '_site');
const E2eDir = Join(SiteDir, 'e2e');
const PerformanceDir = Join(SiteDir, 'performance');
// run-all.cjs writes index.html as a copy of combined-report.html; the section
// index is generated here instead, so that duplicate is left out.
const PerformanceReports = [
  { File: 'combined-report.html', Label: 'Combined report (all scenarios)' },
  { File: 'load-report.html', Label: 'Sustained load' },
  { File: 'stress-report.html', Label: 'Concurrent stress' },
  { File: 'vu-scale-report.html', Label: 'VU scale' },
];
const HtmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function LatestRunDir() {
  if (!ExistsSync(ResultsRoot)) return undefined;
  const Runs = ReadDirSync(ResultsRoot, { withFileTypes: true })
    .filter(
      (Entry) =>
        Entry.isDirectory() &&
        ExistsSync(Join(ResultsRoot, Entry.name, 'summary.json'))
    )
    .map((Entry) => Entry.name)
    .sort();
  return Runs.length ? Join(ResultsRoot, Runs.at(-1)) : undefined;
}

function Escape(Value) {
  return String(Value ?? '').replace(/[&<>"']/g, (Char) => HtmlEntities[Char]);
}

function Seconds(Milliseconds) {
  return `${(Milliseconds / 1000).toFixed(1)}s`;
}

function ReadReport(RunDir, Result) {
  try {
    return JSON.parse(
      ReadFileSync(Join(RunDir, Basename(Result.report)), 'utf8')
    );
  } catch {
    return undefined;
  }
}

// Run folders are named after new Date().toISOString() with ":" and "." as "-".
function RunDate(RunDir) {
  const Parsed = new Date(
    Basename(RunDir).replace(
      /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
      'T$1:$2:$3.$4Z'
    )
  );
  return Number.isNaN(Parsed.getTime())
    ? undefined
    : `${Parsed.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function Link(Url, Label) {
  return `<a href="${Escape(Url)}">${Escape(Label)}</a>`;
}

function Metadata(RunDir) {
  const Server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const Repository = process.env.GITHUB_REPOSITORY;
  const Sha = process.env.GITHUB_SHA;
  const RunId = process.env.GITHUB_RUN_ID;
  const Items = [];
  const RunTime = RunDir && RunDate(RunDir);
  if (RunTime) Items.push(['Date', Escape(RunTime)]);
  if (Sha) {
    const Short = Sha.slice(0, 7);
    Items.push([
      'Commit',
      Repository ? Link(`${Server}/${Repository}/commit/${Sha}`, Short) : Short,
    ]);
  }
  if (RunId) {
    const Label = `#${process.env.GITHUB_RUN_NUMBER || RunId}`;
    Items.push([
      'Run',
      Repository
        ? Link(`${Server}/${Repository}/actions/runs/${RunId}`, Label)
        : Escape(Label),
    ]);
  }
  return Items.map(
    ([Name, Value]) => `<div><dt>${Name}</dt><dd>${Value}</dd></div>`
  ).join('\n      ');
}

function Page(Title, Body, Meta, BackLink) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${Escape(Title)}</title>
    <style>
      :root { color-scheme: light dark; --bg: #fff; --fg: #1b1f24; --muted: #59636e; --line: #d1d9e0; --ok: #1a7f37; --bad: #cf222e; }
      @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --ok: #3fb950; --bad: #f85149; } }
      body { margin: 0 auto; max-width: 56rem; padding: 2rem 1rem; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
      h1 { margin: 0 0 .5rem; font-size: 1.5rem; }
      dl { display: flex; flex-wrap: wrap; gap: .25rem 2rem; margin: 1rem 0 1.5rem; }
      dt { color: var(--muted); font-size: .8rem; text-transform: uppercase; }
      dd { margin: 0; }
      .badge { font-weight: 600; }
      .passed { color: var(--ok); }
      .failed { color: var(--bad); }
      .missing { color: var(--muted); }
      .back { display: inline-block; margin-bottom: 1rem; color: var(--muted); font-size: .9rem; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: .5rem .75rem; border-bottom: 1px solid var(--line); text-align: left; }
      td.num, th.num { text-align: right; }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <main>
${BackLink ? `      <a class="back" href="${Escape(BackLink)}">&larr; All reports</a>\n` : ''}      <h1>${Escape(Title)}</h1>
${Body}
      <dl>
      ${Meta}
      </dl>
    </main>
  </body>
</html>
`;
}

// Returns 'passed' | 'failed' | 'missing' so the landing page can show the same
// wording for both sections.
function BuildE2eSection() {
  MkdirSync(E2eDir, { recursive: true });

  const RunDir = LatestRunDir();
  if (!RunDir) {
    WriteFileSync(
      Join(E2eDir, 'index.html'),
      Page(
        'RedGreen E2E report',
        '      <p>No test results were generated for this run.</p>',
        Metadata(),
        '../'
      )
    );
    console.log('No E2E results found; generated an empty E2E index.');
    return 'missing';
  }

  const Reports = ReadDirSync(RunDir).filter((Name) =>
    /^report-[\w.-]+\.html$/.test(Name)
  );
  for (const Name of Reports) {
    CopyFileSync(Join(RunDir, Name), Join(E2eDir, Name));
  }

  const Summary = JSON.parse(
    ReadFileSync(Join(RunDir, 'summary.json'), 'utf8')
  );
  let AnyFailed = false;
  const Rows = [];
  for (const Result of Summary.scenarios) {
    const Report = ReadReport(RunDir, Result);
    const HtmlName = `report-${Basename(Result.report, '.json')}.html`;
    const Failed =
      !Report ||
      Result.exitCode !== 0 ||
      Boolean(Result.error) ||
      Result.failures > 0;
    if (Failed) AnyFailed = true;
    const Stats = Report?.run?.stats;
    const Elapsed =
      (Report?.run?.timings?.completed ?? 0) -
      (Report?.run?.timings?.started ?? 0);
    Rows.push(
      `        <tr>
          <td>${Escape(Result.script)}</td>
          <td class="badge ${Failed ? 'failed' : 'passed'}">${Failed ? 'failed' : 'passed'}</td>
          <td class="num">${Stats ? Escape(Stats.requests.total) : '-'}</td>
          <td class="num">${Stats ? `${Escape(Stats.assertions.total - Stats.assertions.failed)}/${Escape(Stats.assertions.total)}` : '-'}</td>
          <td class="num">${Report ? Seconds(Elapsed) : '-'}</td>
          <td>${Reports.includes(HtmlName) ? Link(HtmlName, 'Open report') : '-'}</td>
        </tr>`
    );
  }

  const Body = `      <p class="badge ${AnyFailed ? 'failed' : 'passed'}">Result: ${AnyFailed ? 'failed' : 'passed'}</p>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Result</th>
            <th class="num">Requests</th>
            <th class="num">Assertions passed</th>
            <th class="num">Duration</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
${Rows.join('\n')}
        </tbody>
      </table>`;
  WriteFileSync(
    Join(E2eDir, 'index.html'),
    Page('RedGreen E2E report', Body, Metadata(RunDir), '../')
  );
  console.log(
    `Generated ${E2eDir} with index.html and ${Reports.length} report(s).`
  );
  return AnyFailed ? 'failed' : 'passed';
}

// k6 exit codes are not reproducible from the HTML, so the job result is read
// from PERFORMANCE_RESULT (needs.load-tests.result) when the workflow sets it.
function PerformanceStatus(Published) {
  if (!Published) return 'missing';
  const Result = process.env.PERFORMANCE_RESULT;
  if (Result === 'success') return 'passed';
  if (Result === 'failure') return 'failed';
  return 'generated';
}

function BuildPerformanceSection() {
  MkdirSync(PerformanceDir, { recursive: true });

  const Available = PerformanceReports.filter((Report) =>
    ExistsSync(Join(PerformanceRoot, Report.File))
  );
  for (const Report of Available) {
    CopyFileSync(
      Join(PerformanceRoot, Report.File),
      Join(PerformanceDir, Report.File)
    );
  }

  const Status = PerformanceStatus(Available.length > 0);
  const Body = Available.length
    ? `      <p class="badge ${StatusClass(Status)}">Result: ${Escape(Status)}</p>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
${Available.map(
  (Report) =>
    `        <tr>
          <td>${Escape(Report.Label)}</td>
          <td>${Link(Report.File, 'Open report')}</td>
        </tr>`
).join('\n')}
        </tbody>
      </table>`
    : '      <p>No performance reports were generated for this run.</p>';

  WriteFileSync(
    Join(PerformanceDir, 'index.html'),
    Page('RedGreen performance report', Body, Metadata(), '../')
  );
  console.log(
    `Generated ${PerformanceDir} with index.html and ${Available.length} report(s).`
  );
  return Status;
}

function StatusClass(Status) {
  if (Status === 'failed') return 'failed';
  if (Status === 'missing') return 'missing';
  return 'passed';
}

function LandingRow(Name, Href, Status) {
  return `        <tr>
          <td>${Status === 'missing' ? Escape(Name) : Link(Href, Name)}</td>
          <td class="badge ${StatusClass(Status)}">${Escape(Status)}</td>
        </tr>`;
}

function Main() {
  RmSync(SiteDir, { recursive: true, force: true });
  MkdirSync(SiteDir, { recursive: true });
  WriteFileSync(Join(SiteDir, '.nojekyll'), '');

  const E2eStatus = BuildE2eSection();
  const PerformanceResult = BuildPerformanceSection();

  const Body = `      <table>
        <thead>
          <tr>
            <th>Report</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
${LandingRow('End-to-end tests', 'e2e/', E2eStatus)}
${LandingRow('Load and stress tests', 'performance/', PerformanceResult)}
        </tbody>
      </table>`;
  WriteFileSync(
    Join(SiteDir, 'index.html'),
    Page('RedGreen test reports', Body, Metadata(LatestRunDir()))
  );
  console.log(`Generated ${SiteDir} landing page.`);
}

Main();
