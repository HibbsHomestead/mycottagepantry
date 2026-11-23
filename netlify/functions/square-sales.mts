import { deploymentRuntime } from "../lib/runtime-environment";
import { randomBytes, createHash } from "node:crypto";
import {
  registrationActor,
  registrationTransaction,
  currentMembership,
} from "../lib/registration-core";
import { demoRequested, demoUnavailable } from "../lib/demo-session";
import {
  sellerConfig,
  squareScopes,
  squareRead,
  sellerIdentity,
  saveSeller,
  sellerView,
  sellerCredential,
  sellerSample,
  sealSeller,
  signSquareReview,
  type SquareEnvironment,
} from "../lib/square-seller";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export default async (request: Request) => {
  if (demoRequested(request)) return demoUnavailable();
  const url = new URL(request.url),
    callback = url.searchParams.get("callback") === "1";
  try {
    if (!["GET", "POST"].includes(request.method))
      return new Response(null, { status: 405, headers });
    if (
      request.method === "POST" &&
      (request.headers.get("origin") !== url.origin ||
        !request.headers.get("content-type")?.startsWith("application/json"))
    )
      return Response.json(
        { error: "Open Square management from this site." },
        { status: 403, headers },
      );
    const text = request.method === "POST" ? await request.text() : "";
    if (text.length > 5000) throw new Error("Square request is too large.");
    const input = text ? JSON.parse(text) : {};
    const environment = (input.environment ||
      url.searchParams.get("environment") ||
      (deploymentRuntime().context === "production"
        ? "production"
        : "sandbox")) as SquareEnvironment;
    if (!["sandbox", "production"].includes(environment))
      throw new Error("Choose sandbox or production.");
    if (
      environment === "production" &&
      deploymentRuntime().context !== "production"
    )
      throw new Error(
        "Production Square authorization is available only on the production deployment.",
      );
    const actor = await registrationActor(false, request);
    const result = await registrationTransaction(actor, async (client) => {
      const member = await currentMembership(client, actor);
      if (!member || !["Owner", "Manager"].includes(member.role))
        throw new Error(
          "An Owner or Manager must manage Square for this business.",
        );
      await client.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE", [
        member.id,
      ]);
      const row = (
        await client.query(
          "SELECT data FROM square_seller_connections WHERE business_id=$1 AND environment=$2",
          [member.id, environment],
        )
      ).rows[0];
      const data: any = row?.data || {};
      const config = sellerConfig(environment);
      const redirectUri =
        url.origin + "/api/square-sales?callback=1&environment=" + environment;
      if (callback) {
        if (member.role !== "Owner")
          throw new Error("The business Owner must authorize Square.");
        const cookie = request.headers
          .get("cookie")
          ?.match(/(?:^|;\s*)cp_square_oauth=([^;]+)/)?.[1];
        const state = url.searchParams.get("state") || "";
        if (
          !cookie ||
          hash(state) !== data.oauth?.hash ||
          hash(cookie) !== data.oauth?.browser ||
          data.oauth?.actor !== actor.id ||
          data.oauth?.expires < Date.now() ||
          data.oauth?.origin !== url.origin
        )
          throw new Error(
            "Square authorization expired or does not match this browser and business. Start Connect again.",
          );
        delete data.oauth;
        await saveSeller(client, member.id, environment, data);
        if (url.searchParams.has("error")) {
          data.error =
            "Square authorization was declined. Connect again when ready.";
          await saveSeller(client, member.id, environment, data);
          return {
            redirect:
              url.origin +
              "/oven#Settings/Integrations?integration=Square&environment=" +
              environment,
            cookie: "",
          };
        }
        const code = url.searchParams.get("code");
        if (!code)
          throw new Error(
            "Square did not return authorization. Start Connect again.",
          );
        try {
          const token = await squareRead(
            environment,
            "/oauth2/token",
            undefined,
            {
              client_id: config.id,
              client_secret: config.secret,
              code,
              grant_type: "authorization_code",
              redirect_uri: redirectUri,
            },
          );
          if (
            !token.access_token ||
            !token.refresh_token ||
            !token.expires_at ||
            !token.merchant_id
          )
            throw new Error(
              "Square authorization response was incomplete. Reconnect.",
            );
          const identity = await sellerIdentity(
            environment,
            token.access_token,
            token.merchant_id,
          );
          if (data.merchantId && data.merchantId !== identity.merchantId)
            throw new Error(
              "Square merchant differs from the existing connection. Disconnect it explicitly before connecting another merchant.",
            );
          Object.assign(data, identity, {
            credential: sealSeller(token, environment, member.id),
            status: "connected",
            selectedLocations: (data.selectedLocations || []).filter(
              (id: string) => identity.locations.some((l: any) => l.id === id),
            ),
            verifiedAt: new Date().toISOString(),
            error: null,
          });
        } catch (e) {
          data.status = "reconnect_required";
          data.error = (e as Error).message;
        }
        await saveSeller(client, member.id, environment, data);
        return {
          redirect:
            url.origin +
            "/oven#Settings/Integrations?integration=Square&environment=" +
            environment,
          cookie: "",
        };
      }
      if (request.method === "GET")
        return {
          view: {
            ...sellerView(data, environment),
            businessName: member.business_name,
          },
        };
      if (input.action === "connect") {
        if (member.role !== "Owner")
          throw new Error("The business Owner must authorize Square.");
        if (!config.ready)
          throw new Error(
            "Square connection is not available yet. Contact support.",
          );
        const state = randomBytes(32).toString("base64url"),
          browser = randomBytes(32).toString("base64url");
        data.oauth = {
          hash: hash(state),
          browser: hash(browser),
          actor: actor.id,
          expires: Date.now() + 600000,
          origin: url.origin,
        };
        await saveSeller(client, member.id, environment, data);
        const q = new URLSearchParams({
          client_id: config.id,
          scope: squareScopes.join(" "),
          state,
          session: "false",
          redirect_uri: redirectUri,
        });
        return {
          authorizationUrl: config.base + "/oauth2/authorize?" + q,
          cookie: browser,
        };
      }
      if (input.action === "disconnect") {
        if (member.role !== "Owner" || input.confirm !== true)
          throw new Error("The Owner must explicitly confirm Disconnect.");
        if (data.credential) {
          try {
            const token = await sellerCredential(
              client,
              member.id,
              environment,
              data,
            );
            await squareRead(environment, "/oauth2/revoke", undefined, {
              client_id: config.id,
              access_token: token,
              revoke_only_access_token: true,
            });
          } catch {
            /* Remove local access even if Square revocation is unavailable. */
          }
        }
        // Only connection credentials are removed. Reporting history is preserved.
        await saveSeller(client, member.id, environment, {
          status: "not_connected",
          lastSuccessfulSync: data.lastSuccessfulSync || null,
        });
        return { view: sellerView({ status: "not_connected" }, environment) };
      }
      if (!["sample", "locations"].includes(input.action))
        throw new Error("Choose Connect, Disconnect or Review sample.");
      if (!data.credential)
        throw new Error("Connect Square before retrieving sales.");
      if (member.role !== "Owner")
        throw new Error("The business Owner must manage Square.");
      data.lastAttemptedSync = new Date().toISOString();
      try {
        const token = await sellerCredential(
          client,
          member.id,
          environment,
          data,
        );
        const identity = await sellerIdentity(
          environment,
          token,
          data.merchantId,
        );
        Object.assign(data, identity);
        if (input.action === "locations") {
          if (
            !Array.isArray(input.locations) ||
            !input.locations.length ||
            input.locations.length > 10 ||
            input.locations.some(
              (id: unknown) =>
                !identity.locations.some((l: any) => l.id === id),
            )
          )
            throw new Error("Select one to ten authorized Square locations.");
          for (const id of input.locations)
            await squareRead(
              environment,
              "/v2/payments?" +
                new URLSearchParams({ location_id: id, limit: "1" }),
              token,
            );
          data.selectedLocations = [...new Set(input.locations)];
          data.status = "connected";
          data.error = null;
          data.lastSuccessfulRead = new Date().toISOString();
          await saveSeller(client, member.id, environment, data);
          return { view: sellerView(data, environment) };
        }
        if (
          !input.locations?.every((id: string) =>
            data.selectedLocations?.includes(id),
          )
        )
          throw new Error(
            "Select and save authorized locations before reviewing sales.",
          );
        const sample = await sellerSample(
          environment,
          token,
          { start: input.start, end: input.end, locations: input.locations },
          data.locations,
        );
        data.selectedLocations = input.locations;
        data.status = "connected";
        data.error = null;
        data.lastSuccessfulRead = new Date().toISOString();
        await saveSeller(client, member.id, environment, data);
        return {
          view: sellerView(data, environment),
          sample: sample.count
            ? {
                ...sample,
                options: { ...sample.options, account: data.merchantId },
                proof: signSquareReview(
                  {
                    org: member.id,
                    actor: actor.id,
                    expires: Date.now() + 900000,
                    csv: sample.csv,
                    options: { ...sample.options, account: data.merchantId },
                  },
                  environment,
                ),
              }
            : { count: 0 },
        };
      } catch (e) {
        data.status =
          (e as any).status === 401 ? "reconnect_required" : "sync_failed";
        data.error = (e as Error).message;
        await saveSeller(client, member.id, environment, data);
        return { view: sellerView(data, environment), error: data.error };
      }
    });
    const responseHeaders: any = { ...headers };
    if ("cookie" in result)
      responseHeaders["Set-Cookie"] =
        `cp_square_oauth=${result.cookie}; Path=/api/square-sales; HttpOnly; Secure; SameSite=Lax; Max-Age=${result.cookie ? 600 : 0}`;
    if ("redirect" in result)
      return new Response(null, {
        status: 303,
        headers: { ...responseHeaders, Location: result.redirect },
      });
    return Response.json(result, { headers: responseHeaders });
  } catch (e) {
    // Never return raw transport, database, authorization code, or credential errors.
    const message = (e as Error).message;
    const safe =
      /^(Square |Choose |Select |An Owner|The business Owner|The Owner|Open Square|Connect Square|Production Square)/.test(
        message,
      );
    return Response.json(
      {
        error: safe
          ? message
          : "Square management is unavailable. Sign in and retry. Contact support if it persists.",
      },
      { status: (e as any).status === 401 ? 401 : 400, headers },
    );
  }
};
export const config = { path: "/api/square-sales" };
