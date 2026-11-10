import http from 'k6/http';
import { check } from 'k6';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

const BaseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const DefaultSlotMachineId = __ENV.SLOT_MACHINE_ID || null;
const TokenCache = new Map();

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

function parseJsonEnv(key, fallback) {
  try {
    const RawValue = __ENV[key];
    if (!RawValue) return fallback;
    return JSON.parse(RawValue);
  } catch (error) {
    return fallback;
  }
}

const ConfiguredUsers = parseJsonEnv('TEST_USERS', []);

function registerUser(seed) {
  const UniqueId = `${Date.now()}-${seed}`;
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

  const Token = Registration.json('Token');
  check(Registration, {
    'VU registration returns 201': (response) => response.status === 201,
    'registration returns token': () => !!Token,
  });

  if (!Token) {
    throw new Error(`Could not create k6 load-test user for VU ${seed}`);
  }

  return Token;
}

function resolveVuToken(vuNumber) {
  const CachedToken = TokenCache.get(vuNumber);
  if (CachedToken) return CachedToken;

  const UserPool = Array.isArray(ConfiguredUsers) ? ConfiguredUsers : [];
  const ConfiguredUser =
    UserPool.length > 0 ? UserPool[(vuNumber - 1) % UserPool.length] : null;
  const Token = ConfiguredUser?.token || registerUser(vuNumber);

  TokenCache.set(vuNumber, Token);
  return Token;
}

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
  return Array.isArray(ConfiguredUsers) ? ConfiguredUsers : [];
}

export default function () {
  const Token = resolveVuToken(__VU);
  const Params = {
    headers: { Authorization: `Bearer ${Token}` },
    tags: { test: 'sustained-load' },
  };

  const SlotMachineId = resolveSlotMachineId();
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
  if (!SessionId) return;

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
