const { randomUUID: RandomUUID } = require('node:crypto');
const { resolve: Resolve } = require('node:path');
const {
  existsSync: ExistsSync,
  readFileSync: ReadFileSync,
  writeFileSync: WriteFileSync,
} = require('node:fs');
const Newman = require('newman');

const EnvPath = Resolve(__dirname, '../../.env');
if (ExistsSync(EnvPath)) process.loadEnvFile(EnvPath);

const EnvironmentPath = Resolve(__dirname, './redgreen.local.postman_environment.json');

function LoadEnvironment() {
  return JSON.parse(ReadFileSync(EnvironmentPath, 'utf8'));
}

function SaveEnvironment(Environment) {
  WriteFileSync(EnvironmentPath, JSON.stringify(Environment, null, 2) + '\n');
}

function SetVar(Environment, Key, Value) {
  const Entry = Environment.values.find((V) => V.key === Key);
  if (Entry) Object.assign(Entry, { value: Value, enabled: true });
  else Environment.values.push({ key: Key, value: Value, enabled: true });
}

function RequireSeededAdmin(Environment) {
  const Email = Environment.values.find((V) => V.key === 'adminEmail')?.value;
  const Password = Environment.values.find((V) => V.key === 'adminPassword')?.value;
  if (!Email || !Password) {
    throw new Error(
      'adminEmail/adminPassword not found in the environment - create the shared admin account manually first (see test/api/SHARED_SETUP.md).'
    );
  }
}

async function Run() {
  const Environment = LoadEnvironment();
  const BaseUrl =
    process.env.TC006_BASE_URL ||
    Environment.values.find((V) => V.key === 'baseUrl').value;
  const LocalHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (!LocalHosts.includes(new URL(BaseUrl).hostname)) {
    throw new Error('TC-006 requires a local API.');
  }
  const TableName = `TC006 Active Slot Table ${RandomUUID()}`;

  RequireSeededAdmin(Environment);

  SetVar(Environment, 'baseUrl', BaseUrl);
  SetVar(Environment, 'tc006TableName', TableName);
  SaveEnvironment(Environment);
  console.log(
    'TC-006: environment saved to disk (table name only - the admin is a seed, not touched here).'
  );

  await new Promise((ResolveRun, Reject) => {
    Newman.run(
      {
        collection: require('./redgreen-api.postman_collection.json'),
        environment: Environment,
        folder: 'TC-006 - Admin creates and configures an active table correctly',
        reporters: process.env.TEST_CASE_REPORT ? ['cli', 'json'] : ['cli'],
        reporter: { json: { export: process.env.TEST_CASE_REPORT } },
        timeoutRequest: 15000,
        timeoutScript: 30000,
      },
      (ErrorObject, Summary) => {
        if (ErrorObject) return Reject(ErrorObject);
        if (Summary.run.failures.length)
          return Reject(new Error('TC-006 assertions or requests failed.'));
        if (Summary.run.stats.assertions.total < 6)
          return Reject(new Error('TC-006 did not complete all checks.'));
        ResolveRun();
      }
    );
  });
  console.log(
    'TC-006: done. The table created by this run was deleted via DELETE /slot/machine/:Id inside the folder itself, so there is nothing left to clean up here (the persistent admin was kept).'
  );
}

Run().catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
