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
    process.env.TC003_BASE_URL ||
    environment.values.find((v) => v.key === 'baseUrl').value;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (
    !localHosts.includes(new URL(baseUrl).hostname) ||
    !localHosts.includes(host)
  ) {
    throw new Error(
      'TC-003 automatic fixture preparation requires a local API and PostgreSQL.'
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
  const tableName = `TC003 Admin Table ${suffix}`;
  await db.connect();
  try {
    console.log('TC-003: using seeded local administrator.');
    const values = {
      baseUrl,
      tc003AdminEmail: email,
      tc003AdminPassword: password,
      tc003GambitTableName: tableName,
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
          folder: 'TC-003 - Administrator can use restricted functions',
          reporters: process.env.TEST_CASE_REPORT ? ['cli', 'json'] : ['cli'],
          reporter: { json: { export: process.env.TEST_CASE_REPORT } },
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (error, summary) => {
          if (error) return reject(error);
          if (summary.run.failures.length)
            return reject(new Error('TC-003 assertions or requests failed.'));
          if (summary.run.stats.assertions.total < 10)
            return reject(new Error('TC-003 did not complete all checks.'));
          resolveRun();
        }
      );
    });
  } finally {
    try {
      await db.query('BEGIN');
      await db.query('DELETE FROM "GambitTable" WHERE "Name" = $1', [
        tableName,
      ]);
      await db.query('COMMIT');
      console.log('TC-003: temporary table removed.');
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
