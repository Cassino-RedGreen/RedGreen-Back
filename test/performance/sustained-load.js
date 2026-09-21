import http from 'k6/http';
import { check } from 'k6';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

const BaseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const SlotMachineId = __ENV.SLOT_MACHINE_ID || '1';
const ConfiguredUsers = JSON.parse(__ENV.TEST_USERS || '[]');
let VuToken = null;

export const options = {
  scenarios: {
    sustained_load: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 2),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 10),
      maxVUs: Number(__ENV.MAX_VUS || 50),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  return ConfiguredUsers;
}

export default function (Users) {
  if (!VuToken) {
    const ConfiguredUser = Users[(__VU - 1) % Users.length];
    if (ConfiguredUser?.token) {
      VuToken = ConfiguredUser.token;
    } else {
      const UniqueId = `${Date.now()}-${__VU}`;
      const Registration = http.post(
        `${BaseUrl}/auth/register`,
        JSON.stringify({
          Name: `k6 Load User ${UniqueId}`,
          BirthDate: '1990-01-01',
          Nickname: `k6load${UniqueId}`,
          Email: `k6.load.${UniqueId}@example.test`,
          Password: 'LoadTest123!',
          ChipBalance: 10000,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { test: 'sustained-load', flow: 'registration' },
        }
      );
      VuToken = Registration.json('Token');
      check(Registration, {
        'VU registration returns 201': (response) => response.status === 201,
      });
      if (!VuToken) return;
    }
  }

  const Params = {
    headers: { Authorization: `Bearer ${VuToken}` },
    tags: { test: 'sustained-load' },
  };

  const Start = http.post(
    `${BaseUrl}/slot-machines/${SlotMachineId}/sessions`,
    JSON.stringify({}),
    Params
  );
  const Started = check(Start, {
    'slot session returns 201': (response) => response.status === 201,
  });

  if (!Started) return;

  const SessionId = Start.json('session.SlotSessionId');
  const CashOut = http.post(
    `${BaseUrl}/slot-machines/${SlotMachineId}/sessions/${SessionId}/cash-out`,
    null,
    Params
  );

  check(CashOut, {
    'slot cash-out returns 201': (response) => response.status === 201,
  });
}

export function handleSummary(data) {
  return {
    'test/performance/artifacts/load-report.html': htmlReport(data),
  };
}
