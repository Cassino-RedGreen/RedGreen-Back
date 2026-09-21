const { randomUUID: RandomUUID } = require('node:crypto');
const { resolve: Resolve } = require('node:path');
const { existsSync: ExistsSync } = require('node:fs');
const Newman = require('newman');

const EnvPath = Resolve(__dirname, '../../.env');
if (ExistsSync(EnvPath)) process.loadEnvFile(EnvPath);

async function RunApiCase({ Case, Folder, MinimumAssertions, Resource }) {
  const Environment = structuredClone(
    require('./redgreen.local.postman_environment.json')
  );
  const Read = (Key) => Environment.values.find((V) => V.key === Key)?.value;
  const Prefix = Case.toLowerCase();
  const BaseUrl = (process.env[`${Case}_BASE_URL`] || Read('baseUrl')).replace(
    /\/$/,
    ''
  );
  const Suffix = RandomUUID();
  const ResourceName = `${Case} ${Resource.label} ${Suffix}`;
  const UserEmails =
    Case === 'TC005'
      ? [`tc005.a.${Suffix}@example.test`, `tc005.b.${Suffix}@example.test`]
      : [];
  const AdminEmail =
    process.env[`${Case}_ADMIN_EMAIL`] || Read(`${Prefix}AdminEmail`);
  const AdminPassword =
    process.env[`${Case}_ADMIN_PASSWORD`] || Read(`${Prefix}AdminPassword`);
  if (!AdminEmail || !AdminPassword)
    throw new Error(`${Case}: provide API administrator credentials.`);
  const Values = {
    baseUrl: BaseUrl,
    [`${Prefix}AdminEmail`]: AdminEmail,
    [`${Prefix}AdminPassword`]: AdminPassword,
    [Resource.variable]: ResourceName,
    ...(Case === 'TC005'
      ? { tc005UserAEmail: UserEmails[0], tc005UserBEmail: UserEmails[1] }
      : {}),
  };
  for (const [Key, Value] of Object.entries(Values)) {
    const Entry = Environment.values.find((V) => V.key === Key);
    if (Entry) Object.assign(Entry, { value: Value, enabled: true });
    else Environment.values.push({ key: Key, value: Value, enabled: true });
  }

  let AdminToken;
  let ResourceId;
  const UserTokens = new Map();
  const Errors = [];
  // Observe API responses, including pm.sendRequest, so partial setup can be cleaned up.
  function TrackResponse(ErrorObject, Args) {
    if (
      ErrorObject ||
      !Args.response ||
      Args.response.code < 200 ||
      Args.response.code >= 300
    )
      return;
    let Data;
    try {
      Data = Args.response.json();
    } catch {
      return;
    }
    const Path = new URL(Args.request.url.toString()).pathname;
    if (Args.request.method !== 'POST') return;
    if (
      Path.endsWith('/auth/login') &&
      Data.User?.Email === AdminEmail &&
      Data.User?.UserType === 'Admin'
    )
      AdminToken = Data.Token;
    if (
      Path.endsWith('/auth/register') &&
      UserEmails.includes(Data.User?.Email) &&
      Data.Token
    )
      UserTokens.set(Data.User.Email, Data.Token);
    if (
      Path.endsWith(Resource.path) &&
      Data.Name === ResourceName &&
      Number.isInteger(Data[Resource.id]) &&
      Data[Resource.id] > 0
    )
      ResourceId = Data[Resource.id];
  }

  async function CleanupRequest(Method, Path, Token) {
    if (!Token)
      throw new Error(`${Case}: missing API token for cleanup ${Path}`);
    const Response = await fetch(BaseUrl + Path, {
      method: Method,
      headers: { Authorization: `Bearer ${Token}` },
      signal: AbortSignal.timeout(15000),
    });
    await Response.text();
    if (!Response.ok)
      throw new Error(
        `${Case}: cleanup ${Method} ${Path} returned ${Response.status}`
      );
  }

  console.log(
    `${Case}: running setup and assertions exclusively through the API.`
  );
  try {
    await new Promise((ResolveRun, Reject) => {
      Newman.run(
        {
          collection: require('./redgreen-api.postman_collection.json'),
          environment: Environment,
          folder: Folder,
          reporters: process.env.TEST_CASE_REPORT ? ['cli', 'json'] : ['cli'],
          reporter: { json: { export: process.env.TEST_CASE_REPORT } },
          timeoutRequest: 15000,
          timeoutScript: 30000,
        },
        (ErrorObject, Summary) => {
          if (ErrorObject) return Reject(ErrorObject);
          if (Summary.run.failures.length)
            return Reject(new Error(`${Case}: assertions or requests failed.`));
          if (Summary.run.stats.assertions.total < MinimumAssertions)
            return Reject(new Error(`${Case}: did not complete all checks.`));
          ResolveRun();
        }
      ).on('request', TrackResponse);
    });
  } catch (ErrorObject) {
    Errors.push(ErrorObject);
  } finally {
    if (ResourceId) {
      try {
        await CleanupRequest(
          Resource.cleanupMethod,
          Resource.cleanupPath(ResourceId),
          AdminToken
        );
        console.log(`${Case}: test resource deactivated through the API.`);
      } catch (ErrorObject) {
        Errors.push(ErrorObject);
      }
    }
    for (const Token of UserTokens.values()) {
      try {
        await CleanupRequest('DELETE', '/user', Token);
      } catch (ErrorObject) {
        Errors.push(ErrorObject);
      }
    }
    if (UserTokens.size)
      console.log(
        `${Case}: user cleanup completed through the API; account and session history is retained.`
      );
  }
  if (Errors.length)
    throw new AggregateError(
      Errors,
      Errors.map((ErrorObject) => ErrorObject.message).join('\n')
    );
}

module.exports = { RunApiCase };
