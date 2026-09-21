import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

const BaseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const DefaultSlotMachineId = __ENV.SLOT_MACHINE_ID || null;
const Password = 'StressTest123!';

function resolveSlotMachineId() {
  if (DefaultSlotMachineId) return String(DefaultSlotMachineId);

  const Response = http.get(`${BaseUrl}/slot/machine`);
  if (Response.status !== 200) return '1';

  const Machines = Response.json();
  if (Array.isArray(Machines) && Machines.length > 0) {
    const ActiveMachine =
      Machines.find((machine) => machine.Active !== false) || Machines[0];
    return String(ActiveMachine.SlotMachineId);
  }

  return '1';
}
const UnexpectedResponses = new Rate('unexpected_responses');
const RampUp = __ENV.STRESS_RAMP_UP || '20s';
const Hold = __ENV.STRESS_HOLD || '40s';
const RampDown = __ENV.STRESS_RAMP_DOWN || '20s';
const StressTarget = Number(__ENV.STRESS_TARGET || 20);
const StressPeak = Number(__ENV.STRESS_PEAK || 20);

function parseJsonEnv(key, fallback) {
  try {
    const RawValue = __ENV[key];
    if (!RawValue) return fallback;
    return JSON.parse(RawValue);
  } catch (error) {
    return fallback;
  }
}

const ConfiguredTokens = parseJsonEnv('TEST_TOKENS', []);
const SharedToken = __ENV.TEST_TOKEN || '';

http.setResponseCallback(http.expectedStatuses(200, 201, 409));

export const options = {
  stages: [
    { duration: RampUp, target: 5 },
    { duration: Hold, target: StressTarget },
    { duration: RampDown, target: StressPeak > 0 ? 0 : 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    checks: ['rate>0.95'],
    unexpected_responses: ['rate<0.01'],
  },
};

function createStressUser(seed) {
  const UniqueId = `${Date.now()}-${seed}`;
  const Response = http.post(
    `${BaseUrl}/auth/register`,
    JSON.stringify({
      Name: `k6 Stress User ${UniqueId}`,
      BirthDate: '1990-01-01',
      Nickname: `k6stress${UniqueId}`,
      Email: `k6.stress.${UniqueId}@example.test`,
      Password,
      ChipBalance: 10000,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { test: 'session-concurrency', flow: 'registration' },
    }
  );

  const CreatedToken = Response.json('Token');
  check(Response, {
    'stress user registration returns 201': (response) =>
      response.status === 201,
    'stress user registration returns token': () => !!CreatedToken,
  });

  if (Response.status !== 201 || !CreatedToken) {
    throw new Error('Could not create automatic k6 stress-test user');
  }

  return CreatedToken;
}

export function setup() {
  if (SharedToken) return SharedToken;

  if (Array.isArray(ConfiguredTokens) && ConfiguredTokens.length > 0) {
    return ConfiguredTokens[0];
  }

  return createStressUser('setup');
}

export default function (SetupToken) {
  const SlotMachineId = resolveSlotMachineId();
  const Params = {
    headers: {
      Authorization: `Bearer ${SetupToken}`,
      'Content-Type': 'application/json',
    },
    tags: { test: 'session-concurrency' },
  };

  const Requests = [
    {
      method: 'POST',
      url: `${BaseUrl}/slot-machines/${SlotMachineId}/sessions`,
      body: JSON.stringify({}),
      params: Params,
    },
    {
      method: 'POST',
      url: `${BaseUrl}/slot-machines/${SlotMachineId}/sessions`,
      body: JSON.stringify({}),
      params: Params,
    },
  ];

  const Responses = http.batch(Requests);
  const Created = Responses.filter((response) => response.status === 201);
  const Conflicts = Responses.filter((response) => response.status === 409);

  Responses.forEach((response) => {
    UnexpectedResponses.add(response.status !== 201 && response.status !== 409);
  });

  check(Responses, {
    'concurrent pair has at most one creation': () => Created.length <= 1,
    'concurrent pair has no unexpected status': () =>
      Created.length + Conflicts.length === Responses.length,
  });

  if (Created.length === 1) {
    const SessionId = Created[0].json('session.SlotSessionId');
    if (!SessionId) return;

    const CashOut = http.post(
      `${BaseUrl}/slot-machines/${SlotMachineId}/sessions/${SessionId}/cash-out`,
      null,
      Params
    );

    check(CashOut, {
      'cash-out returns 201': (response) => response.status === 201,
    });
  }
}

export function handleSummary(data) {
  return {
    'test/load/artifacts/stress-report.html': htmlReport(data),
  };
}
