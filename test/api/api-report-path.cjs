const {
  createWriteStream: CreateWriteStream,
  mkdirSync: MkdirSync,
} = require('node:fs');
const {
  dirname: Dirname,
  extname: Extname,
  join: Join,
  resolve: Resolve,
} = require('node:path');

const Root = Resolve(__dirname, '../..');

function ResolveApiReportPath(Case) {
  const ExplicitReport = process.env.TEST_CASE_REPORT;
  const Report = ExplicitReport
    ? Resolve(ExplicitReport)
    : Join(
        Root,
        'test-results',
        new Date().toISOString().replace(/[:.]/g, '-'),
        `test-api-${Case.toLowerCase().replace(/[^a-z0-9]/g, '')}.json`
      );
  MkdirSync(Dirname(Report), { recursive: true });
  return { Report, Standalone: !ExplicitReport };
}

function StartStandaloneLog(Report, Standalone) {
  if (!Standalone) return async () => {};
  const Log = Report.slice(0, -Extname(Report).length) + '.log';
  const LogStream = CreateWriteStream(Log, { flags: 'w' });
  const StdoutWrite = process.stdout.write.bind(process.stdout);
  const StderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (...Args) => {
    LogStream.write(Args[0]);
    return StdoutWrite(...Args);
  };
  process.stderr.write = (...Args) => {
    LogStream.write(Args[0]);
    return StderrWrite(...Args);
  };
  return () =>
    new Promise((ResolveClose) => {
      process.stdout.write = StdoutWrite;
      process.stderr.write = StderrWrite;
      LogStream.end(ResolveClose);
    });
}

module.exports = { ResolveApiReportPath, StartStandaloneLog };
