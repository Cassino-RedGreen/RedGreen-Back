const {
  existsSync: ExistsSync,
  readdirSync: ReadDirSync,
  readFileSync: ReadFileSync,
} = require('node:fs');
const {
  basename: Basename,
  join: Join,
  resolve: Resolve,
} = require('node:path');

// Prints a Markdown summary of the latest `npm run test:all` execution.
// In CI: node scripts/write-e2e-summary.cjs >> "$GITHUB_STEP_SUMMARY"
const ResultsRoot = Resolve(__dirname, '..', 'test-results');
const MaxMessageLength = 200;

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

function Cell(Value) {
  const Text = String(Value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
  return Text.length > MaxMessageLength
    ? `${Text.slice(0, MaxMessageLength)}...`
    : Text;
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

function Main() {
  const RunDir = LatestRunDir();
  console.log('### E2E tests (Newman)\n');
  if (!RunDir) {
    console.log('No test results were generated.');
    return;
  }

  const Summary = JSON.parse(
    ReadFileSync(Join(RunDir, 'summary.json'), 'utf8')
  );
  const Totals = {
    requests: { total: 0, failed: 0 },
    assertions: { total: 0, failed: 0 },
  };
  let Duration = 0;
  let AnyFailed = false;
  const Rows = [];
  const FailedAssertions = [];

  for (const Result of Summary.scenarios) {
    const Report = ReadReport(RunDir, Result);
    const Failed =
      Result.exitCode !== 0 || Boolean(Result.error) || Result.failures > 0;
    if (!Report || Failed) AnyFailed = true;
    if (!Report) {
      Rows.push(`| ${Cell(Result.script)} | failed | - | - | - |`);
      FailedAssertions.push({
        Scenario: Result.script,
        Request: '-',
        Assertion: 'Report unavailable',
        Message: Result.error || 'Check the scenario log in the artifact.',
      });
      continue;
    }
    const Stats = Report.run.stats;
    const Elapsed =
      (Report.run.timings?.completed ?? 0) - (Report.run.timings?.started ?? 0);
    for (const Key of Object.keys(Totals)) {
      Totals[Key].total += Stats[Key].total;
      Totals[Key].failed += Stats[Key].failed;
    }
    Duration += Elapsed;
    Rows.push(
      `| ${Cell(Result.script)} | ${Failed ? 'failed' : 'passed'} | ` +
        `${Stats.requests.total} | ` +
        `${Stats.assertions.total - Stats.assertions.failed}/${Stats.assertions.total} | ` +
        `${Seconds(Elapsed)} |`
    );
    for (const Failure of Report.run.failures ?? []) {
      FailedAssertions.push({
        Scenario: Result.script,
        Request: Failure.source?.name,
        Assertion: Failure.error?.test || Failure.error?.name,
        Message: Failure.error?.message,
      });
    }
  }

  console.log(`**Result:** ${AnyFailed ? 'failed' : 'passed'}\n`);
  console.log('| Metric | Total | Passed | Failed |');
  console.log('| --- | ---: | ---: | ---: |');
  for (const [Name, Stats] of Object.entries(Totals)) {
    console.log(
      `| ${Name} | ${Stats.total} | ${Stats.total - Stats.failed} | ${Stats.failed} |`
    );
  }
  console.log(`\nTotal duration: ${Seconds(Duration)}\n`);
  console.log(
    '| Scenario | Result | Requests | Assertions passed | Duration |'
  );
  console.log('| --- | --- | ---: | ---: | ---: |');
  for (const Row of Rows) console.log(Row);

  if (FailedAssertions.length) {
    console.log('\n#### Failed assertions\n');
    console.log('| Scenario | Request | Assertion | Message |');
    console.log('| --- | --- | --- | --- |');
    for (const Item of FailedAssertions) {
      console.log(
        `| ${Cell(Item.Scenario)} | ${Cell(Item.Request)} | ${Cell(Item.Assertion)} | ${Cell(Item.Message)} |`
      );
    }
  }
  console.log(
    '\nThe HTML reports (`report-*.html`), JUnit and logs are in the `e2e-test-results` artifact.'
  );
}

Main();
