import type { Item } from "./domain";

export const squareFields = [
  "transactionId",
  "paymentId",
  "orderId",
  "lineId",
  "itemId",
  "variationId",
  "date",
  "time",
  "location",
  "item",
  "variation",
  "sku",
  "quantity",
  "gross",
  "discounts",
  "refunds",
  "net",
  "tax",
  "tips",
  "serviceCharges",
  "payment",
  "fees",
  "currency",
] as const;
export type SquareField = (typeof squareFields)[number];
export type SquareOptions = {
  type: "items" | "transactions" | "summary";
  columns: Partial<Record<SquareField, string>>;
  currency: string;
  dateFormat: "MDY" | "DMY" | "ISO";
  timezone: string;
  account: string;
  extrasGrain: "transaction" | "item";
  feesSign?: "expense" | "deduction";
};
export type SquareRow = {
  row: number;
  raw: Record<string, string>;
  transactionId: string;
  paymentId: string;
  orderId: string;
  lineId: string;
  itemId: string;
  variationId: string;
  date: string;
  time: string;
  location: string;
  item: string;
  variation: string;
  sku: string;
  currency: string;
  quantity: number | null;
  amounts: Record<string, number | null>;
  mappingKey: string;
};
export type SquareChoice = {
  productId: string;
  multiplier: number;
  save?: boolean;
};
export type SquareBatch = Item & {
  provider: "square";
  status: "staged" | "committed" | "reversed";
  fingerprint: string;
  options: SquareOptions;
  rows: SquareRow[];
  errors: string[];
  warnings: string[];
  choices: Record<string, SquareChoice>;
};
const monetary = [
  "gross",
  "discounts",
  "refunds",
  "net",
  "tax",
  "tips",
  "serviceCharges",
  "payment",
  "fees",
] as const;
const aliases: Record<SquareField, string[]> = {
  transactionId: ["transaction id", "transaction"],
  paymentId: ["payment id"],
  orderId: ["order id"],
  lineId: ["line item id", "line id"],
  itemId: ["item id"],
  variationId: ["variation id"],
  date: ["date", "transaction date", "date/time", "date time"],
  time: ["time"],
  location: ["location", "location name"],
  item: ["item", "item name"],
  variation: ["variation", "item variation", "variation name"],
  sku: ["sku"],
  quantity: ["qty", "quantity", "items sold"],
  gross: ["gross sales"],
  discounts: ["discounts", "discount"],
  refunds: ["refunds", "refund", "returns"],
  net: ["net sales"],
  tax: ["tax", "taxes", "sales tax"],
  tips: ["tip", "tips"],
  serviceCharges: ["service charges"],
  payment: ["total collected", "payment amount", "total", "total amount"],
  fees: ["fees", "processing fees", "square fees"],
  currency: ["currency", "currency code"],
};
export function squareCsv(text: string) {
  if (!text || text.length > 2_000_000 || text.includes("\0"))
    throw new Error("Choose a UTF-8 CSV up to 2 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  const headers = rows.shift()?.map((h) => h.trim()) || [];
  if (
    headers.length < 2 ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !h)
  )
    throw new Error(
      "Use a CSV with one header row, unique nonblank column names, and comma separators. Summary pivot reports must first be exported as rows.",
    );
  if (!rows.length || rows.length > 2000)
    throw new Error("Import between 1 and 2,000 rows per file.");
  if (rows.some((r) => r.length !== headers.length))
    throw new Error(
      "A CSV row has a different number of cells than the header. Check quoting and separators.",
    );
  return {
    headers,
    records: rows.map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, r[i]])),
    ),
  };
}
export function detectSquare(text: string): SquareOptions {
  const { headers } = squareCsv(text);
  const columns: SquareOptions["columns"] = {};
  for (const field of squareFields) {
    const matches = headers.filter((h) =>
      aliases[field].includes(h.toLowerCase().trim()),
    );
    if (matches.length === 1) columns[field] = matches[0];
  }
  const hasId = columns.transactionId || columns.paymentId || columns.orderId;
  return {
    type:
      columns.item && columns.quantity && hasId
        ? "items"
        : hasId
          ? "transactions"
          : "summary",
    columns,
    currency: "USD",
    dateFormat: "MDY",
    timezone: "America/New_York",
    account: "My Square business",
    extrasGrain: "transaction",
    feesSign: "expense",
  };
}
export function squareMoney(raw: string): number | null {
  if (!raw.trim()) return null;
  let t = raw
    .trim()
    .replace(/\u2212/g, "-")
    .replace(/^-([$£€])/, "$1-");
  const parens = /^\(.*\)$/.test(t);
  if (parens) t = t.slice(1, -1);
  t = t
    .replace(/^(USD|CAD|AUD|GBP|EUR)\s*/i, "")
    .replace(/\s*(USD|CAD|AUD|GBP|EUR)$/i, "")
    .replace(/^[$£€]\s*/, "");
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(t))
    throw new Error(
      `Unsupported amount “${raw}”. Use decimal points and at most two decimal places.`,
    );
  const negative = t.startsWith("-") || parens;
  const [whole, fraction = ""] = t
    .replace("-", "")
    .replaceAll(",", "")
    .split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is too large.");
  return negative ? -cents : cents;
}
function reportingDate(
  raw: string,
  format: SquareOptions["dateFormat"],
  zone: string,
) {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
  let y: number, m: number, d: number;
  if (iso) {
    [, y, m, d] = iso.map(Number) as [number, number, number, number];
    if (/[T ]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
      const instant = new Date(raw);
      if (!Number.isFinite(instant.getTime()))
        throw new Error("Invalid timestamp.");
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(instant);
      const get = (k: string) => parts.find((p) => p.type === k)!.value;
      return `${get("year")}-${get("month")}-${get("day")}`;
    }
  } else {
    const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:$|[ T])/);
    if (!match || format === "ISO")
      throw new Error(
        "Date needs YYYY-MM-DD, or the selected MDY/DMY format with a four-digit year.",
      );
    y = +match[3];
    m = +(format === "DMY" ? match[2] : match[1]);
    d = +(format === "DMY" ? match[1] : match[2]);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    throw new Error("Invalid calendar date.");
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function parseSquare(text: string, options: SquareOptions) {
  const csv = squareCsv(text);
  const rows: SquareRow[] = [],
    errors: string[] = [],
    warnings: string[] = [];
  if (
    !["items", "transactions", "summary"].includes(options.type) ||
    !["MDY", "DMY", "ISO"].includes(options.dateFormat) ||
    !["item", "transaction"].includes(options.extrasGrain) ||
    (options.feesSign !== undefined &&
      !["expense", "deduction"].includes(options.feesSign))
  )
    throw new Error("Choose a report type, date format and amount grain.");
  if (!options.account?.trim() || options.account.length > 120)
    throw new Error(
      "Enter a stable name for this Square seller account. Reuse it for later imports.",
    );
  new Intl.DateTimeFormat("en-US", { timeZone: options.timezone }).format();
  if (!/^[A-Z]{3}$/.test(options.currency))
    throw new Error("Choose a three-letter currency code.");
  if (!options.columns.date || !options.columns.net)
    throw new Error(
      "Map Date and Net sales. Net sales is required so tax or payment totals are never guessed as revenue.",
    );
  if (
    options.type === "items" &&
    (!options.columns.item || !options.columns.quantity)
  )
    throw new Error("Item detail needs Item and Quantity columns.");
  const selected = Object.values(options.columns).filter(Boolean);
  if (
    new Set(selected).size !== selected.length ||
    selected.some((h) => !csv.headers.includes(h!))
  )
    throw new Error(
      "Map each source column to at most one field, using this file’s headers.",
    );
  csv.records.forEach((raw, index) => {
    try {
      const read = (key: SquareField) =>
        String(raw[options.columns[key] || ""] ?? "").trim();
      const currency = read("currency") || options.currency;
      if (!/^[A-Z]{3}$/.test(currency))
        throw new Error("Invalid currency code.");
      for (const field of monetary) {
        const declared = read(field).match(/\b[A-Z]{3}\b/g) || [];
        if (declared.some((code) => code !== currency))
          throw new Error(
            "Amount currency conflicts with the selected currency.",
          );
      }
      const amounts = Object.fromEntries(
        monetary.map((k) => [k, squareMoney(read(k))]),
      );
      if (amounts.net === null)
        throw new Error("Net sales is blank; it is unknown, not zero.");
      const quantity = read("quantity") ? Number(read("quantity")) : null;
      if (
        quantity !== null &&
        (!Number.isFinite(quantity) || Math.abs(quantity) > 1e9)
      )
        throw new Error("Invalid quantity.");
      if (options.type === "items" && quantity === null)
        throw new Error("Quantity is missing.");
      const row = {
        row: index + 2,
        raw,
        transactionId: read("transactionId"),
        paymentId: read("paymentId"),
        orderId: read("orderId"),
        lineId: read("lineId"),
        itemId: read("itemId"),
        variationId: read("variationId"),
        date: reportingDate(read("date"), options.dateFormat, options.timezone),
        time: read("time"),
        location: read("location"),
        item: read("item"),
        variation: read("variation"),
        sku: read("sku"),
        currency,
        quantity,
        amounts,
        mappingKey: "",
      };
      row.mappingKey = JSON.stringify([
        options.account.trim(),
        row.variationId
          ? "variation"
          : row.itemId
            ? "item"
            : row.sku
              ? "sku"
              : "name",
        row.variationId || row.itemId || row.sku || row.item,
        row.variationId ? "" : row.variation,
      ]);
      rows.push(row);
    } catch (e) {
      errors.push(`Row ${index + 2}: ${(e as Error).message}`);
    }
  });
  if (rows.some((r) => !r.transactionId && !r.paymentId && !r.orderId))
    warnings.push(
      "Some rows have no sale identifier. Repeated legitimate sales are retained; overlap detection cannot be guaranteed. Review date ranges before importing.",
    );
  if (options.type === "items" && rows.some((r) => !r.lineId))
    warnings.push(
      "Some items have no line-item ID. Items in this file stay separate; overlapping item reports for the same sale are blocked until the earlier import is undone.",
    );
  if (options.type === "summary")
    warnings.push(
      "Aggregate reporting only. These rows do not contain proven transactions and do not enter the sales ledger or product performance totals.",
    );
  const partial = monetary.filter(
    (field) =>
      options.columns[field] && rows.some((r) => r.amounts[field] === null),
  );
  if (partial.length)
    warnings.push(
      `Some mapped values are blank: ${partial.join(", ")}. Available subtotals are incomplete; unknown values are not confirmed zero.`,
    );
  warnings.push(
    "Net sales is preserved as exported, including any refund effect already present. Refunds and discounts are separate source disclosures, not subtracted a second time. Payment is not profit or a bank payout.",
  );
  return { ...csv, rows, errors, warnings };
}
export function suggestSquare(
  row: SquareRow,
  products: Item[],
  saved: Item[],
): { choice: SquareChoice; suggestion: string } {
  const mapping = saved.find((m) => m.id === row.mappingKey);
  if (mapping && products.some((p) => p.id === mapping.productId))
    return {
      choice: { productId: mapping.productId, multiplier: mapping.multiplier },
      suggestion: "Saved mapping",
    };
  const sku = row.sku ? products.filter((p) => p.sku === row.sku) : [];
  if (sku.length === 1)
    return {
      choice: { productId: sku[0].id, multiplier: 1 },
      suggestion: "Exact unique SKU; one Square unit = one sellable package",
    };
  const name = products.find((p) =>
    [row.item, `${row.item} — ${row.variation}`].some(
      (n) => n.toLowerCase() === p.name.toLowerCase(),
    ),
  );
  return {
    choice: { productId: "", multiplier: 1 },
    suggestion: name
      ? `Suggested: ${name.name}. Select it to approve.`
      : "Unmatched; retained in financial reporting",
  };
}
export function squareTotals(rows: SquareRow[]) {
  const currencies = [...new Set(rows.map((r) => r.currency))];
  return currencies.map((currency) => ({
    currency,
    values: Object.fromEntries(
      monetary.map((k) => {
        const known = rows.filter(
          (r) => r.currency === currency && r.amounts[k] !== null,
        );
        return [
          k,
          known.length ? known.reduce((a, r) => a + r.amounts[k]!, 0) : null,
        ];
      }),
    ),
  }));
}

