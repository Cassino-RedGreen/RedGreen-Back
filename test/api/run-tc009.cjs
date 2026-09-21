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

const SLOT_MACHINE_NAME = 'Slot 1';
const PLAYER_PASSWORD = 'Tc009Password123!';

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

async function RequireSlotMachine(BaseUrl) {
  const List = await fetch(`${BaseUrl}/slot/machine`, {
    signal: AbortSignal.timeout(15000),
  });
  if (List.status === 200) {
    const Machines = await List.json();
    const Found = Machines.find((M) => M.Name === SLOT_MACHINE_NAME && M.Active);
    if (Found) return String(Found.SlotMachineId);
  }
  throw new Error(
    `Shared slot machine "${SLOT_MACHINE_NAME}" not found - create it manually first (see test/api/SHARED_SETUP.md).`
  );
}

async function DeactivatePlayer(BaseUrl, PlayerEmail) {
  const Login = await fetch(`${BaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Email: PlayerEmail, Password: PLAYER_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  if (Login.status !== 200) return false;
  const { Token } = await Login.json();
  if (!Token) return false;
  const Deleted = await fetch(`${BaseUrl}/user`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${Token}` },
    signal: AbortSignal.timeout(15000),
  });
  return Deleted.status === 200;
}

async function Run() {
  const Environment = LoadEnvironment();
  const BaseUrl =
    process.env.TC009_BASE_URL ||
    Environment.values.find((V) => V.key === 'baseUrl').value;
  const LocalHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (!LocalHosts.includes(new URL(BaseUrl).hostname)) {
    throw new Error('TC-009 requires a local API.');
  }

  let PlayerEmail;
  try {
    const SlotMachineId = await RequireSlotMachine(BaseUrl);

    SetVar(Environment, 'baseUrl', BaseUrl);
    SaveEnvironment(Environment);
    console.log(`TC-009: using the shared "${SLOT_MACHINE_NAME}" (#${SlotMachineId}) table.`);

    await new Promise((ResolveRun, Reject) => {
      Newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment: Environment,
          folder: 'TC-009 - User cannot start two simultaneous slot sessions',
          reporters: process.env.TEST_CASE_REPORT ? ['cli', 'json'] : ['cli'],
          reporter: { json: { export: process.env.TEST_CASE_REPORT } },
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (ErrorObject, Summary) => {
          try {
            PlayerEmail = Summary?.environment
              ?.toJSON()
              ?.values?.find((V) => V.key === 'tc009PlayerEmail')?.value;
          } catch {
            PlayerEmail = undefined;
          }
          if (ErrorObject) return Reject(ErrorObject);
          if (Summary.run.failures.length)
            return Reject(new Error('TC-009 assertions or requests failed.'));
          if (Summary.run.stats.assertions.total < 4)
            return Reject(new Error('TC-009 did not complete all checks.'));
          ResolveRun();
        }
      );
    });
    console.log(
      'TC-009: done. The Slot session created by this test is intentionally left active (that is what it tests), so the temporary player is deactivated below along with it.'
    );
  } finally {
    if (PlayerEmail) {
      const Deactivated = await DeactivatePlayer(BaseUrl, PlayerEmail);
      if (Deactivated) {
        console.log(
          `TC-009: deactivated the temporary player (${PlayerEmail}) via DELETE /user.`
        );
      }
    }
  }
}

Run().catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
