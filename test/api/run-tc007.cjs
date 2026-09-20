const { randomUUID, randomBytes } = require('node:crypto');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { Client } = require('pg');
const newman = require('newman');

const envPath = resolve(__dirname, '../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const BASE_BALANCE = 900000000;
const TOTAL_USERS = 12;

async function run() {
  const environment = structuredClone(
    require('./redgreen.local.postman_environment.json')
  );
  const baseUrl =
    process.env.TC007_BASE_URL ||
    environment.values.find((v) => v.key === 'baseUrl').value;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (
    !localHosts.includes(new URL(baseUrl).hostname) ||
    !localHosts.includes(host)
  ) {
    throw new Error(
      'TC-007 automatic fixture preparation requires a local API and PostgreSQL.'
    );
  }
  for (const key of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  const db = new Client({
    host,
    port: Number(process.env.POSTGRES_PORT || 5433),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    connectionTimeoutMillis: 10000,
  });

  const suffix = randomUUID();
  const users = Array.from({ length: TOTAL_USERS }, (_, i) => {
    const n = i + 1;
    return {
      label: `U${n}`,
      balance: BASE_BALANCE + n,
      email: `tc007.u${n}.${suffix}@example.test`,
      nickname: `tc007u${n}${suffix}`,
      password: randomBytes(24).toString('base64url'),
    };
  });

  await db.connect();
  const createdUserIds = [];
  try {
    for (const u of users) {
      const registration = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Name: `TC007 Test ${u.label}`,
          BirthDate: '1995-01-01',
          Nickname: u.nickname,
          Email: u.email,
          Password: u.password,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (registration.status !== 201)
        throw new Error(
          `Fixture registration for ${u.label} returned ${registration.status}`
        );
      const { User: user } = await registration.json();
      if (!user || user.Email !== u.email)
        throw new Error(`Unexpected registered fixture user ${u.label}`);
      u.userId = user.UserId;
      createdUserIds.push(user.UserId);

      const updated = await db.query(
        'UPDATE "User" SET "ChipBalance" = $1 WHERE "UserId" = $2 AND "Email" = $3 RETURNING "ChipBalance"',
        [u.balance, user.UserId, u.email]
      );
      if (
        updated.rowCount !== 1 ||
        Number(updated.rows[0].ChipBalance) !== u.balance
      ) {
        throw new Error(`Failed to set known ChipBalance for ${u.label}`);
      }
    }

    console.log(
      `TC-007: ${TOTAL_USERS} temporary users with known chip balances prepared.`
    );

    const sortedDesc = [...users].sort((a, b) => b.balance - a.balance);
    const expectedTop10 = sortedDesc.slice(0, 10).map((u) => ({
      Email: u.email,
      ChipBalance: u.balance,
    }));
    const expectedExcluded = sortedDesc.slice(10).map((u) => ({
      Email: u.email,
      ChipBalance: u.balance,
    }));

    const values = {
      baseUrl,
      tc007ExpectedTop10: JSON.stringify(expectedTop10),
      tc007ExpectedExcluded: JSON.stringify(expectedExcluded),
    };
    for (const [key, value] of Object.entries(values)) {
      const entry = environment.values.find((v) => v.key === key);
      if (entry) Object.assign(entry, { value, enabled: true });
      else environment.values.push({ key, value, enabled: true });
    }

    await new Promise((resolveRun, reject) => {
      newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment,
          folder: 'TC-007 - Player ranking displayed correctly',
          reporters: ['cli'],
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (error, summary) => {
          if (error) return reject(error);
          if (summary.run.failures.length)
            return reject(new Error('TC-007 assertions or requests failed.'));
          if (summary.run.stats.assertions.total < 9)
            return reject(new Error('TC-007 did not complete all checks.'));
          resolveRun();
        }
      );
    });
  } finally {
    try {
      await db.query('BEGIN');
      for (const userId of createdUserIds) {
        await db.query('DELETE FROM "User" WHERE "UserId" = $1', [userId]);
      }
      await db.query('COMMIT');
      console.log('TC-007: temporary ranking users removed.');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      await db.end();
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
