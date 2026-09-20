const { randomUUID, randomBytes } = require('node:crypto');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { Client } = require('pg');
const newman = require('newman');

const envPath = resolve(__dirname, '../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

async function run() {
  const environment = structuredClone(
    require('./redgreen.local.postman_environment.json')
  );
  const baseUrl =
    process.env.TC005_BASE_URL ||
    environment.values.find((v) => v.key === 'baseUrl').value;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (
    !localHosts.includes(new URL(baseUrl).hostname) ||
    !localHosts.includes(host)
  ) {
    throw new Error(
      'TC-005 automatic fixture preparation requires a local API and PostgreSQL.'
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
  const email = `tc005.${suffix}@example.test`;
  const nickname = `tc005${suffix}`;
  const password = randomBytes(24).toString('base64url');
  const tableName = `TC005 Slot Machine ${suffix}`;
  const userEmails = [
    `tc005.a.${suffix}@example.test`,
    `tc005.b.${suffix}@example.test`,
  ];
  await db.connect();
  try {
    const registration = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Name: 'TC005 Test Administrator',
        BirthDate: '1995-01-01',
        Nickname: nickname,
        Email: email,
        Password: password,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (registration.status !== 201)
      throw new Error(`Fixture registration returned ${registration.status}`);
    const { User: user } = await registration.json();
    if (!user || user.Email !== email || user.UserType !== 'User')
      throw new Error('Unexpected registered fixture user');
    const promoted = await db.query(
      'UPDATE "User" SET "UserType" = $1 WHERE "UserId" = $2 AND "Email" = $3 AND "Nickname" = $4 RETURNING "UserType"',
      ['Admin', user.UserId, email, nickname]
    );
    if (promoted.rowCount !== 1 || promoted.rows[0].UserType !== 'Admin') {
      throw new Error(
        'Admin fixture not found in local DB; check that API and runner use the same database.'
      );
    }
    console.log(
      'TC-005: temporary administrator prepared; credentials stay in memory.'
    );
    const values = {
      baseUrl,
      tc005AdminEmail: email,
      tc005AdminPassword: password,
      tc005SlotMachineName: tableName,
      tc005UserAEmail: userEmails[0],
      tc005UserBEmail: userEmails[1],
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
          folder: 'TC-005 - User cannot use a session owned by another user',
          reporters: ['cli'],
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (error, summary) => {
          if (error) return reject(error);
          if (summary.run.failures.length)
            return reject(new Error('TC-005 assertions or requests failed.'));
          if (summary.run.stats.assertions.total < 27)
            return reject(new Error('TC-005 did not complete all checks.'));
          resolveRun();
        }
      );
    });
  } finally {
    try {
      await db.query('BEGIN');
      await db.query(
        'DELETE FROM "ActiveSession" WHERE "UserId" IN (SELECT "UserId" FROM "User" WHERE "Email" = ANY($1::text[]))',
        [userEmails]
      );
      await db.query(
        'DELETE FROM "SlotSession" WHERE "UserId" IN (SELECT "UserId" FROM "User" WHERE "Email" = ANY($1::text[]))',
        [userEmails]
      );
      await db.query('DELETE FROM "User" WHERE "Email" = ANY($1::text[])', [
        userEmails,
      ]);
      await db.query('DELETE FROM "SlotMachine" WHERE "Name" = $1', [
        tableName,
      ]);
      await db.query(
        'DELETE FROM "User" WHERE "Email" = $1 AND "Nickname" = $2',
        [email, nickname]
      );
      await db.query('COMMIT');
      console.log('TC-005: temporary sessions, machine and users removed.');
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
