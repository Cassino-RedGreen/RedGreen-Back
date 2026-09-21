const { resolve } = require('node:path');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { Client } = require('pg');
const newman = require('newman');

const envPath = resolve(__dirname, '../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const ENVIRONMENT_PATH = resolve(__dirname, './redgreen.local.postman_environment.json');


const SLOT_MACHINE_NAME = 'Slot 1';

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

async function requireSlotMachine(baseUrl) {
  const list = await fetch(`${baseUrl}/slot/machine`, {
    signal: AbortSignal.timeout(15000),
  });
  if (list.status === 200) {
    const machines = await list.json();
    const found = machines.find((m) => m.Name === SLOT_MACHINE_NAME && m.Active);
    if (found) return String(found.SlotMachineId);
  }
  throw new Error(
    `Shared slot machine "${SLOT_MACHINE_NAME}" not found - create it manually first (see test/api/SHARED_SETUP.md).`
  );
}

async function run() {
  const environment = loadEnvironment();
  const baseUrl =
    process.env.TC009_BASE_URL ||
    environment.values.find((v) => v.key === 'baseUrl').value;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (
    !localHosts.includes(new URL(baseUrl).hostname) ||
    !localHosts.includes(host)
  ) {
    throw new Error(
      'TC-009 automatic fixture preparation requires a local API and PostgreSQL.'
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

  await db.connect();
  let playerEmail;
  try {
    const slotMachineId = await requireSlotMachine(baseUrl);

    setVar(environment, 'baseUrl', baseUrl);
    saveEnvironment(environment);
    console.log(`TC-009: using the shared "${SLOT_MACHINE_NAME}" (#${slotMachineId}) table.`);

    await new Promise((resolveRun, reject) => {
      newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment,
          folder: 'TC-009 - User cannot start two simultaneous slot sessions',
          reporters: process.env.TEST_CASE_REPORT ? ['cli', 'json'] : ['cli'],
          reporter: { json: { export: process.env.TEST_CASE_REPORT } },
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (error, summary) => {
          try {
            playerEmail = summary?.environment
              ?.toJSON()
              ?.values?.find((v) => v.key === 'tc009PlayerEmail')?.value;
          } catch {
            playerEmail = undefined;
          }
          if (error) return reject(error);
          if (summary.run.failures.length)
            return reject(new Error('TC-009 assertions or requests failed.'));
          if (summary.run.stats.assertions.total < 4)
            return reject(new Error('TC-009 did not complete all checks.'));
          resolveRun();
        }
      );
    });
    console.log(
      'TC-009: done. The Slot session created by this test is intentionally left active (that is what it tests), so the temporary player is removed below along with it.'
    );
  } finally {
    if (playerEmail) {

      await db.query(
        'DELETE FROM "ActiveSession" WHERE "UserId" IN (SELECT "UserId" FROM "User" WHERE "Email" = $1)',
        [playerEmail]
      );
      await db.query(
        'DELETE FROM "SlotSession" WHERE "UserId" IN (SELECT "UserId" FROM "User" WHERE "Email" = $1)',
        [playerEmail]
      );
      const removed = await db.query(
        'DELETE FROM "User" WHERE "Email" = $1 RETURNING "Email"',
        [playerEmail]
      );
      if (removed.rowCount === 1) {
        console.log(`TC-009: removed the temporary player (${playerEmail}).`);
      }
    }
    await db.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
