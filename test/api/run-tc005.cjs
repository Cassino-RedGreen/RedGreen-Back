const { RunApiCase } = require('./run-api-case.cjs');

RunApiCase({
  Case: 'TC005',
  Folder: 'TC-005 - User cannot use a session owned by another user',
  MinimumAssertions: 27,
  Resource: {
    Label: 'Slot Machine',
    Variable: 'tc005SlotMachineName',
    Path: '/slot/machine',
    Id: 'SlotMachineId',
    CleanupMethod: 'POST',
    CleanupPath: (Id) => `/admin/slot-machines/${Id}/deactivate`,
  },
}).catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
