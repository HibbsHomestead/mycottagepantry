import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ScanBarcode,
  Plus,
  Check,
  Undo2,
  Pause,
  FileDown,
  Printer,
} from "lucide-react";
import { type Workspace, type Item, money, convert } from "@/lib/domain";
import {
  countableItems,
  countMatches,
  countSummary,
  countLineView,
  countPresets,
  countCsv,
} from "@/lib/rapid-count";
import { onHandText } from "@/lib/inventory-browse";
import { ovenTimezone, ovenTimestamp } from "@/lib/oven-dates";
import { BarcodeScanner } from "./barcode-scanner";
import "./inventory-counts.css";
const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 8 });
const statusName = (s: string) =>
  s === "completed"
    ? "Applied"
    : s === "ready"
      ? "Ready for review"
      : s === "cancelled"
        ? "Cancelled"
        : "In progress";
type Job = {
  id: string;
  op: string;
  operationId: string;
  [key: string]: unknown;
};
export function InventoryCounts({
  workspace: w,
  onWorkspace,
  role,
  ready,
  open,
  refresh,
}: {
  workspace: Workspace;
  onWorkspace: (w: Workspace) => void;
  role: string;
  ready: boolean;
  open: (kind: string, item?: Item) => void;
  refresh: () => Promise<void>;
}) {
  const [sessionId, setSessionId] = useState(""),
    [setup, setSetup] = useState(false),
    [name, setName] = useState(""),
    [type, setType] = useState("periodic"),
    [preset, setPreset] = useState("Quarterly"),
    [notes, setNotes] = useState(""),
    [correctionOf, setCorrectionOf] = useState(""),
    [countAt, setCountAt] = useState(new Date().toISOString().slice(0, 16)),
    [scope, setScope] = useState<string[]>([]),
    [category, setCategory] = useState("all"),
    [search, setSearch] = useState(""),
    [scanner, setScanner] = useState(false),
    [manualCode, setManualCode] = useState(""),
    [feedback, setFeedback] = useState(""),
    [haptic, setHaptic] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(0),
    [saving, setSaving] = useState(false),
    [saveFailed, setSaveFailed] = useState(false),
    [localEvents, setLocalEvents] = useState<Item[]>([]),
    [assignCode, setAssignCode] = useState(""),
    [assignment, setAssignment] = useState<Record<string, string>>({}),
    [manualItem, setManualItem] = useState(""),
    [quantity, setQuantity] = useState(""),
    [unit, setUnit] = useState(""),
    [manualMode, setManualMode] = useState("manual"),
    [replace, setReplace] = useState(""),
    [lineNote, setLineNote] = useState(""),
    [openingValue, setOpeningValue] = useState(""),
    [partial, setPartial] = useState(false),
    [existingReviewed, setExistingReviewed] = useState(false),
    [confirm, setConfirm] = useState(false),
    [filter, setFilter] = useState("All"),
    [historySearch, setHistorySearch] = useState("");
  const workspaceRef = useRef(w),
    queue = useRef<Job[]>([]),
    sending = useRef(false),
    startId = useRef(""),
    failed = useRef(false);
  useLayoutEffect(() => {
    workspaceRef.current = w;
  }, [w]);
  const canCount =
      ready && ["Owner", "Manager", "Production Staff"].includes(role),
    canAssign = ready && ["Owner", "Manager"].includes(role);
  const sessions = (w.inventory_counts || []).filter((s) => s.version === 2);
  const saved = sessions.find((s) => s.id === sessionId);
  const time = (value: string) =>
    ovenTimestamp(value, {
      timezone: saved?.timezone || ovenTimezone(w.settings[0]),
    });
  const session = saved
    ? { ...saved, events: [...(saved.events || []), ...localEvents] }
    : undefined;
  const rawSummary = session ? countSummary(session) : undefined;
  const summary = rawSummary
    ? { ...rawSummary, lines: rawSummary.lines.map(countLineView) }
    : undefined;
  const items = countableItems(w),
    selected = items.find((i) => i.id === manualItem);
  const editable =
    canCount && saved && !["completed", "cancelled"].includes(saved.status);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.current.length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function drain() {
    if (sending.current) return;
    sending.current = true;
    setSaving(true);
    failed.current = false;
    setSaveFailed(false);
    setError("");
    try {
      while (queue.current.length) {
        const job = queue.current[0],
          current = workspaceRef.current.inventory_counts?.find(
            (s) => s.id === job.id,
          );
        const response = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "rapidInventoryCount",
            table: "inventory_counts",
            data: { ...job, revision: current?.revision },
          }),
        });
        const result = await response.json().catch(() => ({
          error:
            "Connection returned an unavailable response. Retry the pending operation.",
        }));
        if (!response.ok || !result.workspace)
          throw new Error(result.error || "Count could not save.");
        workspaceRef.current = result.workspace;
        onWorkspace(result.workspace);
        queue.current.shift();
        setPending(queue.current.length);
        setLocalEvents((events) =>
          events.filter((e) => e.id !== job.operationId),
        );
        if (job.op === "start") {
          setSessionId(job.id);
          setSetup(false);
          startId.current = "";
        }
      }
    } catch (e) {
      failed.current = true;
      setSaveFailed(true);
      setError(
        (e as Error).message +
          " Pending changes remain on this screen. Retry before leaving; offline saving is unavailable.",
      );
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }
  function command(
    op: string,
    data: Record<string, unknown> = {},
    optimistic?: Item,
  ) {
    if (!canCount || failed.current) return;
    const id = typeof data.id === "string" ? data.id : sessionId,
      operationId = crypto.randomUUID();
    queue.current.push({ ...data, id, op, operationId });
    setPending(queue.current.length);
    setConfirm(false);
    if (optimistic)
      setLocalEvents((events) => [
        ...events,
        {
          ...optimistic,
          id: operationId,
          at: new Date().toISOString(),
          actor: "pending",
        },
      ]);
    void drain();
  }
  function scanned(raw: string) {
    if (!saved || saved.status !== "draft" || failed.current) return;
    const matches = countMatches(workspaceRef.current, raw);
    const match = matches.length === 1 ? matches[0] : undefined;
    const scoped =
      match && saved.scope.some((b: Item) => b.ingredientId === match.item.id);
    if (
      match &&
      scoped &&
      match.package.verified &&
      match.package.stockQuantity > 0
    ) {
      command(
        "scan",
        {
          barcode: raw,
          ingredientId: match.item.id,
          packageId: match.package.id,
        },
        {
          id: "",
          name: match.item.name,
          kind: "scan",
          barcode: raw,
          ingredientId: match.item.id,
          quantity: match.package.stockQuantity,
          package: match.package,
        },
      );
      setFeedback(
        `${match.item.name} · ${match.package.name} · +${fmt(convert(match.package.stockQuantity, match.item.unit, match.item.storageUnit || match.item.unit, match.item.conversions))} ${match.item.storageUnit || match.item.unit}`,
      );
      if (haptic) navigator.vibrate?.(70);
    } else {
      command(
        "unknown",
        { barcode: raw },
        { id: "", name: raw, kind: "unknown", barcode: raw },
      );
      setFeedback(
        `${raw} queued: ${matches.length > 1 ? "choose the correct package" : match ? "package/scope setup needed" : "unknown barcode"}. No stock counted yet.`,
      );
    }
  }
  function begin(kind = "periodic") {
    setType(kind);
    setCorrectionOf("");
    setSetup(true);
    setScope(items.map((i) => i.id));
    setName(
      kind === "opening" ? "Opening inventory" : `${preset} inventory count`,
    );
    setError("");
  }
  function selectSession(id: string) {
    if (pending) return;
    setSessionId(id);
    setLocalEvents([]);
    setConfirm(false);
    setError("");
    setFilter("All");
    setPartial(!!sessions.find((s) => s.id === id)?.partial);
    setScanner(false);
  }
  function chooseManual(id: string) {
    const item = items.find((i) => i.id === id);
    setManualItem(id);
    setUnit(item?.storageUnit || item?.unit || "");
    setQuantity("");
    setReplace("");
    setOpeningValue("");
  }
  const visibleItems = items.filter(
    (i) =>
      (category === "all" || (i.usedAs || "ingredient") === category) &&
      i.name.toLowerCase().includes(search.toLowerCase()),
  );
  const queueCodes = [
    ...new Set((summary?.unresolved || []).map((e: Item) => e.barcode)),
  ] as string[];
  const running = (
    <div className="count-running">
      <p>
        Scan full, sealed packages only. Use Partial/open package for actual
        remaining contents; replace its full scan if already scanned.
      </p>
      <div className="count-feedback" role="status">
        <Check size={18} />
        <strong>{feedback || "Ready for the next package"}</strong>
      </div>
      <p>
        <strong>{summary?.counted || 0}</strong> / {saved?.scope.length || 0}{" "}
        items counted · {summary?.unresolved.length || 0} unresolved occurrences
      </p>
      {(summary?.lines || []).slice(-5).map((l: Item) => (
        <div className="count-compact-row" key={l.ingredientId}>
          <span>{l.name}</span>
          <strong>
            {fmt(l.countedQuantity)} {l.unit}
          </strong>
        </div>
      ))}
      <div className="count-actions">
        <button
          className="btn secondary"
          disabled={!editable || !!pending || saveFailed}
          onClick={() => command("undo")}
        >
          <Undo2 size={16} />
          Undo last scan/count
        </button>
        <button className="btn secondary" onClick={() => setScanner(false)}>
          <Pause size={16} />
          Pause / review
        </button>
      </div>
      <button
        className="btn secondary"
        disabled={!editable || !!pending}
        onClick={() => {
          const last = (summary?.lines || [])
            .flatMap((l: Item) => l.evidence)
            .filter((e: Item) => e.kind === "scan")
            .at(-1);
          chooseManual(last?.ingredientId || "");
          setManualMode("partial");
          setReplace(last?.id || "");
          setScanner(false);
        }}
      >
        Partial/open package
      </button>
      <p className="count-save-state" role="status">
        {pending
          ? `${pending} pending save${pending === 1 ? "" : "s"} — keep this screen open`
          : "All changes saved to your business"}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
  return (
    <div className="inventory-counts">
      <header className="count-heading">
        <div>
          <span className="eyebrow">PHYSICAL INVENTORY</span>
          <h2>Inventory counts</h2>
          <p>Scan packages. Review differences. Update stock once.</p>
        </div>
        <div className="count-actions">
          <button
            className="btn"
            disabled={!canCount || !!pending}
            onClick={() => begin()}
          >
            <Plus size={17} />
            Start count
          </button>
          <button
            className="btn secondary"
            disabled={!canCount || !!pending}
            onClick={() => begin("opening")}
          >
            Opening inventory
          </button>
        </div>
      </header>
      <p className="count-context">
        {w.settings[0]?.businessName ||
          w.settings[0]?.name ||
          "Current business"}{" "}
        · {ovenTimezone(w.settings[0])}. Ingredients, packaging, supplies and
        craft materials with stock tracking. Compound prep and product/kit
        balances use their existing workflows. Location labels do not represent
        separate balances.
      </p>
      {pending > 0 && saveFailed && (
        <div className="count-panel">
          <p role="alert">
            A request needs attention. Retry first if the connection was
            interrupted. To resolve a stale-revision conflict, discard only
            pending local commands and refresh; already saved evidence remains
            unchanged.
          </p>
          <button
            className="btn secondary"
            onClick={() => {
              queue.current = [];
              setPending(0);
              setLocalEvents([]);
              failed.current = false;
              setSaveFailed(false);
              setError("");
              void refresh();
            }}
          >
            Discard pending local commands & refresh saved count
          </button>
        </div>
      )}
      {!ready && <p role="status">Connect to your business before counting.</p>}
      {setup && (
        <section className="count-panel">
          <h3>Set up a count</h3>
          <div className="count-form-grid">
            <label className="field">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              Count type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="periodic">Periodic inventory count</option>
                <option value="opening">
                  Opening inventory — already owned
                </option>
              </select>
            </label>
            {type === "periodic" && (
              <label className="field">
                Preset
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                >
                  {countPresets.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              Reference count time (UTC)
              <input
                type="datetime-local"
                value={countAt}
                onChange={(e) => setCountAt(e.target.value)}
              />
            </label>
            <label className="field">
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <label className="field">
              Scope category
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setScope(
                    items
                      .filter(
                        (i) =>
                          e.target.value === "all" ||
                          (i.usedAs || "ingredient") === e.target.value,
                      )
                      .map((i) => i.id),
                  );
                }}
              >
                <option value="all">All supported categories</option>
                <option value="ingredient">Ingredients</option>
                <option value="packaging">Packaging</option>
                <option value="material">Craft materials</option>
                <option value="supply">Supplies</option>
              </select>
            </label>
            <label className="field">
              Search scope
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <p>
            Business time:{" "}
            {countAt && Number.isFinite(Date.parse(countAt + "Z"))
              ? ovenTimestamp(countAt + "Z", w.settings[0])
              : "Choose a valid time"}
          </p>
          <p>
            Reference time labels the session. Each line records its actual
            physical count time and comparison baseline; this is not a verified
            quarter-end snapshot.
          </p>
          <div className="count-actions">
            <button
              className="btn secondary"
              onClick={() =>
                setScope([
                  ...new Set([...scope, ...visibleItems.map((i) => i.id)]),
                ])
              }
            >
              Select shown items
            </button>
            <button
              className="btn secondary"
              onClick={() =>
                setScope(
                  scope.filter((id) => !visibleItems.some((i) => i.id === id)),
                )
              }
            >
              Clear shown items
            </button>
          </div>
          {visibleItems.map((i) => (
            <label className="count-scope-row" key={i.id}>
              <input
                type="checkbox"
                checked={scope.includes(i.id)}
                onChange={(e) =>
                  setScope(
                    e.target.checked
                      ? [...scope, i.id]
                      : scope.filter((id) => id !== i.id),
                  )
                }
              />
              <span>{i.name}</span>
              <small>{i.storageUnit || i.unit}</small>
            </label>
          ))}
          <p>
            {scope.length} scoped items. You can add newly created items later.
          </p>
          <div className="count-actions">
            <button
              className="btn"
              disabled={!scope.length || !!pending || !name.trim() || !countAt}
              onClick={() => {
                startId.current ||= crypto.randomUUID();
                command("start", {
                  id: startId.current,
                  name,
                  type,
                  preset,
                  notes,
                  scopeIds: scope,
                  correctionOf,
                  countAt: new Date(countAt + "Z").toISOString(),
                });
              }}
            >
              Save & start counting
            </button>
            <button className="btn secondary" onClick={() => setSetup(false)}>
              Close setup
            </button>
          </div>
        </section>
      )}
      {saved && session && summary && (
        <section className="count-session">
          <header className="count-panel">
            <div className="count-heading">
              <div>
                <h3>{saved.name}</h3>
                <p>
                  {saved.type === "opening"
                    ? "Opening inventory"
                    : "Periodic · " + saved.preset}{" "}
                  · <strong>{statusName(saved.status)}</strong>
                  {saved.partial ? " · Partial" : ""}
                </p>
              </div>
              <button
                className="btn secondary"
                disabled={!!pending}
                onClick={() => selectSession("")}
              >
                Count history
              </button>
            </div>
            <p>
              {saved.businessName} · Reference {time(saved.countAt)} ·{" "}
              {saved.timezone}
            </p>
            <p>
              Started {time(saved.startedAt)} · Counter {saved.counter} · Owner{" "}
              {saved.ownerId}
            </p>
            {editable && (
              <div className="count-actions">
                <button
                  className="btn"
                  disabled={!!pending || saveFailed || saved.status !== "draft"}
                  onClick={() => setScanner(true)}
                >
                  <ScanBarcode size={18} />
                  Open rapid scanner
                </button>
                {saved.status === "ready" && (
                  <button
                    className="btn secondary"
                    disabled={!!pending}
                    onClick={() => command("resume")}
                  >
                    Return to counting
                  </button>
                )}
                <button
                  className="btn secondary"
                  disabled={!!pending}
                  onClick={() => {
                    void refresh();
                  }}
                >
                  Refresh balances
                </button>
                <button
                  className="btn secondary"
                  disabled={!!pending}
                  onClick={() => command("takeover", { confirm: true })}
                >
                  Take ownership (Owner/Manager)
                </button>
              </div>
            )}
            {editable && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={haptic}
                  onChange={(e) => setHaptic(e.target.checked)}
                />
                Vibrate on accepted scan (if supported)
              </label>
            )}
            {running}
            {!!pending && (
              <button
                className="btn secondary"
                disabled={saving}
                onClick={() => void drain()}
              >
                Retry pending saves
              </button>
            )}
            {editable && (
              <form
                className="count-manual-barcode"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (manualCode.trim()) {
                    scanned(manualCode.trim());
                    setManualCode("");
                  }
                }}
              >
                <label className="field">
                  Manual / external scanner barcode
                  <input
                    value={manualCode}
                    autoComplete="off"
                    onChange={(e) => setManualCode(e.target.value)}
                  />
                </label>
                <button
                  className="btn secondary"
                  disabled={
                    !manualCode.trim() || saveFailed || saved.status !== "draft"
                  }
                >
                  Count barcode
                </button>
              </form>
            )}
          </header>
          {editable && (
            <section className="count-panel">
              <h3>Count without a barcode / correct a line</h3>
              <div className="count-form-grid">
                <label className="field">
                  Search items
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label className="field">
                  Item
                  <select
                    value={manualItem}
                    onChange={(e) => chooseManual(e.target.value)}
                  >
                    <option value="">Choose an item</option>
                    {items
                      .filter((i) =>
                        i.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((i) => (
                        <option value={i.id} key={i.id}>
                          {i.name}
                          {saved.scope.some(
                            (b: Item) => b.ingredientId === i.id,
                          )
                            ? ""
                            : " · outside scope"}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {selected &&
              !saved.scope.some((b: Item) => b.ingredientId === selected.id) ? (
                <button
                  className="btn secondary"
                  disabled={!!pending}
                  onClick={() =>
                    command("addScope", { ingredientId: selected!.id })
                  }
                >
                  Add selected item to scope
                </button>
              ) : (
                selected && (
                  <>
                    <p>
                      Current balance {onHandText(selected)}. Opening counts
                      with existing stock/history require reconciliation review.
                    </p>
                    <div className="count-form-grid">
                      <label className="field">
                        Entry type
                        <select
                          value={manualMode}
                          onChange={(e) => setManualMode(e.target.value)}
                        >
                          <option value="manual">Add manual quantity</option>
                          <option value="partial">Partial/open package</option>
                          <option value="recount">
                            Recount / replace entire item total
                          </option>
                        </select>
                      </label>
                      <label className="field">
                        {manualMode === "partial"
                          ? "Actual remaining amount"
                          : "Count quantity"}
                        <input
                          inputMode="decimal"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        Unit
                        <input
                          value={unit}
                          onChange={(e) => setUnit(e.target.value)}
                        />
                      </label>
                      {manualMode === "partial" && (
                        <label className="field">
                          Full scan to replace
                          <select
                            value={replace}
                            onChange={(e) => setReplace(e.target.value)}
                          >
                            <option value="">
                              Separate partial package (not already scanned)
                            </option>
                            {summary.lines
                              .flatMap((l: Item) => l.evidence)
                              .filter(
                                (e: Item) =>
                                  e.kind === "scan" &&
                                  e.ingredientId === selected.id,
                              )
                              .map((e: Item) => (
                                <option value={e.id} key={e.id}>
                                  {e.barcode} · {e.package?.name} · {time(e.at)}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      <label className="field">
                        Discrepancy note
                        <input
                          value={lineNote}
                          onChange={(e) => setLineNote(e.target.value)}
                        />
                      </label>
                      {saved.type === "opening" && (
                        <label className="field">
                          Confirmed total opening value (optional if valid cost
                          saved)
                          <input
                            inputMode="decimal"
                            value={openingValue}
                            onChange={(e) => setOpeningValue(e.target.value)}
                          />
                        </label>
                      )}
                    </div>
                    <p>
                      {manualMode === "recount"
                        ? "Recount replaces all earlier scans and manual amounts for this item with the new physically verified total and current stock baseline."
                        : "For an opened package, enter the actual remaining amount. Replace its full scan if it was already scanned."}
                    </p>
                    <div className="count-actions">
                      <button
                        className="btn secondary"
                        disabled={!!pending || quantity === ""}
                        onClick={() => {
                          command(manualMode, {
                            ingredientId: selected!.id,
                            quantity,
                            unit,
                            note: lineNote,
                            openingValue,
                            replaces: replace,
                          });
                          setQuantity("");
                        }}
                      >
                        Save{" "}
                        {manualMode === "recount"
                          ? "recounted total"
                          : "actual amount"}
                      </button>
                      <button
                        className="btn secondary"
                        disabled={!!pending}
                        onClick={() =>
                          command("recount", {
                            ingredientId: selected!.id,
                            quantity: 0,
                            unit: selected!.unit,
                            note: "Physically counted: zero",
                            openingValue,
                          })
                        }
                      >
                        Counted: zero (replace item total)
                      </button>
                      {saved.type === "opening" && (
                        <button
                          className="btn secondary"
                          disabled={!!pending || openingValue === ""}
                          onClick={() =>
                            command("valuation", {
                              ingredientId: selected!.id,
                              openingValue,
                            })
                          }
                        >
                          Save total opening valuation only
                        </button>
                      )}
                    </div>
                  </>
                )
              )}
            </section>
          )}
          {!!queueCodes.length && (
            <section className="count-panel">
              <h3>Unresolved barcodes</h3>
              <p>
                Queued occurrences do not contribute to stock until explicitly
                assigned. Leave them for a Partial report if needed.
              </p>
              {queueCodes.map((code) => (
                <div className="count-compact-row" key={code}>
                  <code>{code}</code>
                  <span>
                    {
                      summary.unresolved.filter((e: Item) => e.barcode === code)
                        .length
                    }{" "}
                    occurrences
                  </span>
                  {editable && (
                    <button
                      className="btn secondary"
                      disabled={!!pending}
                      onClick={() => {
                        setAssignCode(code);
                        setAssignment({});
                      }}
                    >
                      Resolve / link
                    </button>
                  )}
                </div>
              ))}
              {assignCode && editable && (
                <div className="count-assignment">
                  <h4>Resolve {assignCode}</h4>
                  {countMatches(w, assignCode).map((m, index) => (
                    <div key={index}>
                      <p>
                        {m.item.name} · {m.package.name} ·{" "}
                        {m.package.quantity || "?"} {m.package.unit} ·{" "}
                        {m.package.verified
                          ? "Verified contents"
                          : "Needs setup"}
                      </p>
                      {!saved.scope.some(
                        (b: Item) => b.ingredientId === m.item.id,
                      ) ? (
                        <button
                          className="btn secondary"
                          disabled={!!pending}
                          onClick={() =>
                            command("addScope", { ingredientId: m.item.id })
                          }
                        >
                          Add this item to scope
                        </button>
                      ) : (
                        <button
                          className="btn secondary"
                          disabled={!!pending || !m.package.verified}
                          onClick={() => {
                            command("resolve", {
                              barcode: assignCode,
                              ingredientId: m.item.id,
                              packageId: m.package.id,
                            });
                            setAssignCode("");
                          }}
                        >
                          Use this exact package for queued occurrences
                        </button>
                      )}
                    </div>
                  ))}
                  {canAssign && (
                    <>
                      <h4>One-time package assignment</h4>
                      <label className="field">
                        Search existing items
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <div className="count-form-grid">
                        <label className="field">
                          Link existing item
                          <select
                            value={assignment.ingredientId || ""}
                            onChange={(e) =>
                              setAssignment({
                                ...assignment,
                                ingredientId: e.target.value,
                              })
                            }
                          >
                            <option value="">Choose an item</option>
                            {items
                              .filter((i) =>
                                i.name
                                  .toLowerCase()
                                  .includes(search.toLowerCase()),
                              )
                              .map((i) => (
                                <option value={i.id} key={i.id}>
                                  {i.name} · {i.unit}
                                </option>
                              ))}
                          </select>
                        </label>
                        {[
                          ["name", "Package description"],
                          ["brand", "Brand"],
                          ["vendor", "Vendor"],
                          ["quantity", "Package contents quantity"],
                          ["unit", "Contents unit"],
                          [
                            "additional",
                            "Other equivalent package barcodes (comma separated)",
                          ],
                        ].map(([key, label]) => (
                          <label className="field" key={key}>
                            {label}
                            <input
                              value={assignment[key] || ""}
                              onChange={(e) =>
                                setAssignment({
                                  ...assignment,
                                  [key]: e.target.value,
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <p>
                        Confirm the exact package identity and contents. Only
                        compatible units or existing verified conversions are
                        accepted. Default package, prices and
                        ingredient/allergen statements remain unchanged.
                      </p>
                      {assignment.ingredientId &&
                      !saved.scope.some(
                        (b: Item) => b.ingredientId === assignment.ingredientId,
                      ) ? (
                        <button
                          className="btn secondary"
                          disabled={!!pending}
                          onClick={() =>
                            command("addScope", {
                              ingredientId: assignment.ingredientId,
                            })
                          }
                        >
                          Add linked item to scope
                        </button>
                      ) : (
                        <button
                          className="btn"
                          disabled={
                            !!pending ||
                            !assignment.ingredientId ||
                            !assignment.name ||
                            !assignment.quantity ||
                            !assignment.unit
                          }
                          onClick={() => {
                            command("assign", {
                              ...assignment,
                              barcode: assignCode,
                              additionalBarcodes: (assignment.additional || "")
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                              verified: true,
                            });
                            setAssignCode("");
                          }}
                        >
                          Save this barcode/package assignment and count queued
                          packages
                        </button>
                      )}
                      <button
                        className="btn secondary"
                        disabled={!!pending}
                        onClick={() =>
                          open("ingredient", {
                            id: "",
                            name: "",
                            barcode: assignCode,
                            unit: "each",
                            quantity: 0,
                            threshold: 0,
                            usedAs: "ingredient",
                            purchaseQuantity: "",
                            purchaseUnit: "",
                            packagePrice: "",
                          })
                        }
                      >
                        Create new item in existing editor
                      </button>
                      <p>
                        Your saved count stays here. After saving the item,
                        select it above and add it to this scope.
                      </p>
                    </>
                  )}
                  <button
                    className="btn secondary"
                    onClick={() => setAssignCode("")}
                  >
                    Leave unresolved for later
                  </button>
                </div>
              )}
            </section>
          )}
          {editable && canAssign && (
            <details className="count-panel">
              <summary>Manage saved barcode packages</summary>
              {items
                .filter((i) =>
                  saved.scope.some((b: Item) => b.ingredientId === i.id),
                )
                .flatMap((i) =>
                  (i.countPackages || []).map((p: Item) => (
                    <div className="count-compact-row" key={i.id + p.id}>
                      <span>
                        {i.name} · {p.name} · {p.quantity} {p.unit} ·{" "}
                        {p.barcodes.join(", ")} ·{" "}
                        {p.active === false ? "Inactive" : "Active"}
                      </span>
                      <button
                        className="btn secondary"
                        disabled={!!pending}
                        onClick={() =>
                          command("packageStatus", {
                            ingredientId: i.id,
                            packageId: p.id,
                            active: p.active === false,
                          })
                        }
                      >
                        {p.active === false ? "Activate" : "Deactivate"}
                      </button>
                    </div>
                  )),
                )}
            </details>
          )}
          <section className="count-panel count-report">
            <div className="count-heading">
              <div>
                <h3>
                  {saved.status === "completed"
                    ? "Discrepancy report"
                    : "Review physical count"}
                </h3>
                <p>
                  {summary.counted} counted · {summary.matches} matches ·{" "}
                  {summary.shortages} shortages · {summary.overages} overages ·{" "}
                  {summary.uncounted.length} uncounted ·{" "}
                  {summary.unresolved.length} unresolved occurrences
                </p>
              </div>
              <div className="count-actions">
                <button
                  className="btn secondary"
                  onClick={() => {
                    const blob = new Blob([countCsv(saved)], {
                        type: "text/csv;charset=utf-8",
                      }),
                      url = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = `inventory-count-${saved.id}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <FileDown size={16} />
                  CSV
                </button>
                <button
                  className="btn secondary"
                  onClick={() => window.print()}
                >
                  <Printer size={16} />
                  Print report
                </button>
              </div>
            </div>
            <p>
              {saved.businessName} · {saved.name} · {saved.type} ·{" "}
              {statusName(saved.status)} ·{" "}
              {saved.partial ||
              summary.uncounted.length ||
              summary.unresolved.length
                ? "Partial / incomplete scope"
                : "Full scoped count"}{" "}
              · reference {time(saved.countAt)} ({saved.timezone}) · started{" "}
              {saved.startedAt} · counter {saved.counter}
            </p>
            <p>
              {saved.notes || "No session notes."}
              {saved.correctionOf
                ? ` · Correction of count ${saved.correctionOf}`
                : ""}
            </p>
            <p>
              Difference = counted − expected in each item’s stock unit. Values
              use saved cost only where available; quantities in unlike units
              are never summed. No shortage cause or tax deduction is inferred.
            </p>
            {saved.status === "completed" && (
              <p>
                Applied {time(saved.appliedAt)} · Approved{" "}
                {time(saved.approvedAt)} by {saved.approver}.{" "}
                {saved.partial
                  ? "Partial count: uncounted stock was unchanged."
                  : "Full scoped count."}{" "}
                Cost snapshots below do not change with future prices.
              </p>
            )}
            <label className="field count-no-print">
              Report filter
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  "All",
                  "Shortages",
                  "Overages",
                  "Matches",
                  "Uncounted/unresolved",
                ].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <div
              className="count-review-table"
              role="table"
              aria-label="Count discrepancies"
            >
              <div className="count-review-head" role="row">
                <span role="columnheader">Item</span>
                <span role="columnheader">Expected</span>
                <span role="columnheader">Counted</span>
                <span role="columnheader">Difference</span>
                <span role="columnheader">Unit / status</span>
              </div>
              {summary.lines
                .filter(
                  (l: Item) =>
                    filter === "All" ||
                    (filter === "Shortages" &&
                      l.countedQuantity < l.systemQuantity) ||
                    (filter === "Overages" &&
                      l.countedQuantity > l.systemQuantity) ||
                    (filter === "Matches" &&
                      Math.abs(l.countedQuantity - l.systemQuantity) < 1e-9),
                )
                .map((l: Item) => {
                  const i = items.find((i) => i.id === l.ingredientId),
                    conflict =
                      saved.status !== "completed" &&
                      i?.inventoryRevision !== l.inventoryRevision;
                  const history =
                    Number(i?.quantity) !== 0 ||
                    i?.openingStockRecorded ||
                    w.ledger.some((e) => e.ingredientId === l.ingredientId);
                  const validCost =
                    typeof i?.cost === "number" &&
                    Number.isFinite(i.cost) &&
                    i.cost >= 0 &&
                    !i.needsCostSetup;
                  const previewValue =
                    saved.type === "opening" &&
                    !history &&
                    l.openingValue != null
                      ? l.openingValue
                      : validCost
                        ? ((l.countedQuantity - l.systemQuantity) * i!.cost) /
                          (l.displayFactor || 1)
                        : null;
                  return (
                    <div className="count-review-item" key={l.ingredientId}>
                      <div className="count-review-row" role="row">
                        <strong role="cell">{l.name}</strong>
                        <span role="cell" data-label="Expected">
                          {fmt(l.systemQuantity)}
                        </span>
                        <span role="cell" data-label="Counted">
                          {fmt(l.countedQuantity)}
                        </span>
                        <strong role="cell" data-label="Difference">
                          {l.countedQuantity - l.systemQuantity > 0 ? "+" : ""}
                          {fmt(l.countedQuantity - l.systemQuantity)}
                        </strong>
                        <span role="cell">
                          {l.unit} ·{" "}
                          {conflict
                            ? "Conflict — recount required"
                            : saved.status === "completed"
                              ? "Applied"
                              : "Counted"}
                        </span>
                      </div>
                      <details>
                        <summary>Package evidence, notes & valuation</summary>
                        <p>
                          Compared with {time(l.baselineAt)}; physically counted{" "}
                          {time(l.countedAt)}.{" "}
                          {saved.type === "opening" &&
                            history &&
                            "Existing stock/history: reconciliation review required."}
                        </p>
                        {l.evidence.map((e: Item) => (
                          <p key={e.id}>
                            {e.kind} ·{" "}
                            {e.package
                              ? `${e.package.name} · ${e.package.quantity} ${e.package.unit}`
                              : "Manual amount"}{" "}
                            · {e.barcode || ""} · {fmt(e.quantity)} {l.unit} ·{" "}
                            {time(e.at)}
                            {e.replaces ? " · replaces full scan" : ""}
                          </p>
                        ))}
                        <p>{l.note || "No discrepancy note."}</p>
                        <p>
                          {l.costBasis == null
                            ? saved.status === "completed"
                              ? "Valuation unavailable"
                              : previewValue == null
                                ? "Estimated value difference unavailable. Confirm an opening valuation or set up a valid saved cost before applying a change."
                                : `Estimated value difference ${money(previewValue)} · ${saved.type === "opening" && !history && l.openingValue != null ? "confirmed total opening value" : "current saved inventory cost"}; final basis snapshots at application.`
                            : `$${fmt(l.costBasis)} / ${l.unit} · ${l.valuationBasis} · effective ${l.costBasisAt} · value difference ${l.valueDifference == null ? "Unavailable" : money(l.valueDifference)}`}
                        </p>
                        {l.adjustmentId && (
                          <p>Adjustment reference: {l.adjustmentId}</p>
                        )}
                      </details>
                    </div>
                  );
                })}
              {(filter === "All" || filter === "Uncounted/unresolved") &&
                summary.uncounted.map((l: Item) => (
                  <div className="count-compact-row" key={l.ingredientId}>
                    <strong role="cell">{l.name}</strong>
                    <span>Uncounted — stock unchanged</span>
                  </div>
                ))}
              {(filter === "All" || filter === "Uncounted/unresolved") &&
                summary.unresolved.map((e: Item) => (
                  <div className="count-compact-row" key={e.id}>
                    <code>{e.barcode}</code>
                    <span>Unresolved — not included</span>
                  </div>
                ))}
            </div>
            {editable && (
              <div className="count-confirm count-no-print">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={partial}
                    onChange={(e) => {
                      setPartial(e.target.checked);
                      setConfirm(false);
                    }}
                  />
                  Allow an explicitly Partial count; unresolved and uncounted
                  stock stays unchanged.
                </label>
                {saved.type === "opening" && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={existingReviewed}
                      onChange={(e) => {
                        setExistingReviewed(e.target.checked);
                        setConfirm(false);
                      }}
                    />
                    I reviewed existing stock/history: those lines reconcile to
                    a total, rather than adding another opening balance.
                  </label>
                )}
                <p>
                  {saved.businessName} ·{" "}
                  {saved.type === "opening"
                    ? "Opening stock already owned"
                    : "Periodic physical reconciliation"}{" "}
                  · {saved.scope.length} scoped items ·{" "}
                  {
                    summary.lines.filter(
                      (l: Item) => l.countedQuantity !== l.systemQuantity,
                    ).length
                  }{" "}
                  affected items. Positive adjustments increase stock; negative
                  adjustments decrease it. Opening valuation uses the existing
                  opening-stock model; periodic valuation uses saved inventory
                  cost and existing adjustment accounting. This is not purchase
                  receiving.
                </p>
                {saved.status === "draft" ? (
                  <button
                    className="btn"
                    disabled={!!pending || !canCount}
                    onClick={() => command("review", { partial })}
                  >
                    Review & prepare stock update
                  </button>
                ) : (
                  <>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={confirm}
                        onChange={(e) => setConfirm(e.target.checked)}
                      />
                      I approve these {saved.partial ? "Partial" : "Full"} count
                      differences and their supported valuation effects.
                    </label>
                    <button
                      className="btn"
                      disabled={!!pending || !confirm || !canCount}
                      onClick={() =>
                        command("apply", {
                          partial,
                          confirm: true,
                          existingStockReviewed: existingReviewed,
                        })
                      }
                    >
                      Confirm & apply stock adjustments
                    </button>
                  </>
                )}
                <details>
                  <summary>Cancel without stock effects</summary>
                  <button
                    className="btn secondary"
                    disabled={!!pending}
                    onClick={() => command("cancel")}
                  >
                    Confirm cancel count
                  </button>
                </details>
              </div>
            )}
            {saved.status === "completed" && (
              <button
                className="btn secondary count-no-print"
                disabled={!canCount}
                onClick={() => {
                  begin("periodic");
                  setNotes("Correction linked to applied count " + saved.id);
                  setCorrectionOf(saved.id);
                }}
              >
                Start a linked correction count
              </button>
            )}
          </section>
        </section>
      )}
      {!saved && !setup && (
        <section className="count-panel">
          <h3>Resume draft / count history</h3>
          <label className="field">
            Find a saved count
            <input
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
          </label>
          {!sessions.length && (
            <p>
              No saved rapid counts yet. Start with any supported items; finish
              catalog setup later.
            </p>
          )}
          {sessions
            .filter((s) =>
              `${s.name} ${s.type} ${s.status}`
                .toLowerCase()
                .includes(historySearch.toLowerCase()),
            )
            .slice()
            .reverse()
            .map((s) => (
              <button
                className="count-history-row"
                key={s.id}
                onClick={() => selectSession(s.id)}
              >
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.type} · {s.date} · {s.lines.length}/{s.scope.length}{" "}
                    counted
                  </small>
                </span>
                <span>
                  {statusName(s.status)}
                  {s.partial ? " · Partial" : ""}
                </span>
              </button>
            ))}
          {(w.inventory_counts || []).some((s) => s.version !== 2) && (
            <p>
              Earlier count sessions remain available through Inventory Overview
              → Inventory count sessions.
            </p>
          )}
        </section>
      )}
      {error && !scanner && !saved && <p role="alert">{error}</p>}
      {scanner && saved && (
        <BarcodeScanner
          continuous
          onCode={scanned}
          onClose={() => setScanner(false)}
        >
          {running}
        </BarcodeScanner>
      )}
    </div>
  );
}
