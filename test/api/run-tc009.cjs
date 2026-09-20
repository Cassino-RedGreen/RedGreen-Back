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
const PLAYER_EMAIL = 'tc009.player.local@example.test';
const PLAYER_PASSWORD = 'Tc009PlayerPass123!';
const PLAYER_NICKNAME = 'tc009playerlocal';
const SLOT_MACHINE_NAME = 'TC009 Dedicated Slot Table (persistent)';
const SLOT_MINIMUM_SPIN_VALUE = 20;
const SLOT_MINIMUM_CHIPS_REQUIRED = 100;
const SLOT_MINIMUM_REROLL_VALUE = 10;
const CHIP_BALANCE_TOP_UP_THRESHOLD = 1000;
const CHIP_BALANCE_TOP_UP_TARGET = 100000;

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
    const { User, Token } = await login.json();
    if (User.UserType === 'Admin' && User.Active) {
      return Token;
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
      `Could not create the shared persistent admin (status ${registration.status}).`
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

  const secondLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Email: ADMIN_EMAIL, Password: ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  const { Token } = await secondLogin.json();
  return Token;
}

async function ensurePersistentPlayer(baseUrl, db) {
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Email: PLAYER_EMAIL, Password: PLAYER_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  let userId;
  if (login.status === 200) {
    const { User } = await login.json();
    userId = User.UserId;
  } else {
    const registration = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Name: 'TC009 Persistent Test Player',
        BirthDate: '1995-01-01',
        Nickname: PLAYER_NICKNAME,
        Email: PLAYER_EMAIL,
        Password: PLAYER_PASSWORD,
        ChipBalance: CHIP_BALANCE_TOP_UP_TARGET,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (registration.status !== 201) {
      throw new Error(
        `Could not create the persistent TC-009 player (status ${registration.status}).`
      );
    }
    const { User: user } = await registration.json();
    userId = user.UserId;
  }

  const balance = await db.query(
    'SELECT "ChipBalance" FROM "User" WHERE "UserId" = $1',
    [userId]
  );
  if (Number(balance.rows[0]?.ChipBalance) < CHIP_BALANCE_TOP_UP_THRESHOLD) {
    await db.query('UPDATE "User" SET "ChipBalance" = $1 WHERE "UserId" = $2', [
      CHIP_BALANCE_TOP_UP_TARGET,
      userId,
    ]);
    console.log('TC-009: topped up the persistent player balance.');
  }
}

async function ensurePersistentSlotMachine(baseUrl, adminToken, environment) {
  const storedId = environment.values.find(
    (v) => v.key === 'tc009SlotMachineId'
  )?.value;
  if (storedId) {
    const check = await fetch(`${baseUrl}/slot/machine/${storedId}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (check.status === 200) {
      const machine = await check.json();
      if (machine.Active) return storedId;
    }
  }

  const creation = await fetch(`${baseUrl}/slot/machine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      Name: SLOT_MACHINE_NAME,
      Description: 'Persistent dedicated table for TC-009 (run-tc009.cjs)',
      MinimumSpinValue: SLOT_MINIMUM_SPIN_VALUE,
      MinimumChipsRequired: SLOT_MINIMUM_CHIPS_REQUIRED,
      MinimumRerollValue: SLOT_MINIMUM_REROLL_VALUE,
      TableColor: 'White',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (creation.status !== 201) {
    throw new Error(
      `Could not create the persistent TC-009 slot machine (status ${creation.status}).`
    );
  }
  const machine = await creation.json();
  console.log('TC-009: created a new persistent dedicated slot machine.');
  return String(machine.SlotMachineId);
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
  try {
    const adminToken = await ensurePersistentAdmin(baseUrl, db);
    await ensurePersistentPlayer(baseUrl, db);
    const slotMachineId = await ensurePersistentSlotMachine(
      baseUrl,
      adminToken,
      environment
    );

    setVar(environment, 'baseUrl', baseUrl);
    setVar(environment, 'adminEmail', ADMIN_EMAIL);
    setVar(environment, 'adminPassword', ADMIN_PASSWORD);
    setVar(environment, 'tc009PlayerEmail', PLAYER_EMAIL);
    setVar(environment, 'tc009PlayerPassword', PLAYER_PASSWORD);
    setVar(environment, 'tc009SlotMachineId', slotMachineId);
    saveEnvironment(environment);
    console.log(
      'TC-009: environment saved to disk, so the Postman app can reuse the same player and table.'
    );

    await new Promise((resolveRun, reject) => {
      newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment,
          folder: 'TC-009 - User cannot start two simultaneous slot sessions',
          reporters: ['cli'],
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (error, summary) => {
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
      'TC-009: done. The Slot session created by this test is intentionally left active (that is what it tests) and will be auto-closed by the next run.'
    );
  } finally {
    await db.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
