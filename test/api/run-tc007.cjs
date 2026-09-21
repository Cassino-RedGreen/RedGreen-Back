const { randomUUID: RandomUUID, randomBytes: RandomBytes } = require('node:crypto');
const { resolve: Resolve } = require('node:path');
const { existsSync: ExistsSync } = require('node:fs');
const Newman = require('newman');

const EnvPath = Resolve(__dirname, '../../.env');
if (ExistsSync(EnvPath)) process.loadEnvFile(EnvPath);

const BASE_BALANCE = 900000000;
const TOTAL_USERS = 12;

async function DeactivateUser(BaseUrl, U) {
  const Login = await fetch(`${BaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Email: U.email, Password: U.password }),
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
  const Environment = structuredClone(
    require('./redgreen.local.postman_environment.json')
  );
  const BaseUrl =
    process.env.TC007_BASE_URL ||
    Environment.values.find((V) => V.key === 'baseUrl').value;
  const LocalHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (!LocalHosts.includes(new URL(BaseUrl).hostname)) {
    throw new Error('TC-007 requires a local API.');
  }

  const Suffix = RandomUUID();
  const Users = Array.from({ length: TOTAL_USERS }, (_, Index) => {
    const N = Index + 1;
    return {
      label: `U${N}`,
      balance: BASE_BALANCE + N,
      email: `tc007.u${N}.${Suffix}@example.test`,
      nickname: `tc007u${N}${Suffix}`,
      password: RandomBytes(24).toString('base64url'),
    };
  });

  const RegisteredUsers = [];
  try {
    for (const U of Users) {
      const Registration = await fetch(`${BaseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Name: `TC007 Test ${U.label}`,
          BirthDate: '1995-01-01',
          Nickname: U.nickname,
          Email: U.email,
          Password: U.password,
          ChipBalance: U.balance,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (Registration.status !== 201)
        throw new Error(
          `Fixture registration for ${U.label} returned ${Registration.status}`
        );
      const { User } = await Registration.json();
      if (
        !User ||
        User.Email !== U.email ||
        Number(User.ChipBalance) !== U.balance
      )
        throw new Error(`Unexpected registered fixture user ${U.label}`);
      RegisteredUsers.push(U);
    }

    console.log(
      `TC-007: ${TOTAL_USERS} temporary users with known chip balances prepared.`
    );

    const SortedDesc = [...Users].sort((A, B) => B.balance - A.balance);
    const ExpectedTop10 = SortedDesc.slice(0, 10).map((U) => ({
      Email: U.email,
      ChipBalance: U.balance,
    }));
    const ExpectedExcluded = SortedDesc.slice(10).map((U) => ({
      Email: U.email,
      ChipBalance: U.balance,
    }));

    const Values = {
      baseUrl: BaseUrl,
      tc007ExpectedTop10: JSON.stringify(ExpectedTop10),
      tc007ExpectedExcluded: JSON.stringify(ExpectedExcluded),
    };
    for (const [Key, Value] of Object.entries(Values)) {
      const Entry = Environment.values.find((V) => V.key === Key);
      if (Entry) Object.assign(Entry, { value: Value, enabled: true });
      else Environment.values.push({ key: Key, value: Value, enabled: true });
    }

    await new Promise((ResolveRun, Reject) => {
      Newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment: Environment,
          folder: 'TC-007 - Player ranking displayed correctly',
          reporters: process.env.TEST_CASE_REPORT ? ['cli', 'json'] : ['cli'],
          reporter: { json: { export: process.env.TEST_CASE_REPORT } },
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (ErrorObject, Summary) => {
          if (ErrorObject) return Reject(ErrorObject);
          if (Summary.run.failures.length)
            return Reject(new Error('TC-007 assertions or requests failed.'));
          if (Summary.run.stats.assertions.total < 9)
            return Reject(new Error('TC-007 did not complete all checks.'));
          ResolveRun();
        }
      );
    });
  } finally {
    let Deactivated = 0;
    for (const U of RegisteredUsers) {
      if (await DeactivateUser(BaseUrl, U)) Deactivated += 1;
    }
    console.log(
      `TC-007: ${Deactivated}/${RegisteredUsers.length} temporary ranking users deactivated (DELETE /user - soft delete, so they no longer appear in the Active-only ranking).`
    );
  }
}

Run().catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
