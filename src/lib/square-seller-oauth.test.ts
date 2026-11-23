// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
const session = vi.hoisted(() => ({
  authFailure: false,
  schemaFailure: false,
  org: "org-a",
  role: "Owner",
  data: new Map<string, any>(),
}));
const client = {
  query: vi.fn(async (sql: string, args: any[] = []) => {
    const key = args[0] + ":" + args[1];
    if (
      sql.startsWith("SELECT data FROM square_seller") &&
      session.schemaFailure
    )
      throw Object.assign(new Error("private database detail"), {
        code: "42P01",
      });
    if (sql.startsWith("SELECT data FROM square_seller"))
      return {
        rows: session.data.has(key)
          ? [{ data: structuredClone(session.data.get(key)) }]
          : [],
      };
    if (sql.startsWith("INSERT INTO square_seller"))
      session.data.set(key, JSON.parse(args[2]));
    return { rows: [] };
  }),
};
vi.mock("../../netlify/lib/registration-core", () => ({
  RegistrationError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  registrationActor: async () => {
    if (session.authFailure)
      throw Object.assign(new Error("private identity detail"), {
        status: 401,
      });
    return { id: "owner-fixture" };
  },
  registrationTransaction: async (_a: any, fn: any) => fn(client),
  currentMembership: async () => ({
    id: session.org,
    role: session.role,
    business_name: "Fictional bakery",
  }),
}));
import handler from "../../netlify/functions/square-sales.mts";
const origin = "https://square-fixture.invalid";
const random = () => randomBytes(24).toString("base64url");
async function call(action?: string, extra: any = {}) {
  return handler(
    new Request(
      origin + "/api/square-sales" + (!action ? "?environment=sandbox" : ""),
      action
        ? {
            method: "POST",
            headers: { origin, "Content-Type": "application/json" },
            body: JSON.stringify({ action, environment: "sandbox", ...extra }),
          }
        : undefined,
    ),
  );
}
beforeEach(() => {
  session.authFailure = false;
  session.schemaFailure = false;
  session.data.clear();
  session.org = "org-a";
  session.role = "Owner";
  vi.stubEnv("SQUARE_SANDBOX_APPLICATION_ID", random());
  vi.stubEnv("SQUARE_SANDBOX_APPLICATION_SECRET", random());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("completes owner OAuth only after merchant verification, stores ciphertext, and preserves business isolation", async () => {
  const access = random(),
    refresh = random();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      Response.json(
        input.includes("/oauth2/token")
          ? {
              access_token: access,
              refresh_token: refresh,
              expires_at: "2099-01-01Z",
              merchant_id: "merchant-fixture",
            }
          : input.includes("/merchants/")
            ? {
                merchant: {
                  id: "merchant-fixture",
                  business_name: "Fictional seller",
                },
              }
            : {
                locations: [
                  {
                    id: "loc-a",
                    name: "Fictional market",
                    status: "ACTIVE",
                    timezone: "UTC",
                    currency: "USD",
                  },
                ],
              },
      ),
    ),
  );
  const connected = await call("connect");
  const start = await connected.json();
  const authorization = new URL(start.authorizationUrl);
  expect(authorization.searchParams.get("scope")).toBe(
    "MERCHANT_PROFILE_READ ORDERS_READ PAYMENTS_READ",
  );
  const cookie = connected.headers.get("set-cookie")!.split(";")[0];
  const callback = new URL(
    origin + "/api/square-sales?callback=1&environment=sandbox",
  );
  callback.searchParams.set("state", authorization.searchParams.get("state")!);
  callback.searchParams.set("code", random());
  const result = await handler(new Request(callback, { headers: { cookie } }));
  expect(result.status).toBe(303);
  const stored = session.data.get("org-a:sandbox");
  expect(JSON.stringify(stored).includes(access)).toBe(false);
  const status = await (await call()).json();
  expect(status.view.status).toBe("connected");
  expect(status.view.merchantId).toBe("merchant-fixture");
  expect(JSON.stringify(status).includes(access)).toBe(false);
  expect(
    (await handler(new Request(callback, { headers: { cookie } }))).status,
  ).toBe(400);
  session.org = "org-b";
  expect((await (await call()).json()).view.status).toBe("not_connected");
});
it("rejects wrong-browser/expired OAuth and manager authorization", async () => {
  const started = await call("connect");
  const url = new URL((await started.json()).authorizationUrl);
  const callback = new URL(
    origin + "/api/square-sales?callback=1&environment=sandbox",
  );
  callback.searchParams.set("state", url.searchParams.get("state")!);
  callback.searchParams.set("code", random());
  expect((await handler(new Request(callback))).status).toBe(400);
  session.data.get("org-a:sandbox").oauth.expires = 0;
  expect(
    (
      await handler(
        new Request(callback, {
          headers: { cookie: started.headers.get("set-cookie")!.split(";")[0] },
        }),
      )
    ).status,
  ).toBe(400);
  session.role = "Manager";
  expect((await call("connect")).status).toBe(403);
});
it("decline returns without connection and disconnect preserves imported-history tables", async () => {
  const started = await call("connect");
  const url = new URL((await started.json()).authorizationUrl);
  const callback = new URL(
    origin +
      "/api/square-sales?callback=1&environment=sandbox&error=access_denied",
  );
  callback.searchParams.set("state", url.searchParams.get("state")!);
  expect(
    (
      await handler(
        new Request(callback, {
          headers: { cookie: started.headers.get("set-cookie")!.split(";")[0] },
        }),
      )
    ).status,
  ).toBe(303);
  expect((await (await call()).json()).view.status).toBe("not_connected");
  expect((await call("disconnect", { confirm: true })).status).toBe(200);
  expect(
    client.query.mock.calls.some(([sql]) =>
      /DELETE|sales_imports|UPDATE sales /.test(sql),
    ),
  ).toBe(false);
});

