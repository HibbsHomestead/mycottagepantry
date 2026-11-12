import { describe, expect, it } from "vitest";
import { demoData } from "./demo";
import { type Item } from "./domain";
import {
  countEvidence,
  countLineView,
  countMatches,
  countCsv,
  rapidCountCommand,
  packageOptions,
  verifiedPackage,
} from "./rapid-count";
function fixture() {
  const w = demoData();
  w.inventory_counts = [];
  w.journals = [];
  for (const key of Object.keys(w)) if (key !== "settings") w[key] = [];
  w.ingredients = [
    {
      id: "sugar",
      name: "Powdered sugar",
      unit: "lb",
      quantity: 0,
      cost: 2,
      trackInventory: true,
      barcode: "000100",
      purchaseQuantity: 7,
      purchaseUnit: "lb",
      brand: "Default brand",
      allergens: ["Milk"],
      packagePrice: 19,
    },
    {
      id: "supply",
      name: "Twine",
      unit: "each",
      quantity: 10,
      cost: 1,
      usedAs: "supply",
    },
  ];
  w.settings[0].timezone = "America/Chicago";
  let n = 0;
  const revision = (item: Item) =>
    JSON.stringify([
      item.quantity,
      item.unit,
      item.conversions,
      w.ledger
        .filter((l) => l.ingredientId === item.id)
        .map((l) => [l.id, l.quantity]),
    ]);
  const ctx = {
    actor: "counter",
    role: "Owner",
    now: "2026-11-12T12:00:00Z",
    businessName: "Disposable business",
    revision,
  };
  const apply = (effects: ReturnType<typeof rapidCountCommand>) => {
    for (const e of effects) {
      w[e.table] = [
        ...(w[e.table] || []).filter((i) => i.id !== e.item.id),
        e.item,
      ];
    }
  };
  const command = (op: string, data: Record<string, unknown> = {}) => {
    const current = w.inventory_counts.find((s) => s.id === "count");
    const input = {
      id: "count",
      operationId: "operation-" + ++n,
      op,
      revision: current?.revision,
      ...data,
    };
    const effects = rapidCountCommand(w, input, ctx);
    apply(effects);
    return { effects, input };
  };
  const start = (type = "periodic", scopeIds = ["sugar"]) =>
    command("start", {
      name: "Physical count",
      type,
      preset: "Quarterly",
      scopeIds,
    });
  const session = () => w.inventory_counts[0];
  return { w, ctx, command, start, session, apply, revision };
}
describe("rapid package mapping and evidence", () => {
  it("preserves leading zeroes, existing packages and item metadata; 7 lb + 50 lb equals 57 lb", () => {
    const f = fixture();
    f.start();
    f.command("scan", {
      barcode: "000100",
      ingredientId: "sugar",
      packageId: "default",
    });
    f.command("unknown", { barcode: "000050" });
    f.command("assign", {
      ingredientId: "sugar",
      barcode: "000050",
      name: "Brand B 50 lb bag",
      brand: "Brand B",
      quantity: 50,
      unit: "lb",
      verified: true,
      additionalBarcodes: ["000051"],
    });
    expect(countEvidence(f.session()).lines[0].countedQuantity).toBe(57);
    expect(countMatches(f.w, "000051")[0].package.quantity).toBe(50);
    expect(f.w.ingredients.find((i) => i.id === "sugar")).toMatchObject({
      barcode: "000100",
      brand: "Default brand",
      allergens: ["Milk"],
      packagePrice: 19,
    });
    expect(
      packageOptions(f.w.ingredients.find((i) => i.id === "sugar")!),
    ).toHaveLength(2);
  });
  it("queues unknown occurrences and resolves exactly once, including replay after a lost response", () => {
    const f = fixture();
    f.start();
    f.command("unknown", { barcode: "000050" });
    f.command("unknown", { barcode: "000050" });
    expect(countEvidence(f.session()).lines).toHaveLength(0);
    const result = f.command("assign", {
      ingredientId: "sugar",
      barcode: "000050",
      name: "Large bag",
      quantity: 50,
      unit: "lb",
      verified: true,
    });
    expect(countEvidence(f.session()).lines[0].countedQuantity).toBe(100);
    expect(rapidCountCommand(f.w, result.input, f.ctx)).toEqual([]);
    expect(countEvidence(f.session()).unresolved).toHaveLength(0);
    const copied = structuredClone(f.w);
    expect(countMatches(copied, "000050")).toHaveLength(1);
  });
  it("exposes ambiguous mappings and requires choosing the package; missing and incompatible contents cannot count", () => {
    const f = fixture();
    f.w.ingredients.push({
      ...f.w.ingredients[0],
      id: "other",
      name: "Other item",
    });
    expect(countMatches(f.w, "000100")).toHaveLength(2);
    const item = f.w.ingredients[0];
    expect(() =>
      verifiedPackage(item, {
        name: "Unknown density",
        barcodes: ["0009"],
        quantity: 1,
        unit: "cup",
        verified: true,
      }),
    ).toThrow();
    delete item.purchaseQuantity;
    expect(packageOptions(item)[0].verified).toBe(false);
    f.start();
    expect(() =>
      f.command("scan", {
        barcode: "000100",
        ingredientId: "sugar",
        packageId: "default",
      }),
    ).toThrow(/verified/);
  });
  it("normalizes compatible package units, preserves zero strings, and can deactivate without deleting mappings", () => {
    const f = fixture();
    f.start();
    f.command("unknown", { barcode: "000007" });
    f.command("assign", {
      ingredientId: "sugar",
      barcode: "000007",
      name: "16 ounce bag",
      quantity: 16,
      unit: "oz",
      verified: true,
    });
    expect(countEvidence(f.session()).lines[0].countedQuantity).toBe(1);
    const p = f.w.ingredients.find((i) => i.id === "sugar")!.countPackages[0];
    f.command("packageStatus", {
      ingredientId: "sugar",
      packageId: p.id,
      active: false,
    });
    expect(countMatches(f.w, "000007")).toHaveLength(0);
    expect(countEvidence(f.session()).lines[0].countedQuantity).toBe(1);
  });
  it("replaces an opened package full scan with remaining amount, and undo restores the full scan", () => {
    const f = fixture();
    f.start();
    const first = f.command("scan", {
      barcode: "000100",
      ingredientId: "sugar",
      packageId: "default",
    });
    f.command("partial", {
      ingredientId: "sugar",
      quantity: 2.5,
      unit: "lb",
      replaces: first.input.operationId,
    });
    expect(countEvidence(f.session()).lines[0].countedQuantity).toBe(2.5);
    f.command("undo");
    expect(countEvidence(f.session()).lines[0].countedQuantity).toBe(7);
    f.command("undo");
    expect(countEvidence(f.session()).lines).toHaveLength(0);
  });
});
describe("count review, application and history", () => {
  it("posts opening stock with the existing opening model, no purchase expense, and immutable snapshot evidence", () => {
    const f = fixture();
    f.start("opening");
    f.command("scan", {
      barcode: "000100",
      ingredientId: "sugar",
      packageId: "default",
    });
    f.command("review");
    const applied = f.command("apply", { confirm: true });
    expect(f.w.ingredients.find((i) => i.id === "sugar")!.quantity).toBe(7);
    expect(f.w.ledger[0]).toMatchObject({
      type: "opening_balance",
      quantity: 7,
      countId: "count",
    });
    expect(f.w.journals[0].lines[1].account).toBe("Owner equity");
    expect(f.w.expenses).toHaveLength(0);
    expect(f.session().report.lines[0]).toMatchObject({
      difference: 7,
      valueDifference: 14,
      costBasis: 2,
    });
    expect(rapidCountCommand(f.w, applied.input, f.ctx)).toEqual([]);
    f.w.ingredients.find((i) => i.id === "sugar")!.cost = 50;
    expect(f.session().report.lines[0].valueDifference).toBe(14);
    expect(countCsv(f.session())).toContain("opening-count-count-0");
  });
  it("requires confirmed missing opening valuation, distinguishes valid zero, and does not invent stock value", () => {
    const f = fixture();
    f.w.ingredients[0].needsCostSetup = true;
    f.start("opening");
    f.command("manual", { ingredientId: "sugar", quantity: 3, unit: "lb" });
    f.command("review");
    expect(() => f.command("apply", { confirm: true })).toThrow(
      /valuation unavailable/,
    );
    f.command("valuation", { ingredientId: "sugar", openingValue: 0 });
    f.command("review");
    f.command("apply", { confirm: true });
    expect(f.w.ledger[0].amount).toBe(0);
    expect(f.w.journals).toHaveLength(0);
    expect(f.session().report.lines[0].costBasis).toBe(0);
  });
  it("opening counts with existing balances reconcile to totals only after explicit history review", () => {
    const f = fixture();
    f.w.ingredients[0].quantity = 5;
    f.start("opening");
    f.command("manual", { ingredientId: "sugar", quantity: 7, unit: "lb" });
    f.command("review");
    expect(() => f.command("apply", { confirm: true })).toThrow(
      /existing stock/,
    );
    f.command("apply", { confirm: true, existingStockReviewed: true });
    expect(f.w.ingredients.find((i) => i.id === "sugar")!.quantity).toBe(7);
    expect(f.w.ledger[0]).toMatchObject({ type: "adjustment", quantity: 2 });
  });
  it("periodic shortages, overages, matches, explicit zero and partial completion preserve uncounted stock", () => {
    const f = fixture();
    f.w.ingredients[0].quantity = 5;
    f.start("periodic", ["sugar", "supply"]);
    f.command("manual", { ingredientId: "sugar", quantity: 0, unit: "lb" });
    expect(() => f.command("review")).toThrow(/Partial/);
    f.command("review", { partial: true });
    f.command("apply", { confirm: true, partial: true });
    expect(f.session().partial).toBe(true);
    expect(f.session().report.lines[0].difference).toBe(-5);
    expect(f.w.ingredients.find((i) => i.id === "supply")!.quantity).toBe(10);
    expect(f.session().report.uncounted).toHaveLength(1);
    expect(countCsv(f.session())).toContain("Uncounted");
  });
  it("detects net-zero stock movement, blocks stale overlapping counts, and requires a real recount", () => {
    const f = fixture();
    f.start();
    f.command("scan", {
      barcode: "000100",
      ingredientId: "sugar",
      packageId: "default",
    });
    f.w.ledger.push({
      id: "movement",
      name: "Movement",
      ingredientId: "sugar",
      quantity: 0,
    });
    expect(() => f.command("review")).toThrow(/Stock moved/);
    f.command("recount", { ingredientId: "sugar", quantity: 6, unit: "lb" });
    f.command("review");
    f.w.ingredients.find((i) => i.id === "sugar")!.quantity = 1;
    expect(() => f.command("apply", { confirm: true })).toThrow(/Stock moved/);
    expect(f.w.ledger).toHaveLength(1);
  });
  it("blocks permission forgery, foreign items, stale revisions, and competing counters", () => {
    const f = fixture();
    f.start();
    expect(() =>
      rapidCountCommand(
        f.w,
        {
          id: "count",
          op: "manual",
          operationId: "op",
          revision: 0,
          ingredientId: "sugar",
          quantity: 1,
          unit: "lb",
        },
        { ...f.ctx, role: "Read-only Accountant" },
      ),
    ).toThrow(/role/);
    expect(() =>
      f.command("manual", {
        ingredientId: "foreign",
        quantity: 1,
        unit: "lb",
      }),
    ).toThrow(/unavailable/);
    expect(() =>
      rapidCountCommand(
        f.w,
        { id: "count", op: "undo", operationId: "op", revision: 0 },
        { ...f.ctx, actor: "other" },
      ),
    ).toThrow(/owns/);
    f.command("manual", { ingredientId: "sugar", quantity: 1, unit: "lb" });
    expect(() =>
      rapidCountCommand(
        f.w,
        { id: "count", op: "undo", operationId: "new", revision: 0 },
        f.ctx,
      ),
    ).toThrow(/another tab/);
    const effects = rapidCountCommand(
      f.w,
      {
        id: "count",
        op: "takeover",
        operationId: "take",
        revision: 1,
        confirm: true,
      },
      { ...f.ctx, actor: "other" },
    );
    expect(effects.at(-1)!.item.ownerId).toBe("other");
  });
  it("cancelled counts have no stock effects and cannot be edited; zero matches create no adjustment", () => {
    const f = fixture();
    f.start();
    f.command("manual", { ingredientId: "sugar", quantity: 0, unit: "lb" });
    f.command("review");
    f.command("apply", { confirm: true });
    expect(f.w.ledger).toHaveLength(0);
    expect(f.session().report.lines[0].difference).toBe(0);
    const other = fixture();
    other.start();
    other.command("cancel");
    expect(other.w.ledger).toHaveLength(0);
    expect(() =>
      other.command("manual", {
        ingredientId: "sugar",
        quantity: 1,
        unit: "lb",
      }),
    ).toThrow(/immutable/);
  });
  it("serializes signed discrepancies, units, package evidence, unavailable valuation and adjustment links in CSV", () => {
    const f = fixture();
    f.start();
    f.command("scan", {
      barcode: "000100",
      ingredientId: "sugar",
      packageId: "default",
    });
    f.command("review");
    f.command("apply", { confirm: true });
    const report = countCsv(f.session());
    expect(report).toContain('"Difference"');
    expect(report).toContain('"lb"');
    expect(report).toContain("000100");
    expect(report).toContain("count-count-sugar");
  });
});

