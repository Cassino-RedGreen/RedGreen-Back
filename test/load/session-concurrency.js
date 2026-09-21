import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

const BaseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const SlotMachineId = __ENV.SLOT_MACHINE_ID || '1';
const Token = __ENV.TEST_TOKEN || '';
const Password = 'StressTest123!';
const UnexpectedResponses = new Rate('unexpected_responses');
const RampUp = __ENV.STRESS_RAMP_UP || '20s';
const Hold = __ENV.STRESS_HOLD || '40s';
const RampDown = __ENV.STRESS_RAMP_DOWN || '20s';

http.setResponseCallback(http.expectedStatuses(200, 201, 409));

export const options = {
  stages: [
    { duration: RampUp, target: 5 },
    { duration: Hold, target: 20 },
    { duration: RampDown, target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    checks: ['rate>0.95'],
    unexpected_responses: ['rate<0.01'],
  },
};

export function setup() {
  if (Token) return Token;

  const UniqueId = Date.now();
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
    { headers: { 'Content-Type': 'application/json' } }
  );
  const CreatedToken = Response.json('Token');

  if (Response.status !== 201 || !CreatedToken) {
    throw new Error('Could not create automatic k6 stress-test user');
  }

  return CreatedToken;
}

export default function (SetupToken) {
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
    http.post(
      `${BaseUrl}/slot-machines/${SlotMachineId}/sessions/${SessionId}/cash-out`,
      null,
      Params
    );
  }
}

export function handleSummary(data) {
  return {
    'test/load/artifacts/stress-report.html': htmlReport(data),
  };
}