it("reports expired authorization as needing reconnection without leaking upstream details", async () => {
  const { sealSeller } = await import("../../netlify/lib/square-seller");
  session.data.set("org-a:sandbox", {
    status: "connected",
    merchantId: "fictional-merchant",
    credential: sealSeller(
      {
        access_token: random(),
        refresh_token: random(),
        expires_at: "2099-01-01T00:00:00Z",
      },
      "sandbox",
      "org-a",
    ),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          errors: [
            { code: "ACCESS_TOKEN_EXPIRED", detail: "upstream private detail" },
          ],
        },
        { status: 401 },
      ),
    ),
  );
  const result = await (
    await call("sample", {
      start: "2026-01-01T00:00:00Z",
      end: "2026-01-02T00:00:00Z",
      locations: ["a"],
    })
  ).json();
  expect(result.view.status).toBe("reconnect_required");
  expect(result.view.lastAttemptedSync).toBeTruthy();
  expect(JSON.stringify(result).includes("upstream private detail")).toBe(
    false,
  );
  expect(result.view.lastSuccessfulSync).toBe(null);
});

it("rechecks owner permission on callback after role changes without exchanging a code", async () => {
  const started = await call("connect");
  const authorization = new URL((await started.json()).authorizationUrl);
  session.role = "Manager";
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const callback = new URL(
    origin + "/api/square-sales?callback=1&environment=sandbox",
  );
  callback.searchParams.set("state", authorization.searchParams.get("state")!);
  callback.searchParams.set("code", random());
  expect(
    (
      await handler(
        new Request(callback, {
          headers: { cookie: started.headers.get("set-cookie")!.split(";")[0] },
        }),
      )
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects merchant replacement, preserves original credentials, and consumes the attempt", async () => {
  const { sealSeller } = await import("../../netlify/lib/square-seller");
  const credential = sealSeller(
    {
      access_token: random(),
      refresh_token: random(),
      expires_at: "2099-01-01T00:00:00Z",
    },
    "sandbox",
    "org-a",
  );
  session.data.set("org-a:sandbox", {
    merchantId: "original",
    credential,
    selectedLocations: ["original-location"],
  });
  const started = await call("connect");
  const authorization = new URL((await started.json()).authorizationUrl);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      Response.json(
        input.includes("/oauth2/token")
          ? {
              access_token: random(),
              refresh_token: random(),
              expires_at: "2099-01-01T00:00:00Z",
              merchant_id: "different",
            }
          : input.includes("/merchants/")
            ? { merchant: { id: "different", business_name: "Other fixture" } }
            : { locations: [] },
      ),
    ),
  );
  const callback = new URL(
    origin + "/api/square-sales?callback=1&environment=sandbox",
  );
  callback.searchParams.set("state", authorization.searchParams.get("state")!);
  callback.searchParams.set("code", random());
  await handler(
    new Request(callback, {
      headers: { cookie: started.headers.get("set-cookie")!.split(";")[0] },
    }),
  );
  const saved = session.data.get("org-a:sandbox");
  expect(saved.merchantId).toBe("original");
  expect(saved.credential).toEqual(credential);
  expect(saved.error).toContain("Disconnect it explicitly");
  expect(saved.oauth).toBeUndefined();
});

