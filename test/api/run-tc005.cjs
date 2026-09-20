const { randomUUID: RandomUUID } = require('node:crypto');
const { resolve: Resolve } = require('node:path');
const { existsSync: ExistsSync } = require('node:fs');
const { Client } = require('pg');
const Newman = require('newman');

const EnvPath = Resolve(__dirname, '../../.env');
if (ExistsSync(EnvPath)) process.loadEnvFile(EnvPath);

async function Run() {
  const Environment = structuredClone(
    require('./redgreen.local.postman_environment.json')
  );
  const BaseUrl =
    process.env.TC005_BASE_URL ||
    Environment.values.find((V) => V.key === 'baseUrl').value;
  const Host = process.env.POSTGRES_HOST || 'localhost';
  const LocalHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (
    !LocalHosts.includes(new URL(BaseUrl).hostname) ||
    !LocalHosts.includes(Host)
  ) {
    throw new Error(
      'TC-005 automatic fixture preparation requires a local API and PostgreSQL.'
    );
  }
  for (const Key of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
    if (!process.env[Key]) throw new Error(`Missing ${Key}`);
  }
  const Db = new Client({
    host: Host,
    port: Number(process.env.POSTGRES_PORT || 5433),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    connectionTimeoutMillis: 10000,
  });
  const Suffix = RandomUUID();
  const Email = 'admin@admin.com';
  const Password = 'admin123';
  const TableName = `TC005 Slot Machine ${Suffix}`;
  const UserEmails = [
    `tc005.a.${Suffix}@example.test`,
    `tc005.b.${Suffix}@example.test`,
  ];
  await Db.connect();
  try {
    console.log('TC-005: using seeded local administrator.');
    const Values = {
      baseUrl: BaseUrl,
      tc005AdminEmail: Email,
      tc005AdminPassword: Password,
      tc005SlotMachineName: TableName,
      tc005UserAEmail: UserEmails[0],
      tc005UserBEmail: UserEmails[1],
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
          folder: 'TC-005 - User cannot use a session owned by another user',
          reporters: process.env.TEST_CASE_REPORT ? ['cli', 'json'] : ['cli'],
          reporter: { json: { export: process.env.TEST_CASE_REPORT } },
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (ErrorObject, Summary) => {
          if (ErrorObject) return Reject(ErrorObject);
          if (Summary.run.failures.length)
            return Reject(new Error('TC-005 assertions or requests failed.'));
          if (Summary.run.stats.assertions.total < 27)
            return Reject(new Error('TC-005 did not complete all checks.'));
          ResolveRun();
        }
      );
    });
  } finally {
    try {
      await Db.query('BEGIN');
      await Db.query(
        'DELETE FROM "ActiveSession" WHERE "UserId" IN (SELECT "UserId" FROM "User" WHERE "Email" = ANY($1::text[]))',
        [UserEmails]
      );
      await Db.query(
        'DELETE FROM "SlotSession" WHERE "UserId" IN (SELECT "UserId" FROM "User" WHERE "Email" = ANY($1::text[]))',
        [UserEmails]
      );
      await Db.query('DELETE FROM "User" WHERE "Email" = ANY($1::text[])', [
        UserEmails,
      ]);
      await Db.query('DELETE FROM "SlotMachine" WHERE "Name" = $1', [
        TableName,
      ]);
      await Db.query('COMMIT');
      console.log('TC-005: temporary sessions, machine and users removed.');
    } catch (ErrorObject) {
      await Db.query('ROLLBACK');
      throw ErrorObject;
    } finally {
      await Db.end();
    }
  }
}

Run().catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
