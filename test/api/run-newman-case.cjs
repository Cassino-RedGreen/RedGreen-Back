const { readFileSync: ReadFileSync } = require('node:fs');
const { extname: Extname } = require('node:path');
const Newman = require('newman');
const {
  ResolveApiReportPath,
  StartStandaloneLog,
} = require('./api-report-path.cjs');
const { CreateNewmanReporterOptions } = require('./newman-reporters.cjs');

const [Case, Folder] = process.argv.slice(2);
if (!Case || !Folder) {
  throw new Error('Usage: node test/api/run-newman-case.cjs <case> <folder>');
}

const { Report, Standalone } = ResolveApiReportPath(Case);
const Log = Report.slice(0, -Extname(Report).length) + '.log';
const ReporterOptions = CreateNewmanReporterOptions(Case, Report);

async function Main() {
  const StopStandaloneLog = StartStandaloneLog(Report, Standalone);
  try {
    const Environment = structuredClone(
      require('./redgreen.local.postman_environment.json')
    );
    const BaseUrl = process.env.API_BASE_URL;
    if (BaseUrl) {
      const Entry = Environment.values.find((Value) => Value.key === 'baseUrl');
      if (Entry) Object.assign(Entry, { value: BaseUrl, enabled: true });
      else
        Environment.values.push({
          key: 'baseUrl',
          value: BaseUrl,
          enabled: true,
        });
    }
    const Summary = await new Promise((ResolveRun, RejectRun) => {
      Newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment: Environment,
          folder: Folder,
          ...ReporterOptions,
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
