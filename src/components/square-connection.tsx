import { useEffect, useState } from "react";
import { FormErrorNotice } from "./form-error-notice";
import { tracePattern } from "@/lib/access-state";
export function SquareConnection({
  allowed,
  onReview,
  initiallyOpen = false,
}: {
  allowed: boolean;
  onReview: (sample: any, environment: string) => void;
  initiallyOpen?: boolean;
}) {
  const [environment, setEnvironment] = useState(""),
    [view, setView] = useState<any>(null),
    [open, setOpen] = useState(initiallyOpen),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [locations, setLocations] = useState<string[]>([]),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [disconnect, setDisconnect] = useState(false);
  async function request(action?: string, selected = environment) {
    setBusy(true);
    setError("");
    try {
      const trace = new URLSearchParams(window.location.search).get(
        "accessTrace",
      );
      const traceHeaders: Record<string, string> =
        trace && tracePattern.test(trace) ? { "X-Access-Trace": trace } : {};
      const r = await fetch(
        "/api/square-sales" +
          (!action ? (selected ? "?environment=" + selected : "") : ""),
        action
          ? {
              method: "POST",
              headers: { ...traceHeaders, "Content-Type": "application/json" },
              body: JSON.stringify({
                action,
                environment: selected,
                startLocal: start,
                endLocal: end,
                locations,
                confirm: disconnect,
              }),
            }
          : { headers: traceHeaders },
      );
      const j = await r.json().catch(() => {
        throw new Error(
          "Square management is temporarily unavailable. Retry in a moment.",
        );
      });
      if (j.view) {
        setView(j.view);
        setEnvironment(j.view.environment);
        if (!action || action === "disconnect" || action === "locations")
          setLocations(j.view.selectedLocations || []);
      }
      if (!r.ok || j.error)
        throw new Error(
          j.error || "Square request failed. Retry your selection.",
        );
      if (j.authorizationUrl) window.location.assign(j.authorizationUrl);
      if (j.sample?.count) onReview(j.sample, selected);
      else if (j.sample)
        setError(
          "No completed supported sales were found in the selected range. No records were imported.",
        );
      if (action === "disconnect") setDisconnect(false);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Square could not be reached. Check your connection and retry."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initiallyOpen && allowed) void request();
  }, [initiallyOpen, allowed]);
  return (
    <div className="square-connection">
      {!initiallyOpen && (
        <button
          type="button"
          className="btn secondary"
          disabled={!allowed || busy}
          onClick={() => {
            setOpen(!open);
            if (!open) void request();
          }}
        >
          Connect / manage Square
        </button>
      )}
      {open && (
        <div className="calculation-box">
          <h3>Square</h3>
          {!allowed && <p>The business Owner manages Square connections.</p>}
          <p>
            Connect your Square account, then choose locations. Connecting does
            not import sales.
          </p>
          {view && (
            <>
              <p role="status">
                {(
                  {
                    not_connected: "Not connected",
                    connected: "Connected · merchant identity verified",
                    reconnect_required: "Needs reconnection",
                    sync_failed: "Last read failed · retry when ready",
                  } as any
                )[view.status] || "Not connected"}
              </p>
              <p>
                Merchant: {view.merchantName || "Not verified"}{" "}
                {view.merchantId ? `(${view.merchantId})` : ""} · Business:{" "}
                {view.businessName || "Current workspace"}
              </p>
              {view.merchantId && (
                <p>
                  Last successful import:{" "}
                  {view.lastSuccessfulSync
                    ? new Date(view.lastSuccessfulSync).toLocaleString()
                    : "Never"}
                </p>
              )}
              <details>
                <summary>About this connection</summary>
                <p>
                  Read-only access to merchant profile, orders and payments. No
                  inventory or payment changes. Recurring sync is disabled.
                </p>
                <p>
                  Last successful read: {view.lastSuccessfulRead || "Never"}.
                  Connecting never starts a backfill. Import requires a separate
                  confirmation.
                </p>
              </details>
              {!view.configured && (
                <p>Square connection is not available yet. Contact support.</p>
              )}
              {!!view.locations?.length && (
                <fieldset>
                  <legend>Locations to review</legend>
                  {view.locations.map((l: any) => (
                    <label className="check-label" key={l.id}>
                      <input
                        type="checkbox"
                        checked={locations.includes(l.id)}
                        onChange={(e) =>
                          setLocations(
                            e.target.checked
                              ? [...locations, l.id]
                              : locations.filter((id) => id !== l.id),
                          )
                        }
                      />
                      {l.name} · {l.timezone} · {l.currency}
                    </label>
                  ))}
                </fieldset>
              )}
            </>
          )}
          {!!view?.locations?.length && (
            <button
              type="button"
              className="btn secondary"
              disabled={!allowed || busy || !locations.length}
              onClick={() => void request("locations")}
            >
              Save locations &amp; verify access
            </button>
          )}
          {view?.configured &&
            ["connected", "sync_failed"].includes(view?.status) &&
            !!view?.selectedLocations?.length && (
              <>
                <div className="square-mapping-grid">
                  <label>
                    Start (UTC, inclusive)
                    <input
                      type="datetime-local"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </label>
                  <label>
                    End (UTC, exclusive)
                    <input
                      type="datetime-local"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </label>
                </div>
                <details>
                  <summary>Import limits and duplicate protection</summary>
                  <p>
                    At most 31 days, 200 payments and 50 orders per review.
                    Transaction totals only; no product quantities or
                    allocations are inferred. Refund/return, service-charge,
                    cash-rounding and split-payment cases require a reconciled
                    CSV. Fees may be unknown until Square provides them. CSV
                    seller reference must equal the merchant ID above to
                    reconcile shared source IDs.
                  </p>
                </details>
                <p>
                  Preview sales before importing. Check for overlap with earlier
                  CSV imports.
                </p>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={
                    !allowed || busy || !start || !end || !locations.length
                  }
                  onClick={() => void request("sample")}
                >
                  Preview sales
                </button>
              </>
            )}
          {disconnect && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={disconnect}
                onChange={(e) => setDisconnect(e.target.checked)}
              />
              Disconnect, revoke this access token and remove its saved refresh
              credentials; preserve previously imported sales.
            </label>
          )}
          <FormErrorNotice message={error || view?.error} />
          <div className="button-row">
            <button
              type="button"
              className="btn"
              disabled={!allowed || busy || !view?.configured}
              onClick={() => void request("connect")}
            >
              {busy
                ? "Working…"
                : view?.merchantId
                  ? "Reconnect Square"
                  : "Connect Square"}
            </button>
            {view?.merchantId && (
              <button
                type="button"
                className="text-button"
                disabled={!allowed || busy}
                onClick={() =>
                  disconnect ? void request("disconnect") : setDisconnect(true)
                }
              >
                {disconnect ? "Confirm Disconnect" : "Disconnect"}
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={!allowed || busy}
              onClick={() => void request()}
            >
              Refresh status
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