/** Same provider identity graph for CSV today and read-only API contributions later. */
export function reconcileSquare(batches: SquareBatch[]) {
  const active = batches.filter(
    (b) => b.status === "committed" && b.options.type !== "summary",
  );
  const entries = active.flatMap((batch) =>
    batch.rows.map((row) => ({ batch, row })),
  );
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p) {
      parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const aliases = (b: SquareBatch, r: SquareRow) =>
    [
      ["order", r.orderId],
      ["transaction", r.transactionId],
      ["payment", r.paymentId],
    ]
      .filter(([, id]) => id)
      .map(([kind, id]) =>
        JSON.stringify([b.options.account.trim(), kind, id]),
      );
  for (const { batch, row } of entries) {
    const ids = aliases(batch, row);
    for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));
  }
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const ids = aliases(entry.batch, entry.row);
    const key = ids.length
      ? find(ids[0])
      : JSON.stringify([entry.batch.id, entry.row.row]);
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  const sales: Item[] = [];
  const warnings: string[] = [];
  let duplicates = 0;
  for (const [key, group] of groups) {
    const first = group[0].row;
    if (
      new Set(group.map((e) => e.row.paymentId).filter(Boolean)).size > 1 ||
      new Set(group.map((e) => e.row.transactionId).filter(Boolean)).size > 1
    )
      throw new Error(
        "This order contains multiple payments or transactions. Split-payment exports need reconciliation and are not supported by this importer yet.",
      );
    if (
      group.some(
        (e) =>
          e.row.currency !== first.currency ||
          e.row.date !== first.date ||
          e.row.location !== first.location,
      )
    )
      throw new Error(
        "The same Square sale has conflicting currency, reporting date or location. Review the source reports before importing.",
      );
    const tx = group.filter((e) => e.batch.options.type === "transactions");
    const items = group.filter((e) => e.batch.options.type === "items");
    const itemBatches = new Set(items.map((e) => e.batch.id));
    if (itemBatches.size > 1 && items.some((e) => !e.row.lineId))
      throw new Error(
        "Overlapping item reports include a sale without stable line-item IDs. Undo the earlier item import before replacing it; transaction reports can still complement it.",
      );
    const normalized = (entry: (typeof group)[number], field: string) => {
      const value = entry.row.amounts[field];
      return value != null &&
        field === "fees" &&
        entry.batch.options.feesSign === "deduction"
        ? -value
        : value;
    };
    const unique = new Map<string, (typeof group)[number]>();
    for (const e of items) {
      const id = e.row.lineId || `${e.batch.id}:${e.row.row}`;
      const previous = unique.get(id);
      if (previous) {
        const oldChoice = previous.batch.choices[previous.row.mappingKey],
          newChoice = e.batch.choices[e.row.mappingKey];
        const conflictingText = ["item", "variation", "sku"].some(
          (field) =>
            previous.row[field as "item"] &&
            e.row[field as "item"] &&
            previous.row[field as "item"] !== e.row[field as "item"],
        );
        const conflictingAmounts = monetary.some(
          (field) =>
            previous.row.amounts[field] != null &&
            e.row.amounts[field] != null &&
            normalized(previous, field) !== normalized(e, field),
        );
        if (
          previous.row.quantity !== e.row.quantity ||
          conflictingText ||
          conflictingAmounts ||
          (oldChoice?.productId &&
            newChoice?.productId &&
            (oldChoice.productId !== newChoice.productId ||
              oldChoice.multiplier !== newChoice.multiplier))
        )
          throw new Error(
            `Line ${id} changed between reports. Undo the prior contribution before importing a correction.`,
          );
        const selected = newChoice?.productId ? e : previous;
        unique.set(id, {
          ...selected,
          row: {
            ...selected.row,
            amounts: Object.fromEntries(
              monetary.map((field) => [
                field,
                field === "fees"
                  ? (normalized(previous, field) ?? normalized(e, field)) ===
                    null
                    ? null
                    : (normalized(previous, field) ?? normalized(e, field))! *
                      (selected.batch.options.feesSign === "deduction" ? -1 : 1)
                  : (previous.row.amounts[field] ?? e.row.amounts[field]),
              ]),
            ),
          },
        });
        duplicates++;
      } else unique.set(id, e);
    }
    const lines = [...unique.values()];
    const recorded = (e: (typeof group)[number], field: string) => {
      const value = e.row.amounts[field];
      return value != null &&
        field === "fees" &&
        e.batch.options.feesSign === "deduction"
        ? -value
        : value;
    };
    function once(field: string, source: typeof group): number | null {
      const values = [
        ...new Set(
          source.map((e) => recorded(e, field)).filter((v) => v !== null),
        ),
      ];
      if (values.length > 1)
        throw new Error(
          `The same sale has conflicting ${field} amounts. Split payments and changed exports need review; no amount was guessed.`,
        );
      return values[0] ?? null;
    }
    const txnNet = once("net", tx);
    if (tx.length > 1) duplicates += tx.length - 1;
    const itemNet = lines.reduce((a, e) => a + (e.row.amounts.net ?? 0), 0);
    const net = txnNet ?? itemNet;
    const own = (field: string) => {
      const declared = once(field, tx);
      if (declared !== null) return declared;
      const lineLevel = lines.filter(
        (e) => e.batch.options.extrasGrain === "item",
      );
      const orderLevel = lines.filter(
        (e) => e.batch.options.extrasGrain === "transaction",
      );
      if (lineLevel.length && orderLevel.length)
        throw new Error(
          "Overlapping item reports disagree on amount grain. Use a consistent item/transaction setting.",
        );
      if (lineLevel.length) {
        const known = lineLevel.filter((e) => e.row.amounts[field] !== null);
        return known.length
          ? known.reduce((a, e) => a + recorded(e, field)!, 0)
          : null;
      }
      return once(field, orderLevel);
    };
    if (txnNet !== null && lines.length && txnNet !== itemNet)
      warnings.push(
        `Sale ${first.transactionId || first.orderId || first.paymentId}: transaction net differs from item net by ${(txnNet - itemNet) / 100} ${first.currency}. The difference is unallocated, not distributed to products.`,
      );
    const provenance = group.map((e) => ({
      batchId: e.batch.id,
      row: e.row.row,
    }));
    const common = {
      externalSource: "square",
      sourceKey: key,
      channel: "Square import",
      date: first.date,
      currency: first.currency,
      location: first.location,
      provenance,
      costSource: "unavailable",
      inventoryMode: "reporting_only",
    };
    for (const [id, e] of unique) {
      const choice = e.batch.choices[e.row.mappingKey];
      sales.push({
        id: JSON.stringify(["square", key, "line", id]),
        name:
          [e.row.item, e.row.variation].filter(Boolean).join(" — ") ||
          "Unmatched Square item",
        ...common,
        productId: choice?.productId || undefined,
        quantity:
          e.row.quantity === null
            ? 0
            : e.row.quantity * (choice?.multiplier || 1),
        amount: (e.row.amounts.net ?? 0) / 100,
        sourceAmounts: e.row.amounts,
        sourceQuantity: e.row.quantity,
        packageMultiplier: choice?.multiplier || 1,
        grain: "item",
      });
    }
    const amount = (net - itemNet) / 100;
    const extras = Object.fromEntries(
      ["tax", "tips", "fees", "serviceCharges"].map((field) => [
        field,
        own(field),
      ]),
    );
    sales.push({
      id: JSON.stringify(["square", key, "sale"]),
      name: lines.length
        ? "Square sale · unallocated amounts"
        : "Square sale · no item detail",
      ...common,
      quantity: 0,
      amount,
      grain: "transaction",
      ...Object.fromEntries(
        Object.entries(extras).map(([k, v]) => [
          k,
          v === null ? null : v / 100,
        ]),
      ),
      sourceAmounts: {
        net: txnNet,
        gross: once("gross", tx),
        discounts: once("discounts", tx),
        refunds: once("refunds", tx),
        payment: once("payment", tx) ?? once("payment", lines),
        ...extras,
      },
    });
  }
  return {
    sales,
    warnings,
    duplicates,
    transactions: groups.size,
    itemRows: sales.filter((s) => s.grain === "item").length,
  };
}

