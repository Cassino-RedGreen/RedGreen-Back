const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const newman = require('newman');
const generators = require('postman-collection/lib/superstring/dynamic-variables');

test('all 118 Postman dynamic variables resolve with patched Faker', () => {
  assert.equal(Object.keys(generators).length, 118);
  for (const [name, { generator }] of Object.entries(generators)) {
    assert.equal(typeof generator, 'function', name);
    const value = generator();
    assert.notEqual(value, undefined, name);
    assert.notEqual(value, null, name);
    assert.notEqual(String(value), '', name);
  }
  assert.match(generators.$guid.generator(), /^[\da-f-]{36}$/i);
  assert.match(
    generators.$randomPhoneNumber.generator(),
    /^\d{3}-\d{3}-\d{4}$/
  );
  assert.match(generators.$randomCreditCardMask.generator(), /^\(\d{4}\)$/);
  assert.equal(generators.$randomAlphaNumeric.generator().length, 1);
});

test('installation patches are idempotent', () => {
  const files = [
    require.resolve('newman/lib/run/options'),
    require.resolve('postman-collection/lib/superstring/dynamic-variables'),
  ];
  const before = files.map((file) => readFileSync(file, 'utf8'));
  const result = spawnSync(process.execPath, ['scripts/patch-newman.cjs'], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    files.map((file) => readFileSync(file, 'utf8')),
    before
  );
});

test('Newman reads CSV and runs dynamic variables and async scripts', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'redgreen-newman-'));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const csv = path.join(directory, 'data.csv');
    writeFileSync(
      csv,
      '\uFEFFname,count,quoted,note\nAlice,7,"007",a"b\nBob,8,"008",ok\n'
    );
    const collection = {
      info: {
        name: 'Newman compatibility',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'CSV and dynamic variables',
          request: {
            method: 'GET',
            url: `http://127.0.0.1:${server.address().port}/`,
          },
          event: [
            {
              listen: 'test',
              script: {
                exec: [
                  "pm.test('CSV casting is preserved', () => {",
                  "  pm.expect(pm.iterationData.get('count')).to.be.a('number');",
                  "  pm.expect(pm.iterationData.get('quoted')).to.match(/^00[78]$/);",
                  "  if (pm.iterationData.get('name') === 'Alice') pm.expect(pm.iterationData.get('note')).to.eql('a\"b');",
                  '});',
                  "pm.test('all dynamic variables resolve in the runtime', () => {",
                  ...Object.keys(generators).map(
                    (name) =>
                      `  pm.expect(pm.variables.replaceIn('{{${name}}}')).not.to.eql('{{${name}}}');`
                  ),
                  '});',
                  "(async () => { await Promise.resolve(); pm.test('async script completes', () => pm.expect(true).to.eql(true)); })();",
                ],
              },
            },
          ],
        },
      ],
    };
    const summary = await new Promise((resolve, reject) => {
      newman.run(
        {
          collection,
          iterationData: csv,
          reporters: [],
          timeoutRequest: 5000,
          timeoutScript: 10000,
        },
        (error, result) => (error ? reject(error) : resolve(result))
      );
    });
    assert.equal(
      summary.run.failures.length,
      0,
      JSON.stringify(
        summary.run.failures.map((failure) => failure.error.message)
      )
    );
    assert.equal(summary.run.stats.requests.total, 2);
    assert.equal(summary.run.stats.assertions.total, 6);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
