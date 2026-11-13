const Assert = require('node:assert/strict');
const { test: Test } = require('node:test');
const {
  mkdtempSync: MkdtempSync,
  mkdirSync: MkdirSync,
  readFileSync: ReadFileSync,
  rmSync: RmSync,
  writeFileSync: WriteFileSync,
} = require('node:fs');
const { tmpdir: Tmpdir } = require('node:os');
const Path = require('node:path');
const { spawnSync: SpawnSync } = require('node:child_process');
const { CreateNewmanReporterOptions } = require('../api/newman-reporters.cjs');

const Root = Path.resolve(__dirname, '../..');
const Generator = Path.join(Root, 'scripts/build-ci-report-index.cjs');

Test('enables safe HTML and JUnit Newman reports when requested', () => {
  const PreviousHtml = process.env.TEST_CASE_HTML_REPORT;
  const PreviousJunit = process.env.TEST_CASE_JUNIT_REPORT;
  process.env.TEST_CASE_HTML_REPORT = 'report.html';
  process.env.TEST_CASE_JUNIT_REPORT = 'junit.xml';
  try {
    Assert.deepEqual(CreateNewmanReporterOptions('TC-001', 'report.json'), {
      reporters: ['cli', 'json', 'htmlextra', 'junit'],
      reporter: {
        json: { export: 'report.json' },
        htmlextra: {
          export: 'report.html',
          title: 'TC-001',
          skipSensitiveData: true,
        },
        junit: { export: 'junit.xml' },
      },
    });
  } finally {
    if (PreviousHtml === undefined) delete process.env.TEST_CASE_HTML_REPORT;
    else process.env.TEST_CASE_HTML_REPORT = PreviousHtml;
    if (PreviousJunit === undefined) delete process.env.TEST_CASE_JUNIT_REPORT;
    else process.env.TEST_CASE_JUNIT_REPORT = PreviousJunit;
  }
});

Test('builds a unit report index with suite status and report links', () => {
  const Directory = MkdtempSync(Path.join(Tmpdir(), 'redgreen-unit-report-'));
  try {
    const Junit = Path.join(Directory, 'junit.xml');
    const Output = Path.join(Directory, 'index.html');
    WriteFileSync(
      Junit,
      '<?xml version="1.0"?><testsuites tests="3" failures="1" errors="0" skipped="0"><testsuite name="Service &amp; rules" tests="3" failures="1" errors="0" skipped="0"></testsuite></testsuites>'
    );
    const Result = SpawnSync(
      process.execPath,
      [
        Generator,
        'unit',
        Junit,
        Output,
        'main-7',
        'http://localhost:8080/job/backend/7/',
      ],
      { encoding: 'utf8' }
    );
    Assert.equal(Result.status, 0, Result.stderr);
    const Html = ReadFileSync(Output, 'utf8');
    Assert.match(Html, /3<\/strong><span>Tests/);
    Assert.match(Html, /Unit test result/);
    Assert.match(Html, /Service &amp; rules/);
    Assert.match(Html, /coverage\/lcov-report\/index\.html/);
    Assert.match(
      Html,
      /http:\/\/localhost:8080\/job\/backend\/7\/testReport\//
    );
  } finally {
    RmSync(Directory, { recursive: true, force: true });
  }
});

Test('builds an E2E report index linking scenario HTML reports', () => {
  const Directory = MkdtempSync(Path.join(Tmpdir(), 'redgreen-e2e-report-'));
  try {
    const Run = Path.join(Directory, '2026-11-12T22-00-00-000Z');
    MkdirSync(Run);
    WriteFileSync(
      Path.join(Run, 'summary.json'),
      JSON.stringify({
        scenarios: [
          {
            script: 'test:api:tc001',
            report: '/workspace/test-api-tc001.json',
            exitCode: 0,
            failures: 0,
          },
        ],
      })
    );
    WriteFileSync(
      Path.join(Run, 'test-api-tc001.json'),
      JSON.stringify({
        run: {
          stats: {
            requests: { total: 4 },
            assertions: { total: 6, failed: 0 },
          },
          timings: { started: 1000, completed: 2500 },
        },
      })
    );
    WriteFileSync(
      Path.join(Run, 'report-test-api-tc001.html'),
      '<h1>Scenario</h1>'
    );
    const Result = SpawnSync(
      process.execPath,
      [Generator, 'e2e', Directory, 'main-7'],
      { encoding: 'utf8' }
    );
    Assert.equal(Result.status, 0, Result.stderr);
    const Html = ReadFileSync(Path.join(Directory, 'index.html'), 'utf8');
    Assert.match(Html, /API end-to-end tests/);
    Assert.match(Html, /test:api:tc001/);
    Assert.match(Html, /4<\/td><td>6\/6/);
    Assert.match(Html, /2026-11-12T22-00-00-000Z\/report-test-api-tc001\.html/);
  } finally {
    RmSync(Directory, { recursive: true, force: true });
  }
});

Test(
  'builds a styled category index linking each build summary and coverage',
  () => {
    const Directory = MkdtempSync(
      Path.join(Tmpdir(), 'redgreen-category-report-')
    );
    try {
      const Build = Path.join(Directory, 'redgreen-ci-main-12');
      MkdirSync(Path.join(Build, 'coverage', 'lcov-report'), {
        recursive: true,
      });
      WriteFileSync(Path.join(Build, 'index.html'), '<h1>Unit summary</h1>');
      const Result = SpawnSync(
        process.execPath,
        [Generator, 'listing', 'unit', Directory],
        { encoding: 'utf8' }
      );
      Assert.equal(Result.status, 0, Result.stderr);
      const Html = ReadFileSync(Path.join(Directory, 'index.html'), 'utf8');
      Assert.match(Html, /Unit tests and coverage/);
      Assert.match(Html, /redgreen-ci-main-12/);
      Assert.match(Html, /redgreen-ci-main-12\/index\.html/);
      Assert.match(
        Html,
        /redgreen-ci-main-12\/coverage\/lcov-report\/index\.html/
      );
      Assert.match(Html, /Available builds/);
    } finally {
      RmSync(Directory, { recursive: true, force: true });
    }
  }
);
