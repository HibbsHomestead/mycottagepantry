import { verifySquareReview, saveSeller } from "./square-seller";
import { createHash, randomUUID } from "node:crypto";
import type { Item, Workspace } from "../../src/lib/domain";
import {
  parseSquare,
  reconcileSquare,
  suggestSquare,
  type SquareBatch,
  type SquareChoice,
  type SquareOptions,
} from "../../src/lib/square-sales";
export async function squareSalesAction(
  action: string,
  data: any,
  ctx: {
    state: Workspace;
    actor: string;
    org: string;
    client: any;
    save: (table: string, item: Item) => Promise<void>;
    audit: (name: string, detail: string) => Promise<void>;
  },
) {
  if (action === "squareApiImport") {
    if (
      data.confirm !== true ||
      !["sandbox", "production"].includes(data.environment)
    )
      throw new Error("Confirm the reviewed Square import.");
    const review = verifySquareReview(
      String(data.proof || ""),
      data.environment,
      ctx.org,
    );
    if (review.actor !== ctx.actor)
      throw new Error("Square review belongs to another user.");
    const connection = (
      await ctx.client.query(
        "SELECT data FROM square_seller_connections WHERE business_id=$1 AND environment=$2",
        [ctx.org, data.environment],
      )
    ).rows[0]?.data;
    if (
      !connection?.credential ||
      connection.merchantId !== review.options.account
    )
      throw new Error("Square connection changed. Retrieve the sample again.");
    const id =
      "square-" + createHash("sha256").update(review.csv).digest("hex");
    if (
      ctx.state.sales_imports?.some(
        (b) => b.id === id && b.status === "committed",
      )
    )
      return;
    let staged: Item | undefined;
    await squareSalesAction(
      "squareStage",
      {
        csv: review.csv,
        filename: "Square reviewed API sample.csv",
        options: review.options,
      },
      {
        ...ctx,
        save: async (table, item) => {
          await ctx.save(table, item);
          if (table === "sales_imports") staged = item;
        },
      },
    );
    const state = {
      ...ctx.state,
      sales_imports: [
        ...(ctx.state.sales_imports || []).filter((b) => b.id !== id),
        staged!,
      ],
    };
    await squareSalesAction(
      "squareReview",
      { id, choices: staged!.choices },
      { ...ctx, state },
    );
    await squareSalesAction(
      "squareCommit",
      { id, confirm: true, acknowledge: true, choices: staged!.choices },
      { ...ctx, state },
    );
    connection.lastSuccessfulSync = new Date().toISOString();
    await saveSeller(ctx.client, ctx.org, data.environment, connection);
    return;
  }
  const { state, save, audit } = ctx;
  const batches = (state.sales_imports || []) as SquareBatch[];
  const stamp = new Date().toISOString();
  if (action === "squareStage") {
    if (
      typeof data.csv !== "string" ||
      typeof data.filename !== "string" ||
      data.filename.length > 240
    )
      throw new Error(
        "Choose a CSV file with a filename up to 240 characters.",
      );
    const fingerprint = createHash("sha256").update(data.csv).digest("hex");
    const id = `square-${fingerprint}`;
    const previous = batches.find((b) => b.id === id);
    if (previous?.status === "committed")
      throw new Error(
        "This exact file is already imported. Open its import history instead.",
      );
    const options: SquareOptions = {
      ...data.options,
      account: String(data.options?.account || "").trim(),
    };
    const parsed = parseSquare(data.csv, options);
    const choices: Record<string, SquareChoice> = {};
    for (const row of parsed.rows)
      choices[row.mappingKey] = suggestSquare(
        row,
        state.products,
        state.sales_product_mappings || [],
      ).choice;
    await save("sales_imports", {
      id,
      name: data.filename,
      provider: "square",
      fingerprint,
      status: "staged",
      options,
      sourceHeaders: parsed.headers,
      sourceRows: parsed.records,
      rows: parsed.rows,
      errors: parsed.errors,
      warnings: parsed.warnings,
      choices,
      stagedAt: stamp,
      actor: ctx.actor,
      history: [
        ...(previous?.history || []),
        { action: "staged", at: stamp, actor: ctx.actor },
      ],
    });
    await audit(
      "Square CSV staged",
      `${id}; ${parsed.rows.length} valid rows; ${parsed.errors.length} excluded rows. No sales posted.`,
    );
    return;
  }
  const batch = batches.find((b) => b.id === data.id);
  if (!batch) throw new Error("Import is unavailable in this bakery.");
  if (action === "squareUndo") {
    if (data.confirm !== true)
      throw new Error(
        "Confirm Undo import. Only this import’s contributions are reversed.",
      );
    if (batch.status === "reversed") return;
    if (batch.status !== "committed")
      throw new Error("Only a committed import can be undone.");
    batch.status = "reversed";
    batch.reversedAt = stamp;
    batch.history = [
      ...(batch.history || []),
      { action: "reversed", at: stamp, actor: ctx.actor },
    ];
  } else {
    if (batch.status === "committed") return; // retry-safe under the existing business row lock
    if (batch.status !== "staged")
      throw new Error("Stage this file again before importing.");
    const choices: Record<string, SquareChoice> = {};
    for (const key of new Set(batch.rows.map((r) => r.mappingKey))) {
      const c = data.choices?.[key] ||
        batch.choices[key] || { productId: "", multiplier: 1 };
      if (c.productId && !state.products.some((p) => p.id === c.productId))
        throw new Error("A selected product is unavailable in this bakery.");
      if (
        typeof c.multiplier !== "number" ||
        !Number.isFinite(c.multiplier) ||
        c.multiplier <= 0 ||
        c.multiplier > 1000000
      )
        throw new Error("Enter an explicit positive package conversion.");
      choices[key] = {
        productId: c.productId || "",
        multiplier: c.multiplier,
        save: c.save === true,
      };
    }
    batch.choices = choices;
    const overlaps = batches.filter(
      (b) =>
        b.id !== batch.id &&
        b.status === "committed" &&
        b.options.account === batch.options.account &&
        b.rows.some((r) => {
          const old = b.rows
            .filter(
              (n) => n.currency === r.currency && n.location === r.location,
            )
            .map((n) => n.date)
            .sort();
          const next = batch.rows
            .filter(
              (n) => n.currency === r.currency && n.location === r.location,
            )
            .map((n) => n.date)
            .sort();
          return (
            next.length && old[0] <= next.at(-1)! && next[0] <= old.at(-1)!
          );
        }),
    );
    const dates = batch.rows.map((r) => r.date).sort();
    const manual = state.sales.filter(
      (s) => !s.externalSource && s.date >= dates[0] && s.date <= dates.at(-1)!,
    );
    const reviewWarnings = [
      ...(manual.length
        ? [
            `${manual.length} manual sale records fall in this reporting period. They are not automatically deduplicated against Square; review them before importing.`,
          ]
        : []),
      ...batch.warnings,
      ...(overlaps.length
        ? [
            "Reporting dates overlap an earlier import. Only stable source IDs guarantee de-duplication.",
          ]
        : []),
    ];
    const signature = createHash("sha256")
      .update(
        JSON.stringify(
          batches
            .filter((b) => b.id !== batch.id)
            .map((b) => [b.id, b.status, b.importedAt, b.reversedAt]),
        ),
      )
      .digest("hex");
    const preview = reconcileSquare([
      ...batches.filter((b) => b.id !== batch.id),
      { ...batch, status: "committed" },
    ]);
    if (action === "squareReview") {
      const prior = reconcileSquare(batches.filter((b) => b.id !== batch.id));
      batch.reviewImpact = [...new Set(batch.rows.map((r) => r.currency))].map(
        (currency) => {
          const total = (sales: Item[]) =>
            Math.round(
              sales
                .filter((s) => s.currency === currency)
                .reduce((a, s) => a + s.amount, 0) * 100,
            );
          return {
            currency,
            before: total(prior.sales),
            after: total(preview.sales),
            change: total(preview.sales) - total(prior.sales),
          };
        },
      );
      batch.warnings = [...new Set([...reviewWarnings, ...preview.warnings])];
      batch.reviewedAt = stamp;
      batch.duplicates = preview.duplicates;
      batch.reviewSignature = signature;
      batch.reviewChoices = JSON.stringify(choices);
      await save("sales_imports", batch);
      return;
    }
    if (action !== "squareCommit" || data.confirm !== true)
      throw new Error("Review, then explicitly confirm Import sales.");
    if (batch.reviewSignature !== signature)
      throw new Error(
        "Import history changed after this review. Review again before importing.",
      );
    if (batch.reviewChoices !== JSON.stringify(choices))
      throw new Error("Review the current product mappings before importing.");
    if (
      (reviewWarnings.length || batch.errors.length) &&
      data.acknowledge !== true
    )
      throw new Error(
        "Acknowledge warnings, overlap risk and excluded rows before importing.",
      );
    const reportingCurrency = state.settings[0]?.currency || "USD";
    if (
      batch.options.type !== "summary" &&
      batch.rows.some((r) => r.currency !== reportingCurrency)
    )
      throw new Error(
        `This bakery reports in ${reportingCurrency}. Split other currencies into a separate file; currency conversion is not supported.`,
      );
    if (!batch.rows.length)
      throw new Error("There are no valid rows to import.");
    batch.status = "committed";
    batch.importedAt = stamp;
    batch.importedBy = ctx.actor;
    batch.warnings = [...new Set([...reviewWarnings, ...preview.warnings])];
    batch.history = [
      ...(batch.history || []),
      { action: "committed", at: stamp, actor: ctx.actor },
    ];
    for (const [key, c] of Object.entries(choices))
      if (c.save && c.productId)
        await save("sales_product_mappings", {
          id: key,
          name: key,
          provider: "square",
          account: batch.options.account,
          productId: c.productId,
          multiplier: c.multiplier,
          updatedBy: ctx.actor,
        });
  }
  await save("sales_imports", batch);
  // Sales are immutable. Append only the difference from the current external
  // projection; undo and enrichment never update/delete a sale or manual entry.
  const projection = reconcileSquare([
    ...batches.filter((b) => b.id !== batch.id),
    batch,
  ]);
  const moneyFields = ["amount", "tax", "tips", "fees", "serviceCharges"];
  const key = (row: Item) =>
    JSON.stringify([row.projectionKey || row.id, row.productId || ""]);
  const previous = new Map<string, Item>();
  for (const row of state.sales.filter((s) => s.externalSource === "square")) {
    const k = key(row),
      total = previous.get(k);
    if (!total) previous.set(k, { ...row });
    else {
      for (const field of [...moneyFields, "quantity"])
        if (row[field] != null)
          total[field] =
            Math.round(((total[field] || 0) + row[field]) * 1e8) / 1e8;
    }
  }
  const desired = new Map(projection.sales.map((row) => [key(row), row]));
  for (const k of new Set([...previous.keys(), ...desired.keys()])) {
    const before = previous.get(k),
      after = desired.get(k),
      delta: Item = {
        ...(after || before!),
        id: randomUUID(),
        name: after?.name || `Square import reversal · ${before!.name}`,
        projectionKey: after?.id || before!.projectionKey,
        adjustedByImport: batch.id,
        adjustedAt: stamp,
      };
    let changed = false;
    for (const field of [...moneyFields, "quantity"]) {
      const old = before?.[field],
        next = after?.[field];
      delta[field] =
        old == null && next == null
          ? null
          : Math.round(((next || 0) - (old || 0)) * 1e8) / 1e8;
      if (
        delta[field] !== null &&
        (delta[field] !== 0 || (old == null && next != null))
      )
        changed = true;
    }
    if (changed) await save("sales", delta);
  }
  await audit(
    action === "squareUndo"
      ? "Square import reversed"
      : "Square sales imported",
    `${batch.id}; reporting only; no inventory, prices, costs, bank payouts or journals changed.`,
  );
}
