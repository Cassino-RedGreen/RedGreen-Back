const { RunApiCase } = require('./run-api-case.cjs');

RunApiCase({
  Case: 'TC005',
  Folder: 'TC-005 - User cannot use a session owned by another user',
  MinimumAssertions: 27,
  Resource: {
    label: 'Slot Machine',
    variable: 'tc005SlotMachineName',
    path: '/slot/machine',
    id: 'SlotMachineId',
    cleanupMethod: 'POST',
    cleanupPath: (Id) => `/admin/slot-machines/${Id}/deactivate`,
  },
}).catch((ErrorObject) => {
  console.error(ErrorObject.message);
  process.exitCode = 1;
});
