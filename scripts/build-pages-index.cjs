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

// Builds the GitHub Pages site (_site/) from the latest `npm run test:all` run.
// Only the report-*.html files are copied: logs, JUnit, JSON and summary.json
// are never published because they can hold sensitive data.
// In CI: node scripts/build-pages-index.cjs
const Root = Resolve(__dirname, '..');
const ResultsRoot = Join(Root, 'test-results');
const SiteDir = Join(Root, '_site');
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

function Page(Body, Meta) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RedGreen E2E report</title>
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
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: .5rem .75rem; border-bottom: 1px solid var(--line); text-align: left; }
      td.num, th.num { text-align: right; }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <main>
      <h1>RedGreen E2E report</h1>
${Body}
      <dl>
      ${Meta}
      </dl>
    </main>
  </body>
</html>
`;
}

function Main() {
  RmSync(SiteDir, { recursive: true, force: true });
  MkdirSync(SiteDir, { recursive: true });
  WriteFileSync(Join(SiteDir, '.nojekyll'), '');

  const RunDir = LatestRunDir();
  if (!RunDir) {
    WriteFileSync(
      Join(SiteDir, 'index.html'),
      Page(
        '      <p>No test results were generated for this run.</p>',
        Metadata()
      )
    );
    console.log('No test results found; generated an empty report index.');
    return;
  }

  const Reports = ReadDirSync(RunDir).filter((Name) =>
    /^report-[\w.-]+\.html$/.test(Name)
  );
  for (const Name of Reports) {
    CopyFileSync(Join(RunDir, Name), Join(SiteDir, Name));
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
  WriteFileSync(Join(SiteDir, 'index.html'), Page(Body, Metadata(RunDir)));
  console.log(
    `Generated ${SiteDir} with index.html and ${Reports.length} report(s).`
  );
}

Main();