it("saves only verified locations with bounded reads and disconnects locally despite remote failure", async () => {
  const { sealSeller } = await import("../../netlify/lib/square-seller");
  session.data.set("org-a:sandbox", {
    merchantId: "m",
    credential: sealSeller(
      {
        access_token: random(),
        refresh_token: random(),
        expires_at: "2099-01-01T00:00:00Z",
      },
      "sandbox",
      "org-a",
    ),
  });
  const fetcher = vi.fn(async (input: string) =>
    Response.json(
      input.includes("/merchants/")
        ? { merchant: { id: "m" } }
        : input.includes("/locations")
          ? { locations: [{ id: "a", status: "ACTIVE", name: "Market" }] }
          : { payments: [] },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    (await (await call("locations", { locations: ["foreign"] })).json()).error,
  ).toContain("authorized Square locations");
  const saved = await (await call("locations", { locations: ["a"] })).json();
  expect(saved.view.selectedLocations).toEqual(["a"]);
  expect(saved.view.lastSuccessfulRead).toBeTruthy();
  expect(fetcher.mock.calls.some(([url]) => url.includes("limit=1"))).toBe(
    true,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 503 })),
  );
  expect((await call("disconnect", { confirm: true })).status).toBe(200);
  expect(session.data.get("org-a:sandbox").credential).toBeUndefined();
});

it("shows only the customer support message for missing platform setup", async () => {
  vi.stubEnv("SQUARE_SANDBOX_APPLICATION_ID", "");
  const response = await (await call("connect")).json();
  expect(response.error).toBe(
    "Square connection is not available yet. Contact support.",
  );
  expect((await (await call()).json()).view.callbackUrl).toBeUndefined();
});

it("keeps independently authorized merchants separate and preserves locations on same-merchant reconnection", async () => {
  let merchant = "merchant-a";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      Response.json(
        input.includes("/oauth2/token")
          ? {
              access_token: random(),
              refresh_token: random(),
              expires_at: "2099-01-01T00:00:00Z",
              merchant_id: merchant,
            }
          : input.includes("/merchants/")
            ? { merchant: { id: merchant } }
            : {
                locations: [
                  {
                    id: merchant + "-location",
                    name: "Fixture",
                    status: "ACTIVE",
                  },
                ],
              },
      ),
    ),
  );
  async function authorize() {
    const started = await call("connect");
    const authorization = new URL((await started.json()).authorizationUrl);
    const callback = new URL(
      origin + "/api/square-sales?callback=1&environment=sandbox",
    );
    callback.searchParams.set(
      "state",
      authorization.searchParams.get("state")!,
    );
    callback.searchParams.set("code", random());
    return handler(
      new Request(callback, {
        headers: { cookie: started.headers.get("set-cookie")!.split(";")[0] },
      }),
    );
  }
  expect((await authorize()).status).toBe(303);
  session.data.get("org-a:sandbox").selectedLocations = ["merchant-a-location"];
  await authorize();
  expect(session.data.get("org-a:sandbox").selectedLocations).toEqual([
    "merchant-a-location",
  ]);
  session.org = "org-b";
  merchant = "merchant-b";
  await authorize();
  expect(session.data.get("org-b:sandbox").merchantId).toBe("merchant-b");
  expect(session.data.get("org-a:sandbox").merchantId).toBe("merchant-a");
  expect(session.data.get("org-b:sandbox").credential).not.toEqual(
    session.data.get("org-a:sandbox").credential,
  );
});

it("distinguishes session, owner, configuration and missing-schema failures without leaking private details", async () => {
  session.authFailure = true;
  let response = await call();
  expect(response.status).toBe(401);
  expect((await response.json()).code).toBe("SIGN_IN_REQUIRED");
  session.authFailure = false;
  session.role = "Manager";
  response = await call();
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("OWNER_REQUIRED");
  session.role = "Owner";
  session.schemaFailure = true;
  response = await call();
  expect(response.status).toBe(503);
  const failure = await response.json();
  expect(failure.code).toBe("SQUARE_SCHEMA_UNAVAILABLE");
  expect(JSON.stringify(failure)).not.toContain("private database detail");
  vi.stubEnv("SQUARE_SANDBOX_APPLICATION_ID", "");
  response = await call();
  expect(response.status).toBe(200);
  expect((await response.json()).view.configured).toBe(false);
  response = await call("connect");
  expect(response.status).toBe(503);
  expect((await response.json()).error).toBe(
    "Square connection is not available yet. Contact support.",
  );
});
it("validates UTC calendar dates on the server", async () => {
  const { squareUtcInput } =
    await import("../../netlify/functions/square-sales.mts");
  expect(squareUtcInput("2026-11-23T09:30", undefined)).toBe(
    "2026-11-23T09:30:00.000Z",
  );
  expect(() => squareUtcInput("2026-02-30T09:30", undefined)).toThrow();
  expect(() => squareUtcInput("2026-11-23T09:30-05:00", undefined)).toThrow();
});
