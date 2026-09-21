const { RunApiCase } = require('./run-api-case.cjs');

RunApiCase({
  Case: 'TC003',
  Folder: 'TC-003 - Administrator can use restricted functions',
  MinimumAssertions: 10,
  Resource: {
    label: 'Admin Table',
    variable: 'tc003GambitTableName',
    path: '/gambit-table',
    id: 'GambitTableId',
    cleanupMethod: 'DELETE',
    cleanupPath: (Id) => `/gambit-table/${Id}`,
  },
}).catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
