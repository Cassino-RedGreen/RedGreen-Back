const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { Client } = require('pg');
const newman = require('newman');

const envPath = resolve(__dirname, '../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const ENVIRONMENT_PATH = resolve(__dirname, './redgreen.local.postman_environment.json');


const ADMIN_EMAIL = 'admin.local@example.test';
const ADMIN_PASSWORD = 'AdminLocalPass123!';
const ADMIN_NICKNAME = 'adminlocal';

function loadEnvironment() {
  return JSON.parse(readFileSync(ENVIRONMENT_PATH, 'utf8'));
}

function saveEnvironment(environment) {
  writeFileSync(ENVIRONMENT_PATH, JSON.stringify(environment, null, 2) + '\n');
}

function setVar(environment, key, value) {
  const entry = environment.values.find((v) => v.key === key);
  if (entry) Object.assign(entry, { value, enabled: true });
  else environment.values.push({ key, value, enabled: true });
}

async function ensurePersistentAdmin(baseUrl, db) {
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Email: ADMIN_EMAIL, Password: ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  if (login.status === 200) {
    const { User } = await login.json();
    if (User.UserType === 'Admin' && User.Active) {
      console.log('TC-006: reusing the shared persistent local admin.');
      return;
    }
  }

  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Name: 'Shared Persistent Test Administrator',
      BirthDate: '1995-01-01',
      Nickname: ADMIN_NICKNAME,
      Email: ADMIN_EMAIL,
      Password: ADMIN_PASSWORD,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (registration.status !== 201) {
    throw new Error(
      `Could not create the shared persistent admin (status ${registration.status}). If the email is already taken by a non-admin account, remove it manually and re-run.`
    );
  }
  const { User: user } = await registration.json();

  const promoted = await db.query(
    'UPDATE "User" SET "UserType" = $1 WHERE "UserId" = $2 AND "Email" = $3 RETURNING "UserType"',
    ['Admin', user.UserId, ADMIN_EMAIL]
  );
  if (promoted.rowCount !== 1 || promoted.rows[0].UserType !== 'Admin') {
    throw new Error('Admin fixture not found in local DB after promotion.');
  }
  console.log('TC-006: created and promoted the shared persistent local admin.');
}

async function run() {
  const environment = loadEnvironment();
  const baseUrl =
    process.env.TC006_BASE_URL ||
    environment.values.find((v) => v.key === 'baseUrl').value;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (
    !localHosts.includes(new URL(baseUrl).hostname) ||
    !localHosts.includes(host)
  ) {
    throw new Error(
      'TC-006 automatic fixture preparation requires a local API and PostgreSQL.'
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
  const tableName = `TC006 Active Slot Table ${randomUUID()}`;

  await db.connect();
  try {
    await ensurePersistentAdmin(baseUrl, db);

    setVar(environment, 'baseUrl', baseUrl);
    setVar(environment, 'adminEmail', ADMIN_EMAIL);
    setVar(environment, 'adminPassword', ADMIN_PASSWORD);
    setVar(environment, 'tc006TableName', tableName);
    saveEnvironment(environment);
    console.log(
      'TC-006: environment saved to disk, so the Postman app can reuse the same admin.'
    );

    await new Promise((resolveRun, reject) => {
      newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment,
          folder: 'TC-006 - Admin creates and configures an active table correctly',
          reporters: ['cli'],
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (error, summary) => {
          if (error) return reject(error);
          if (summary.run.failures.length)
            return reject(new Error('TC-006 assertions or requests failed.'));
          if (summary.run.stats.assertions.total < 5)
            return reject(new Error('TC-006 did not complete all checks.'));
          resolveRun();
        }
      );
    });
  } finally {
    try {
      await db.query('DELETE FROM "SlotMachine" WHERE "Name" = $1', [
        tableName,
      ]);
      console.log(
        'TC-006: table created by this run removed (the persistent admin was kept).'
      );
    } finally {
      await db.end();
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
