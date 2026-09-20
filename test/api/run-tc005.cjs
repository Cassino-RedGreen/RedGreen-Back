const { randomUUID } = require('node:crypto');
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
  const email = 'admin@admin.com';
  const password = 'admin123';
  const tableName = `TC005 Slot Machine ${suffix}`;
  const userEmails = [
    `tc005.a.${suffix}@example.test`,
    `tc005.b.${suffix}@example.test`,
  ];
  await db.connect();
  try {
    console.log('TC-005: using seeded local administrator.');
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
