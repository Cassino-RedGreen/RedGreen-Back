import http from 'k6/http';
import { check } from 'k6';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';

const BaseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const DefaultSlotMachineId = __ENV.SLOT_MACHINE_ID || null;
const HoldSeconds = Number(__ENV.HOLD_SECONDS || 20);
const RampSeconds = Number(__ENV.RAMP_SECONDS || 10);
const PacingSeconds = Number(__ENV.PACING_SECONDS || 1);
const VusSteps = parseJsonArray('VUS_STEPS', [10, 50, 100, 200]);
const MaxVus = Math.max(...VusSteps);
const StageMetrics = VusSteps.map((target) => ({
  Target: target,
  Requests: new Counter(`vu_${target}_requests`),
  Duration: new Trend(`vu_${target}_duration`),
  Failed: new Rate(`vu_${target}_failed`),
  Checks: new Rate(`vu_${target}_checks`),
}));
const StageWindows = VusSteps.map((target, index) => {
  const HoldStart = index * (RampSeconds + HoldSeconds) + RampSeconds;
  return { Target: target, Start: HoldStart, End: HoldStart + HoldSeconds };
});

function parseJsonArray(key, fallback) {
  try {
    const RawValue = __ENV[key];
    if (!RawValue) return fallback;
    const Parsed = JSON.parse(RawValue);
    return Array.isArray(Parsed) && Parsed.length > 0
      ? Parsed.map(Number).filter(
          (value) => Number.isFinite(value) && value > 0
        )
      : fallback;
  } catch (error) {
    return fallback;
  }
}

function responseJson(Response) {
  if (!Response.body) return null;
  try {
    return Response.json();
  } catch (error) {
    return null;
  }
}

function accountDetails(seed) {
  return {
    Name: `k6 VU Scale User ${seed}`,
    BirthDate: '1990-01-01',
    Nickname: `k6vuscale${seed}`,
    Email: `k6.vu.scale.${seed}@example.test`,
    Password: 'ScaleTest123!',
    ChipBalance: 10000,
  };
}

function registerUser(seed) {
  const Registration = http.post(
    `${BaseUrl}/auth/register`,
    JSON.stringify(accountDetails(seed)),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { test: 'vu-scale', phase: 'provisioning', flow: 'registration' },
    }
  );

  const Body = responseJson(Registration);
  return Body && Body.Token
    ? { Token: Body.Token, UserId: Body.User?.UserId }
    : null;
}