export function squareReportTotals(
  batch: SquareBatch,
  choices = batch.choices,
) {
  if (batch.options.type === "summary") return squareTotals(batch.rows);
  const result = reconcileSquare([{ ...batch, choices, status: "committed" }]);
  return [...new Set(batch.rows.map((r) => r.currency))].map((currency) => {
    const sales = result.sales.filter((s) => s.currency === currency),
      heads = sales.filter((s) => s.grain === "transaction"),
      lines = sales.filter((s) => s.grain === "item");
    const sum = (values: (number | null | undefined)[]) => {
      const known = values.filter((v): v is number => v != null);
      return known.length ? known.reduce((a, v) => a + v, 0) : null;
    };
    return {
      currency,
      values: Object.fromEntries(
        monetary.map((field) => {
          if (field === "net")
            return [
              field,
              Math.round(sales.reduce((a, s) => a + s.amount, 0) * 100),
            ];
          if (["gross", "discounts", "refunds"].includes(field))
            return [
              field,
              sum(heads.map((h) => h.sourceAmounts[field])) ??
                sum(lines.map((l) => l.sourceAmounts[field])),
            ];
          return [field, sum(heads.map((h) => h.sourceAmounts[field]))];
        }),
      ),
    };
  });
}

// Read-only draft projection shared by review fixtures and connection previews.
export function squareDraft(
  csv: string,
  filename: string,
  options: SquareOptions,
  products: Item[],
  mappings: Item[],
): SquareBatch {
  const parsed = parseSquare(csv, options);
  return {
    id: "draft",
    fingerprint: "unsaved",
    name: filename,
    provider: "square",
    status: "staged",
    options,
    rows: parsed.rows,
    errors: parsed.errors,
    warnings: parsed.warnings,
    choices: Object.fromEntries(
      parsed.rows.map((row) => [
        row.mappingKey,
        suggestSquare(row, products, mappings).choice,
      ]),
    ),
  };
}
