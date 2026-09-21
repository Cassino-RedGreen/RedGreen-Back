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
const SLOT_MINIMUM_SPIN_VALUE = 10;
const SLOT_MINIMUM_REROLL_VALUE = 5;
const GAMBIT_TABLE_NAME = 'Gambit 1';
const GAMBIT_CARD_PRICE = 10;
const GAMBIT_CARDS_PURCHASED = 5;
const PLAYER_PASSWORD = 'Tc008Password123!';

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

async function RequireGambitTable(BaseUrl) {
  const List = await fetch(`${BaseUrl}/gambit-table`, {
    signal: AbortSignal.timeout(15000),
  });
  if (List.status === 200) {
    const Tables = await List.json();
    const Found = Tables.find((T) => T.Name === GAMBIT_TABLE_NAME && T.Active);
    if (Found) return String(Found.GambitTableId);
  }
  throw new Error(
    `Shared gambit table "${GAMBIT_TABLE_NAME}" not found - create it manually first (see test/api/SHARED_SETUP.md).`
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
    process.env.TC008_BASE_URL ||
    Environment.values.find((V) => V.key === 'baseUrl').value;
  const LocalHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (!LocalHosts.includes(new URL(BaseUrl).hostname)) {
    throw new Error('TC-008 requires a local API.');
  }

  let PlayerEmail;
  try {
    const SlotMachineId = await RequireSlotMachine(BaseUrl);
    const GambitTableId = await RequireGambitTable(BaseUrl);

    SetVar(Environment, 'baseUrl', BaseUrl);
    SetVar(Environment, 'tc008SlotMinimumSpinValue', String(SLOT_MINIMUM_SPIN_VALUE));
    SetVar(Environment, 'tc008SlotMinimumRerollValue', String(SLOT_MINIMUM_REROLL_VALUE));
    SetVar(Environment, 'tc008GambitCardPrice', String(GAMBIT_CARD_PRICE));
    SetVar(Environment, 'tc008GambitCardsPurchased', String(GAMBIT_CARDS_PURCHASED));
    SaveEnvironment(Environment);
    console.log(
      `TC-008: using the shared "${SLOT_MACHINE_NAME}" (#${SlotMachineId}) and "${GAMBIT_TABLE_NAME}" (#${GambitTableId}) tables.`
    );

    await new Promise((ResolveRun, Reject) => {
      Newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment: Environment,
          folder:
            'TC-008 - Player completes a Slot session and starts a Gambit session with the updated balance',
          reporters: process.env.TEST_CASE_REPORT ? ['cli', 'json'] : ['cli'],
          reporter: { json: { export: process.env.TEST_CASE_REPORT } },
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (ErrorObject, Summary) => {
          try {
            PlayerEmail = Summary?.environment
              ?.toJSON()
              ?.values?.find((V) => V.key === 'tc008PlayerEmail')?.value;
          } catch {
            PlayerEmail = undefined;
          }
          if (ErrorObject) return Reject(ErrorObject);
          if (Summary.run.failures.length)
            return Reject(new Error('TC-008 assertions or requests failed.'));
          if (Summary.run.stats.assertions.total < 8)
            return Reject(new Error('TC-008 did not complete all checks.'));
          ResolveRun();
        }
      );
    });
    console.log(
      'TC-008: done. Both the Slot and Gambit sessions were fully closed, so the freshly created player will be removed below.'
    );
  } finally {
    if (PlayerEmail) {
      const Deactivated = await DeactivatePlayer(BaseUrl, PlayerEmail);
      if (Deactivated) {
        console.log(
          `TC-008: deactivated the temporary player (${PlayerEmail}) via DELETE /user.`
        );
      }
    }
  }
}

Run().catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
