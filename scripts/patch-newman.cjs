const Fs = require('node:fs');
const Path = require('node:path');
const { createRequire: CreateRequire } = require('node:module');

const RootRequire = CreateRequire(Path.join(__dirname, '../package.json'));
let NewmanEntry;
try {
  NewmanEntry = RootRequire.resolve('newman/package.json');
} catch (ErrorObject) {
  if (ErrorObject.code !== 'MODULE_NOT_FOUND') throw ErrorObject;
  process.exit(0);
}
const NewmanRequire = CreateRequire(NewmanEntry);
const CollectionEntry = NewmanRequire.resolve(
  'postman-collection/package.json'
);
for (const [File, Expected] of [
  [NewmanEntry, '6.2.2'],
  [CollectionEntry, '4.4.0'],
]) {
  const Package = JSON.parse(Fs.readFileSync(File, 'utf8'));
  if (Package.version !== Expected) {
    throw new Error(
      `Review Newman compatibility patches for ${Package.name}@${Package.version}`
    );
  }
}

function Patch(File, Replacements) {
  const Original = Fs.readFileSync(File, 'utf8');
  let Updated = Original;
  for (const [Before, After] of Replacements) {
    if (Updated.includes(Before)) Updated = Updated.replaceAll(Before, After);
    else if (!Updated.includes(After)) {
      throw new Error(`Unexpected dependency source in ${File}: ${Before}`);
    }
  }
  return { File, Original, Updated };
}

const FakerChanges = [
  [
    "var faker = require('@faker-js/faker/locale/en'),",
    "var faker = require('@faker-js/faker/locale/en').faker,",
  ],
  [
    'faker.phone.phoneNumberFormat(0)',
    "faker.helpers.replaceSymbols('###-###-####')",
  ],
  ['faker.datatype.number(', 'faker.number.int('],
  ['faker.random.arrayElement(', 'faker.helpers.arrayElement('],
  ['faker.random.word', 'faker.word.sample'],
  ['faker.address.streetName', 'faker.location.street'],
  ...[
    'city',
    'streetAddress',
    'country',
    'countryCode',
    'latitude',
    'longitude',
  ].map((Name) => [`faker.address.${Name}`, `faker.location.${Name}`]),
  ['faker.commerce.color', 'faker.color.human'],
  ['faker.company.companyName', 'faker.company.name'],
  [
    'faker.company.companySuffix',
    "function () { return faker.helpers.arrayElement(['Inc', 'and Sons', 'LLC', 'Group']); }",
  ],
  ['faker.company.bsAdjective', 'faker.company.buzzAdjective'],
  ['faker.company.bsBuzz', 'faker.company.buzzVerb'],
  ['faker.company.bsNoun', 'faker.company.buzzNoun'],
  ['faker.company.bs\r\n', 'faker.company.buzzPhrase\r\n'],
  ['faker.finance.account\r\n', 'faker.finance.accountNumber\r\n'],
  [
    'faker.finance.mask',
    "function () { return '(' + faker.finance.accountNumber({ length: 4 }) + ')'; }",
  ],
  ['faker.image.imageUrl', 'faker.image.url'],
  ...[
    'abstract',
    'animals',
    'business',
    'cats',
    'city',
    'food',
    'nightlife',
    'fashion',
    'people',
    'nature',
    'sports',
    'transport',
  ].map((Category) => [
    `faker.image.${Category}`,
    `function () { return faker.image.urlLoremFlickr({ category: '${Category}', width: 640, height: 480 }); }`,
  ]),
  ['faker.internet.userName', 'faker.internet.username'],
  ['faker.internet.color', 'faker.color.rgb'],
  ['faker.name.findName', 'faker.person.fullName'],
  ...[
    'firstName',
    'lastName',
    'jobTitle',
    'prefix',
    'suffix',
    'jobDescriptor',
    'jobArea',
    'jobType',
  ].map((Name) => [`faker.name.${Name}`, `faker.person.${Name}`]),
  ['faker.datatype.uuid', 'faker.string.uuid'],
  ['faker.random.alphaNumeric', 'faker.string.alphanumeric'],
];
const Source = Path.join(
  Path.dirname(CollectionEntry),
  'lib/superstring/dynamic-variables.js'
);
const Newline = Fs.readFileSync(Source, 'utf8').includes('\r\n')
  ? '\r\n'
  : '\n';
const Patches = [
  Patch(Path.join(Path.dirname(NewmanEntry), 'lib/run/options.js'), [
    [
      "parseCsv = require('csv-parse'),",
      "parseCsv = require('csv-parse').parse,",
    ],
    ['relax: true,', 'relax_quotes: true,'],
  ]),
  Patch(
    Source,
    FakerChanges.map((Pair) =>
      Pair.map((Text) => Text.replaceAll('\r\n', Newline))
    )
  ),
];
for (const { File, Original, Updated } of Patches) {
  if (Original !== Updated) Fs.writeFileSync(File, Updated);
}
console.log('Newman compatibility patches verified (csv-parse 7 / Faker 10).');
