const { readFileSync: ReadFileSync } = require('node:fs');
const { extname: Extname } = require('node:path');
const Newman = require('newman');
const {
  ResolveApiReportPath,
  StartStandaloneLog,
} = require('./api-report-path.cjs');

const [Case, Folder] = process.argv.slice(2);
if (!Case || !Folder) {
  throw new Error('Usage: node test/api/run-newman-case.cjs <case> <folder>');
}

const { Report, Standalone } = ResolveApiReportPath(Case);
const Log = Report.slice(0, -Extname(Report).length) + '.log';

async function Main() {
  const StopStandaloneLog = StartStandaloneLog(Report, Standalone);
  try {
    const Summary = await new Promise((ResolveRun, RejectRun) => {
      Newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment: require('./redgreen.local.postman_environment.json'),
          folder: Folder,
          reporters: ['cli', 'json'],
          reporter: { json: { export: Report } },
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (ErrorObject, RunSummary) =>
          ErrorObject ? RejectRun(ErrorObject) : ResolveRun(RunSummary)
      );
    });
    const ParsedReport = JSON.parse(ReadFileSync(Report, 'utf8'));
    if (!ParsedReport.run?.stats) {
      throw new Error(`${Case}: generated JSON report has no Newman stats.`);
    }
    if (Summary.run.failures.length) {
      throw new Error(`${Case}: assertions or requests failed.`);
    }
    console.log(`${Case}: JSON report: ${Report}`);
    if (Standalone) console.log(`${Case}: log: ${Log}`);
  } finally {
    await StopStandaloneLog();
  }
}

Main().catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
