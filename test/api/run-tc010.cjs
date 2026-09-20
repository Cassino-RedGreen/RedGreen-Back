const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { Client } = require('pg');
const newman = require('newman');

const envPath = resolve(__dirname, '../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const SLOT_MACHINE_NAME = 'Slot 1';
const GAMBIT_TABLE_NAME = 'Gambit 1';

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

async function requireGambitTable(baseUrl) {
  const list = await fetch(`${baseUrl}/gambit-table`, {
    signal: AbortSignal.timeout(15000),
  });
  if (list.status === 200) {
    const tables = await list.json();
    const found = tables.find((t) => t.Name === GAMBIT_TABLE_NAME && t.Active);
    if (found) return String(found.GambitTableId);
  }
  throw new Error(
    `Shared gambit table "${GAMBIT_TABLE_NAME}" not found - create it manually first (see test/api/SHARED_SETUP.md).`
  );
}

async function run() {
  const environment = require('./redgreen.local.postman_environment.json');
  const baseUrl =
    process.env.TC010_BASE_URL ||
    environment.values.find((v) => v.key === 'baseUrl').value;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (
    !localHosts.includes(new URL(baseUrl).hostname) ||
    !localHosts.includes(host)
  ) {
    throw new Error(
      'TC-010 automatic fixture preparation requires a local API and PostgreSQL.'
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
    const gambitTableId = await requireGambitTable(baseUrl);
    console.log(
      `TC-010: using the shared "${SLOT_MACHINE_NAME}" (#${slotMachineId}) and "${GAMBIT_TABLE_NAME}" (#${gambitTableId}) tables.`
    );

    await new Promise((resolveRun, reject) => {
      newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment,
          folder: 'TC-010 - Active session in one game type blocks starting the other',
          reporters: ['cli'],
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (error, summary) => {
          try {
            playerEmail = summary?.environment
              ?.toJSON()
              ?.values?.find((v) => v.key === 'tc010PlayerEmail')?.value;
          } catch {
            playerEmail = undefined;
          }
          if (error) return reject(error);
          if (summary.run.failures.length)
            return reject(new Error('TC-010 assertions or requests failed.'));
          if (summary.run.stats.assertions.total < 16)
            return reject(new Error('TC-010 did not complete all checks.'));
          resolveRun();
        }
      );
    });
    console.log(
      'TC-010: done. Both the rejected cross-type attempts and the final Gambit session were cleanly resolved, so the freshly created player will be removed below.'
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
      await db.query(
        'DELETE FROM "GambitSession" WHERE "UserId" IN (SELECT "UserId" FROM "User" WHERE "Email" = $1)',
        [playerEmail]
      );
      const removed = await db.query(
        'DELETE FROM "User" WHERE "Email" = $1 RETURNING "Email"',
        [playerEmail]
      );
      if (removed.rowCount === 1) {
        console.log(`TC-010: removed the temporary player (${playerEmail}).`);
      }
    }
    await db.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