function loginUser(seed) {
  const Login = http.post(
    `${BaseUrl}/auth/login`,
    JSON.stringify({
      Email: accountDetails(seed).Email,
      Password: accountDetails(seed).Password,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { test: 'vu-scale', phase: 'provisioning', flow: 'login' },
    }
  );

  const Body = responseJson(Login);
  return Body && Body.Token
    ? { Token: Body.Token, UserId: Body.User?.UserId }
    : null;
}

function provisionOrLoginUser(seed) {
  const ExistingUser = loginUser(seed);
  if (ExistingUser) return ExistingUser;
  return registerUser(seed);
}

function clearStaleSession(User, SlotMachineId) {
  const ActiveResponse = http.get(`${BaseUrl}/sessions/me/active`, {
    headers: { Authorization: `Bearer ${User.Token}` },
    tags: {
      test: 'vu-scale',
      phase: 'provisioning',
      flow: 'stale-session-check',
    },
  });

  if (ActiveResponse.status !== 200) return false;
  const ActiveSession = responseJson(ActiveResponse);
  if (!ActiveSession || ActiveSession.GameType !== 'Slot') return true;

  const CashOut = http.post(
    `${BaseUrl}/slot-machines/${SlotMachineId}/sessions/${ActiveSession.ReferenceId}/cash-out`,
    null,
    {
      headers: { Authorization: `Bearer ${User.Token}` },
      tags: {
        test: 'vu-scale',
        phase: 'provisioning',
        flow: 'stale-session-cleanup',
      },
    }
  );

  return CashOut.status === 201 || CashOut.status === 404;
}

function resolveSlotMachineId() {
  if (DefaultSlotMachineId) return String(DefaultSlotMachineId);

  const Response = http.get(`${BaseUrl}/slot/machine`, {
    tags: {
      test: 'vu-scale',
      phase: 'provisioning',
      flow: 'machine-discovery',
    },
  });
  if (Response.status !== 200) return '1';

  const Machines = responseJson(Response);
  if (Array.isArray(Machines) && Machines.length > 0) {
    const ActiveMachine =
      Machines.find((machine) => machine.Active !== false) || Machines[0];
    return String(ActiveMachine.SlotMachineId);
  }

  return '1';
}

function resolveStage(Data) {
  const ElapsedSeconds = (Date.now() - Data.StartedAt) / 1000;
  const Window = StageWindows.find(
    (StageWindow) =>
      ElapsedSeconds >= StageWindow.Start && ElapsedSeconds < StageWindow.End
  );
  return Window
    ? StageMetrics.find((Stage) => Stage.Target === Window.Target)
    : null;
}

export const options = {
  stages: VusSteps.flatMap((target) => [
    { duration: `${RampSeconds}s`, target, tag: `ramp-to-${target}` },
    { duration: `${HoldSeconds}s`, target, tag: `hold-at-${target}` },
  ]),
  thresholds: {
    'http_req_failed{phase:gameplay}': ['rate<0.01'],
    'http_req_duration{phase:gameplay}': ['p(95)<500', 'p(99)<1000'],
    'checks{phase:gameplay}': ['rate>0.99'],
  },
  setupTimeout: '10m',
  teardownTimeout: '10m',
};

export function setup() {
  const SlotMachineId = resolveSlotMachineId();
  const Users = [];

  for (let UserIndex = 1; UserIndex <= MaxVus; UserIndex += 1) {
    const User = provisionOrLoginUser(UserIndex);
    if (User && clearStaleSession(User, SlotMachineId)) Users.push(User);
  }

  check(
    { status: Users.length },
    {
      [`prepared ${MaxVus} persistent VU scale users`]: (result) =>
        result.status === MaxVus,
    }
  );

  return {
    SlotMachineId,
    Users,
    StartedAt: Date.now(),
  };
}

export default function (Data) {
  const User = Data.Users[__VU - 1];
  const Token = User && User.Token;
  const HasPreparedUser = check(
    { Token },
    {
      'prepared VU user is available': (value) => !!value.Token,
    }
  );

  if (!HasPreparedUser) return;

  const Stage = resolveStage(Data);
  const Params = {
    headers: { Authorization: `Bearer ${Token}` },
    tags: {
      test: 'vu-scale',
      phase: 'gameplay',
      stage: Stage ? `vus-${Stage.Target}` : 'ramp',
    },
  };

  const SlotMachineId = Data.SlotMachineId;
  const Start = http.post(
    `${BaseUrl}/slot-machines/${SlotMachineId}/sessions`,
    JSON.stringify({}),
    Params
  );

  const Started = check(Start, {
    'slot session returns 201': (response) => response.status === 201,
  });
  if (Stage) {
    Stage.Duration.add(Start.timings.duration);
    Stage.Requests.add(1);
    Stage.Failed.add(Start.status >= 400);
    Stage.Checks.add(Started);
  }

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
  if (Stage) {
    Stage.Duration.add(CashOut.timings.duration);
    Stage.Failed.add(CashOut.status >= 400);
    Stage.Checks.add(CashOut.status === 201);
  }

  sleep(PacingSeconds);
}

export function handleSummary(data) {
  const StageRows = StageMetrics.map((Stage) => {
    const Requests = data.metrics[`vu_${Stage.Target}_requests`]?.values || {};
    const Duration = data.metrics[`vu_${Stage.Target}_duration`]?.values || {};
    const Failed = data.metrics[`vu_${Stage.Target}_failed`]?.values || {};
    const Checks = data.metrics[`vu_${Stage.Target}_checks`]?.values || {};
    return `<tr><td>${Stage.Target}</td><td>${Requests.count || 0}</td><td>${formatMetric(Duration['p(90)'], Duration.max)}</td><td>${formatMetric(Duration['p(95)'], Duration.max)}</td><td>${formatMetric(Duration['p(99)'], Duration.max)}</td><td>${formatPercent(Failed.rate)}</td><td>${formatPercent(Checks.rate)}</td></tr>`;
  }).join('');
  const StageTable = `<section class="vu-stage-breakdown"><h2>VU stage breakdown</h2><p>Gameplay metrics grouped by the VU stage active when each request started. When a stage has too few samples for a percentile, the observed maximum is shown with an asterisk.</p><table><thead><tr><th>Target VUs</th><th>Requests</th><th>p90</th><th>p95</th><th>p99</th><th>Failure rate</th><th>Check rate</th></tr></thead><tbody>${StageRows}</tbody></table></section>`;
  const Report = htmlReport(data).replace('</body>', `${StageTable}</body>`);
  return {
    'test/performance/artifacts/vu-scale-report.html': Report,
  };
}

function formatMetric(Value, Fallback) {
  if (Number.isFinite(Value)) return `${Math.round(Value)} ms`;
  if (Number.isFinite(Fallback)) return `${Math.round(Fallback)} ms*`;
  return 'n/a';
}

function formatPercent(Value) {
  return Number.isFinite(Value) ? `${(Value * 100).toFixed(2)}%` : 'n/a';
}
