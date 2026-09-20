const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const rootRequire = createRequire(path.join(__dirname, '../package.json'));
let newmanEntry;
try {
  newmanEntry = rootRequire.resolve('newman/package.json');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  process.exit(0);
}
const newmanRequire = createRequire(newmanEntry);
const collectionEntry = newmanRequire.resolve(
  'postman-collection/package.json'
);
for (const [file, expected] of [
  [newmanEntry, '6.2.2'],
  [collectionEntry, '4.4.0'],
]) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (pkg.version !== expected) {
    throw new Error(
      `Review Newman compatibility patches for ${pkg.name}@${pkg.version}`
    );
  }
}

function patch(file, replacements) {
  const original = fs.readFileSync(file, 'utf8');
  let updated = original;
  for (const [before, after] of replacements) {
    if (updated.includes(before)) updated = updated.replaceAll(before, after);
    else if (!updated.includes(after)) {
      throw new Error(`Unexpected dependency source in ${file}: ${before}`);
    }
  }
  return { file, original, updated };
}

const fakerChanges = [
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
  ].map((name) => [`faker.address.${name}`, `faker.location.${name}`]),
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
  ].map((category) => [
    `faker.image.${category}`,
    `function () { return faker.image.urlLoremFlickr({ category: '${category}', width: 640, height: 480 }); }`,
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
  ].map((name) => [`faker.name.${name}`, `faker.person.${name}`]),
  ['faker.datatype.uuid', 'faker.string.uuid'],
  ['faker.random.alphaNumeric', 'faker.string.alphanumeric'],
];
const source = path.join(
  path.dirname(collectionEntry),
  'lib/superstring/dynamic-variables.js'
);
const newline = fs.readFileSync(source, 'utf8').includes('\r\n')
  ? '\r\n'
  : '\n';
const patches = [
  patch(path.join(path.dirname(newmanEntry), 'lib/run/options.js'), [
    [
      "parseCsv = require('csv-parse'),",
      "parseCsv = require('csv-parse').parse,",
    ],
    ['relax: true,', 'relax_quotes: true,'],
  ]),
  patch(
    source,
    fakerChanges.map((pair) =>
      pair.map((text) => text.replaceAll('\r\n', newline))
    )
  ),
];
for (const { file, original, updated } of patches) {
  if (original !== updated) fs.writeFileSync(file, updated);
}
console.log('Newman compatibility patches verified (csv-parse 7 / Faker 10).');