it("reuses assigned mappings in a future count and can replace a previously unresolved full package with a partial amount", () => {
  const f = fixture();
  f.start();
  const unknown = f.command("unknown", { barcode: "000050" });
  f.command("assign", {
    ingredientId: "sugar",
    barcode: "000050",
    name: "Large bag",
    quantity: 50,
    unit: "lb",
    verified: true,
  });
  f.command("partial", {
    ingredientId: "sugar",
    quantity: 12,
    unit: "lb",
    replaces: unknown.input.operationId,
  });
  expect(countEvidence(f.session()).lines[0].countedQuantity).toBe(12);
  f.command("cancel");
  const p = countMatches(f.w, "000050")[0].package;
  const effects = rapidCountCommand(
    f.w,
    {
      id: "future",
      op: "start",
      type: "periodic",
      preset: "Monthly",
      name: "Future count",
      scopeIds: ["sugar"],
    },
    f.ctx,
  );
  f.apply(effects);
  f.apply(
    rapidCountCommand(
      f.w,
      {
        id: "future",
        op: "scan",
        operationId: "future-scan",
        revision: 0,
        barcode: "000050",
        ingredientId: "sugar",
        packageId: p.id,
      },
      f.ctx,
    ),
  );
  expect(
    f.w.inventory_counts.find((s) => s.id === "future")!.lines[0]
      .countedQuantity,
  ).toBe(50);
});
it("rejects reused operation IDs with different evidence and missing periodic valuation without any stock writes", () => {
  const f = fixture();
  f.start();
  const scan = f.command("scan", {
    barcode: "000100",
    ingredientId: "sugar",
    packageId: "default",
  });
  expect(() =>
    rapidCountCommand(f.w, { ...scan.input, barcode: "changed" }, f.ctx),
  ).toThrow(/different count evidence/);
  f.w.ingredients.find((i) => i.id === "sugar")!.needsCostSetup = true;
  f.command("review");
  expect(() => f.command("apply", { confirm: true })).toThrow(
    /Valuation unavailable/,
  );
  expect(f.w.ledger).toHaveLength(0);
});

it("projects canonical quantities using the snapshotted stock display basis", () => {
  const line = {
    id: "sugar",
    name: "Sugar",
    unit: "g",
    displayUnit: "lb",
    displayFactor: 1 / 453.59237,
    systemQuantity: 4535.9237,
    countedQuantity: 25854.76509,
    costBasis: 2 / 453.59237,
    evidence: [{ quantity: 3175.14659 }],
  };
  const view = countLineView(line);
  expect(view.unit).toBe("lb");
  expect(view.systemQuantity).toBe(10);
  expect(view.countedQuantity).toBe(57);
  expect(view.costBasis).toBeCloseTo(2);
  expect(view.evidence[0].quantity).toBe(7);
  expect(line.unit).toBe("g");
  expect(countLineView({ ...line, costBasis: null }).costBasis).toBeNull();
  expect(countLineView({ ...line, costBasis: 0 }).costBasis).toBe(0);
});
