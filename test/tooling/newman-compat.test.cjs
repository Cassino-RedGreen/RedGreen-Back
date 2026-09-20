const Assert = require('node:assert/strict');
const { test: Test } = require('node:test');
const { spawnSync: SpawnSync } = require('node:child_process');
const {
  mkdtempSync: MkdtempSync,
  writeFileSync: WriteFileSync,
  rmSync: RmSync,
  readFileSync: ReadFileSync,
} = require('node:fs');
const { tmpdir: Tmpdir } = require('node:os');
const Path = require('node:path');
const Http = require('node:http');
const Newman = require('newman');
const Generators = require('postman-collection/lib/superstring/dynamic-variables');

Test('all 118 Postman dynamic variables resolve with patched Faker', () => {
  Assert.equal(Object.keys(Generators).length, 118);
  for (const [Name, { generator: Generator }] of Object.entries(Generators)) {
    Assert.equal(typeof Generator, 'function', Name);
    const Value = Generator();
    Assert.notEqual(Value, undefined, Name);
    Assert.notEqual(Value, null, Name);
    Assert.notEqual(String(Value), '', Name);
  }
  Assert.match(Generators.$guid.generator(), /^[\da-f-]{36}$/i);
  Assert.match(
    Generators.$randomPhoneNumber.generator(),
    /^\d{3}-\d{3}-\d{4}$/
  );
  Assert.match(Generators.$randomCreditCardMask.generator(), /^\(\d{4}\)$/);
  Assert.equal(Generators.$randomAlphaNumeric.generator().length, 1);
});

Test('installation patches are idempotent', () => {
  const Files = [
    require.resolve('newman/lib/run/options'),
    require.resolve('postman-collection/lib/superstring/dynamic-variables'),
  ];
  const Before = Files.map((File) => ReadFileSync(File, 'utf8'));
  const Result = SpawnSync(process.execPath, ['scripts/patch-newman.cjs'], {
    cwd: Path.resolve(__dirname, '../..'),
    encoding: 'utf8',
  });
  Assert.equal(Result.status, 0, Result.stderr);
  Assert.deepEqual(
    Files.map((File) => ReadFileSync(File, 'utf8')),
    Before
  );
});

Test(
  'Newman reads CSV and runs dynamic variables and async scripts',
  async () => {
    const Directory = MkdtempSync(Path.join(Tmpdir(), 'redgreen-newman-'));
    const Server = Http.createServer((_Request, Response) => {
      Response.writeHead(200, { 'Content-Type': 'application/json' });
      Response.end('{}');
    });
    try {
      await new Promise((Resolve) => Server.listen(0, '127.0.0.1', Resolve));
      const Csv = Path.join(Directory, 'data.csv');
      WriteFileSync(
        Csv,
        '\uFEFFname,count,quoted,note\nAlice,7,"007",a"b\nBob,8,"008",ok\n'
      );
      const Collection = {
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
              url: `http://127.0.0.1:${Server.address().port}/`,
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
                    ...Object.keys(Generators).map(
                      (Name) =>
                        `  pm.expect(pm.variables.replaceIn('{{${Name}}}')).not.to.eql('{{${Name}}}');`
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
      const Summary = await new Promise((Resolve, Reject) => {
        Newman.run(
          {
            collection: Collection,
            iterationData: Csv,
            reporters: [],
            timeoutRequest: 5000,
            timeoutScript: 10000,
          },
          (ErrorObject, Result) =>
            ErrorObject ? Reject(ErrorObject) : Resolve(Result)
        );
      });
      Assert.equal(
        Summary.run.failures.length,
        0,
        JSON.stringify(
          Summary.run.failures.map((Failure) => Failure.error.message)
        )
      );
      Assert.equal(Summary.run.stats.requests.total, 2);
      Assert.equal(Summary.run.stats.assertions.total, 6);
    } finally {
      await new Promise((Resolve) => Server.close(Resolve));
      RmSync(Directory, { recursive: true, force: true });
    }
  }
);
