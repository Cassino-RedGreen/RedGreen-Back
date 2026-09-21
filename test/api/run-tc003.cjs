const { RunApiCase } = require('./run-api-case.cjs');

RunApiCase({
  Case: 'TC003',
  Folder: 'TC-003 - Administrator can use restricted functions',
  MinimumAssertions: 10,
  Resource: {
    Label: 'Admin Table',
    Variable: 'tc003GambitTableName',
    Path: '/gambit-table',
    Id: 'GambitTableId',
    CleanupMethod: 'DELETE',
    CleanupPath: (Id) => `/gambit-table/${Id}`,
  },
}).catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
