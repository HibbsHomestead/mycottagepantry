import { convert, number, csv, type Item, type Workspace } from './domain'
import { barcodeMatches, barcodeText } from './barcodes'
import { countQuantity } from './inventory-count'
import { inventoryAdjustmentPlan } from './inventory-adjustment'
import { openingStockEntry } from './ingredient-opening-stock'
import { ovenToday, ovenTimezone } from './oven-dates'

// Match the existing numeric(20,8) stock columns while retaining entered-unit evidence.
function canonicalQuantity(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e12)
    throw new Error('Quantity exceeds supported stock precision.')
  const rounded = Number(value.toFixed(8))
  if (value !== 0 && rounded === 0)
    throw new Error(
      'Quantity is below supported stock precision; use a compatible larger amount.',
    )
  return rounded
}
export const countPresets = [
  'Quarterly',
  'Annual',
  'Monthly',
  'Spot/custom',
]
export const countableItems = (w: Workspace) =>
  w.ingredients.filter(
    (i) => i.trackInventory !== false && !i.compoundRecipeId,
  )
export function packageOptions(item: Item): Item[] {
  const saved = (item.countPackages || []).filter(
    (p: Item) => p.active !== false,
  )
  const legacy = [
    ...(item.barcode
      ? [{ ...item, id: 'default', barcodes: [item.barcode] }]
      : []),
    ...(item.purchaseOffers || [])
      .filter((p: Item) => p.active !== false)
      .map((p: Item) => ({
        ...p,
        id: 'offer-' + p.id,
        barcodes: [p.barcode].filter(Boolean),
      })),
  ].map((p) => {
    let stockQuantity: number | null = null
    try {
      if (p.amountPerPackage != null && Number(p.amountPerPackage) > 0)
        stockQuantity = countQuantity(
          p.amountPerPackage,
          item.storageUnit || item.unit,
          item,
        )
      else if (p.purchaseQuantity != null && Number(p.purchaseQuantity) > 0)
        stockQuantity = countQuantity(
          p.purchaseQuantity,
          p.purchaseUnit,
          item,
        )
    } catch {
      /* Legacy package remains visible but cannot contribute stock. */
    }
    return {
      id: p.id,
      name: p.name || 'Saved purchase package',
      brand: p.brand,
      vendor: p.vendor,
      barcodes: p.barcodes,
      quantity: p.amountPerPackage || p.purchaseQuantity,
      unit: p.amountPerPackage
        ? item.storageUnit || item.unit
        : p.purchaseUnit,
      stockQuantity,
      verified: stockQuantity != null,
    }
  })
  // A confirmed assignment can complete an unconfigured legacy barcode on this same item.
  // Distinct verified packages remain ambiguous and require an explicit choice.
  return [
    ...saved,
    ...legacy.filter(
      (p) =>
        p.verified ||
        !saved.some((s: Item) =>
          p.barcodes.some((code: string) => s.barcodes.includes(code)),
        ),
    ),
  ]
}
export function countMatches(w: Workspace, raw: string) {
  const code = barcodeText(raw)
  const matches: { item: Item; package: Item }[] = []
  for (const item of countableItems(w))
    for (const p of packageOptions(item)) {
      if (
        (p.barcodes || []).some(
          (barcode: string) =>
            barcodeMatches([{ id: 'p', name: 'p', barcode }], code).length,
        )
      )
        matches.push({ item, package: p })
    }
  return matches
}
export function verifiedPackage(
  item: Item,
  data: Record<string, unknown>,
): Item {
  if (data.verified !== true)
    throw new Error('Confirm the package contents and conversion.')
  const quantity = number(data.quantity, 'Package contents', 0.00000001)
  const stockQuantity = canonicalQuantity(
    countQuantity(quantity, String(data.unit || ''), item),
  )
  if (!(stockQuantity > 0))
    throw new Error('Package contents must be positive.')
  const barcodes = [
    ...new Set(
      (Array.isArray(data.barcodes) ? data.barcodes : []).map(barcodeText),
    ),
  ] as string[]
  if (!barcodes.length || barcodes.length > 20)
    throw new Error('Use 1–20 barcode strings for this package.')
  const name = String(data.name || '')
    .trim()
    .slice(0, 160)
  if (!name) throw new Error('Enter a package description.')
  return {
    id: String(data.packageId || ''),
    name,
    barcodes,
    quantity,
    unit: data.unit,
    stockQuantity,
    stockUnit: item.unit,
    verified: true,
    active: true,
    brand: String(data.brand || '').slice(0, 120),
    vendor: String(data.vendor || '').slice(0, 120),
  }
}
export function activeCountEvents(session: Item): Item[] {
  const removed = new Set(
    (session.events || [])
      .filter((e: Item) => e.kind === 'undo')
      .map((e: Item) => e.target),
  )
  const events = (session.events || []).filter(
    (e: Item) => !removed.has(e.id),
  ) as Item[]
  const replaced = new Set(events.map((e) => e.replaces).filter(Boolean))
  return events.filter(
    (e) =>
      !replaced.has(e.id) &&
      !['undo', 'resolve', 'recount'].includes(e.kind),
  )
}
export function countEvidence(session: Item) {
  const active = activeCountEvents(session)
  const resolutions = (session.events || []).filter(
    (e: Item) => e.kind === 'resolve',
  ) as Item[]
  const resolved = active.map((e) => {
    if (e.kind !== 'unknown') return e
    const r = resolutions.find((r) => r.targets.includes(e.id))
    return r
      ? {
          ...e,
          ingredientId: r.ingredientId,
          quantity: r.quantity,
          package: r.package,
          kind: 'scan',
        }
      : e
  })
  const lines: Item[] = []
  for (const baseline of session.scope || []) {
    const reset = [...(session.events || [])]
      .reverse()
      .find(
        (e: Item) =>
          e.kind === 'recount' && e.ingredientId === baseline.ingredientId,
      )
    const start = reset
      ? session.events.findIndex((e: Item) => e.id === reset.id)
      : -1
    const evidence = resolved.filter(
      (e) =>
        e.ingredientId === baseline.ingredientId &&
        session.events.findIndex((r: Item) => r.id === e.id) > start,
    )
    if (!evidence.length) continue
    const b = reset?.baseline || baseline
    const countedQuantity = canonicalQuantity(
      evidence.reduce((n, e) => n + e.quantity, 0),
    )
    if (!Number.isFinite(countedQuantity))
      throw new Error('Count quantity is too large.')
    lines.push({
      ...b,
      id: b.ingredientId,
      name: b.name,
      countedQuantity,
      countedAt: evidence[evidence.length - 1].at,
      evidence,
      note: evidence
        .map((e) => e.note)
        .filter(Boolean)
        .join('; '),
      openingValue: [...evidence]
        .reverse()
        .find((e) => e.openingValue != null)?.openingValue,
    })
  }
  return {
    lines,
    unresolved: resolved.filter((e) => e.kind === 'unknown'),
    uncounted: (session.scope || []).filter(
      (b: Item) => !lines.some((l) => l.ingredientId === b.ingredientId),
    ),
  }
}
export function countSummary(session: Item) {
  const { lines, unresolved, uncounted } =
    session.status === 'completed' && session.report
      ? session.report
      : countEvidence(session)
  const difference = (l: Item) => l.countedQuantity - l.systemQuantity
  return {
    lines,
    unresolved,
    uncounted,
    counted: lines.length,
    matches: lines.filter((l: Item) => Math.abs(difference(l)) < 1e-9)
      .length,
    shortages: lines.filter((l: Item) => difference(l) < -1e-9).length,
    overages: lines.filter((l: Item) => difference(l) > 1e-9).length,
  }
}
export type CountEffect = { table: string; item: Item }
export type CountContext = {
  actor: string
  role: string
  now: string
  businessName: string
  revision: (item: Item) => string
}
const idText = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new Error('A valid operation ID is required.')
  return value
}
const eligible = (w: Workspace, id: string) => {
  const item = countableItems(w).find((i) => i.id === id)
  if (!item) throw new Error('Tracked item unavailable in this business.')
  return item
}
function baseline(item: Item, ctx: CountContext) {
  if (
    item.quantity == null ||
    item.quantity === '' ||
    !Number.isFinite(Number(item.quantity))
  )
    throw new Error('Stock balance unavailable. Review the item first.')
  return {
    ingredientId: item.id,
    name: item.name,
    unit: item.unit,
    displayUnit: item.storageUnit || item.unit,
    displayFactor: convert(
      1,
      item.unit,
      item.storageUnit || item.unit,
      item.conversions,
    ),
    systemQuantity: Number(item.quantity),
    inventoryRevision: ctx.revision(item),
    baselineAt: ctx.now,
    usedAs: item.usedAs || 'ingredient',
  }
}
/** Pure validated command. The API executes every returned write in its existing locked transaction. */
export function rapidCountCommand(
  w: Workspace,
  input: Record<string, unknown>,
  ctx: CountContext,
): CountEffect[] {
  if (!['Owner', 'Manager', 'Production Staff'].includes(ctx.role))
    throw new Error('Your role cannot count stock.')
  const data = input || {},
    id = idText(data.id),
    effects: CountEffect[] = []
  const appliedDate = ovenToday(w.settings[0], new Date(ctx.now))
  const save = (table: string, item: Item) => effects.push({ table, item })
  const existing = (w.inventory_counts || []).find((s) => s.id === id)
  const op = String(data.op)
  if (op === 'start') {
    if (id.length > 60)
      throw new Error('Count ID must be at most 60 characters.')
    if (existing) {
      if (existing.ownerId !== ctx.actor)
        throw new Error('Count belongs to another counter.')
      return []
    }
    const scopeIds = data.scopeIds
    if (
      !Array.isArray(scopeIds) ||
      !scopeIds.length ||
      scopeIds.length > 2000 ||
      new Set(scopeIds).size !== scopeIds.length
    )
      throw new Error(
        'Choose 1–2000 tracked inventory items. The rest of your catalog can be set up later.',
      )
    if (!['opening', 'periodic'].includes(String(data.type)))
      throw new Error('Choose opening or periodic inventory.')
    if (
      data.type === 'periodic' &&
      !countPresets.includes(String(data.preset))
    )
      throw new Error('Choose a periodic preset.')
    if (
      data.correctionOf &&
      !(w.inventory_counts || []).some(
        (s) => s.id === data.correctionOf && s.status === 'completed',
      )
    )
      throw new Error(
        'Choose an applied count from this business as the correction source.',
      )
    const countAt = String(data.countAt || ctx.now)
    if (
      !Number.isFinite(Date.parse(countAt)) ||
      Date.parse(countAt) > Date.parse(ctx.now) + 60000
    )
      throw new Error('Choose a valid count timestamp, no later than now.')
    const name = String(data.name || '')
      .trim()
      .slice(0, 160)
    if (!name) throw new Error('Name this count.')
    save('inventory_counts', {
      id,
      name,
      version: 2,
      status: 'draft',
      revision: 0,
      type: data.type,
      preset: data.preset,
      scope: scopeIds.map((id: string) => baseline(eligible(w, id), ctx)),
      lines: [],
      events: [],
      operations: [],
      operationFingerprints: {},
      ownerId: ctx.actor,
      counter: ctx.actor,
      businessName: ctx.businessName,
      timezone: ovenTimezone(w.settings[0]),
      date: ovenToday(w.settings[0], new Date(countAt)),
      countAt,
      startedAt: ctx.now,
      correctionOf: data.correctionOf || null,
      notes: String(data.notes || '').slice(0, 2000),
    })
    return effects
  }
  if (!existing || existing.version !== 2)
    throw new Error('Rapid count session unavailable.')
  if (existing.status === 'completed' && op === 'apply') return []
  const operationId = idText(data.operationId)
  const fingerprint = JSON.stringify(
    [
      'op',
      'barcode',
      'ingredientId',
      'packageId',
      'name',
      'brand',
      'vendor',
      'quantity',
      'unit',
      'verified',
      'additionalBarcodes',
      'active',
      'openingValue',
      'note',
      'replaces',
      'partial',
      'confirm',
      'existingStockReviewed',
    ].map((key) => [key, data[key] ?? null]),
  )
  if ((existing.operations || []).includes(operationId)) {
    if (
      existing.operationFingerprints?.[operationId] &&
      existing.operationFingerprints[operationId] !== fingerprint
    )
      throw new Error(
        'Operation ID was already used for different count evidence.',
      )
    return []
  }
  if (['completed', 'cancelled'].includes(existing.status))
    throw new Error(
      'This count is immutable. Start a linked correction count instead.',
    )
  if (existing.ownerId !== ctx.actor && op !== 'takeover')
    throw new Error(
      'Another counter owns this draft. An Owner or Manager can take ownership explicitly.',
    )
  if (data.revision !== existing.revision)
    throw new Error(
      'Count changed in another tab. Refresh before retrying; no updates were applied.',
    )
  const session = structuredClone(existing)
  if (
    (session.operations || []).length >= 10000 &&
    !['review', 'apply', 'cancel', 'takeover'].includes(op)
  )
    throw new Error(
      'This count reached its event limit. Finish it and start another count.',
    )
  if (
    session.events.length >= 5000 &&
    [
      'scan',
      'unknown',
      'manual',
      'partial',
      'assign',
      'resolve',
      'recount',
      'valuation',
    ].includes(op)
  )
    throw new Error(
      'This count reached 5000 events. Apply or cancel it before starting another count.',
    )
  const append = (event: Record<string, unknown>) =>
    session.events.push({
      ...event,
      id: operationId,
      at: ctx.now,
      actor: ctx.actor,
    })
  const scoped = (itemId: string) => {
    eligible(w, itemId)
    if (!session.scope.some((b: Item) => b.ingredientId === itemId))
      throw new Error(
        'Item is outside this count scope. Add it explicitly first.',
      )
    return eligible(w, itemId)
  }
  const packageFor = (item: Item, pid: string) => {
    const p = packageOptions(item).find((p) => p.id === pid)
    if (
      !p ||
      !p.verified ||
      !(p.stockQuantity > 0) ||
      (p.stockUnit && p.stockUnit !== item.unit)
    )
      throw new Error(
        'This barcode package needs verified contents before counting.',
      )
    // Recalculate saved package conversions; never rely on client amounts.
    const q = canonicalQuantity(countQuantity(p.quantity, p.unit, item))
    if (!(q > 0)) throw new Error('Package conversion unavailable.')
    return { ...p, stockQuantity: q }
  }
  if (op === 'takeover') {
    if (!['Owner', 'Manager'].includes(ctx.role) || data.confirm !== true)
      throw new Error(
        'An Owner or Manager must confirm ownership transfer.',
      )
    session.ownerId = ctx.actor
    session.ownershipHistory = [
      ...(session.ownershipHistory || []),
      { from: existing.ownerId, to: ctx.actor, at: ctx.now },
    ]
  } else if (op === 'cancel') {
    session.status = 'cancelled'
    session.cancelledAt = ctx.now
  } else if (op === 'addScope') {
    const item = eligible(w, String(data.ingredientId || ''))
    if (session.scope.length >= 2000)
      throw new Error('This count already contains 2000 scoped items.')
    if (!session.scope.some((b: Item) => b.ingredientId === item.id))
      session.scope.push(baseline(item, ctx))
    session.status = 'draft'
  } else if (op === 'scan' || op === 'unknown') {
    if (session.status !== 'draft')
      throw new Error('Return to counting before scanning.')
    const code = barcodeText(data.barcode)
    if (op === 'unknown') append({ kind: 'unknown', barcode: code })
    else {
      const item = scoped(String(data.ingredientId || '')),
        p = packageFor(item, String(data.packageId || ''))
      if (
        !countMatches(w, code).some(
          (m) => m.item.id === item.id && m.package.id === p.id,
        )
      )
        throw new Error('Barcode does not match this package.')
      append({
        kind: 'scan',
        barcode: code,
        ingredientId: item.id,
        package: p,
        quantity: p.stockQuantity,
      })
    }
  } else if (op === 'resolve') {
    const item = scoped(String(data.ingredientId || '')),
      p = packageFor(item, String(data.packageId || '')),
      code = barcodeText(data.barcode)
    if (
      !countMatches(w, code).some(
        (m) => m.item.id === item.id && m.package.id === p.id,
      )
    )
      throw new Error('Choose a matching package.')
    const targets = countEvidence(session)
      .unresolved.filter((e) => e.barcode === code)
      .map((e) => e.id)
    if (!targets.length)
      throw new Error('No unresolved occurrences remain.')
    append({
      kind: 'resolve',
      targets,
      ingredientId: item.id,
      package: p,
      quantity: p.stockQuantity,
      barcode: code,
    })
  } else if (op === 'packageStatus') {
    if (!['Owner', 'Manager'].includes(ctx.role))
      throw new Error('An Owner or Manager must manage packages.')
    const item = scoped(String(data.ingredientId || ''))
    if (
      typeof data.active !== 'boolean' ||
      !(item.countPackages || []).some((p: Item) => p.id === data.packageId)
    )
      throw new Error('Choose a saved package and status.')
    save('ingredients', {
      ...item,
      countPackages: item.countPackages.map((p: Item) =>
        p.id === data.packageId ? { ...p, active: data.active } : p,
      ),
    })
  } else if (op === 'valuation') {
    scoped(String(data.ingredientId || ''))
    if (
      session.type !== 'opening' ||
      !countEvidence(session).lines.some(
        (l) => l.ingredientId === data.ingredientId,
      )
    )
      throw new Error(
        'Count the opening item before confirming its valuation.',
      )
    if (data.openingValue === '' || data.openingValue == null)
      throw new Error(
        'Enter a confirmed opening value, including explicit zero if appropriate.',
      )
    append({
      kind: 'manual',
      ingredientId: data.ingredientId,
      quantity: 0,
      openingValue: number(data.openingValue, 'Opening value'),
      note: 'Confirmed total opening valuation only',
    })
  } else if (op === 'assign') {
    if (!['Owner', 'Manager'].includes(ctx.role))
      throw new Error('An Owner or Manager must assign packages.')
    const item = scoped(String(data.ingredientId || ''))
    const code = barcodeText(data.barcode)
    const p = verifiedPackage(item, {
      ...data,
      barcodes: [
        code,
        ...(Array.isArray(data.additionalBarcodes)
          ? data.additionalBarcodes
          : []),
      ],
      packageId: operationId,
    })
    if ((item.countPackages || []).length >= 100)
      throw new Error('Use up to 100 count packages per item.')
    save('ingredients', {
      ...item,
      countPackages: [...(item.countPackages || []), p],
    })
    const targets = countEvidence(session)
      .unresolved.filter((e) => e.barcode === code)
      .map((e) => e.id)
    if (!targets.length)
      throw new Error('Queue this barcode before assignment.')
    append({
      kind: 'resolve',
      targets,
      ingredientId: item.id,
      package: p,
      quantity: p.stockQuantity,
      barcode: code,
    })
  } else if (op === 'manual' || op === 'partial' || op === 'recount') {
    const item = scoped(String(data.ingredientId || ''))
    if (op === 'recount') {
      session.events.push({
        id: operationId + '-reset',
        kind: 'recount',
        ingredientId: item.id,
        baseline: baseline(item, ctx),
        at: ctx.now,
        actor: ctx.actor,
      })
    }
    const quantity = canonicalQuantity(
      countQuantity(data.quantity, String(data.unit || ''), item),
    )
    let replaces: string | undefined
    if (op === 'partial' && data.replaces) {
      const target = countEvidence(session)
        .lines.flatMap((l) => l.evidence)
        .find(
          (e: Item) =>
            e.id === data.replaces &&
            e.ingredientId === item.id &&
            e.kind === 'scan',
        )
      if (!target)
        throw new Error(
          'Choose an active full scan to replace, or add a separate partial package.',
        )
      replaces = target.id
    }
    const openingValue =
      data.openingValue === '' || data.openingValue == null
        ? undefined
        : number(data.openingValue, 'Opening valuation')
    append({
      kind: op === 'recount' ? 'manual' : op,
      ingredientId: item.id,
      quantity,
      enteredQuantity: data.quantity,
      enteredUnit: data.unit,
      replaces,
      note: String(data.note || '').slice(0, 1000),
      openingValue,
    })
    session.status = 'draft'
  } else if (op === 'undo') {
    const last = activeCountEvents(session).at(-1)
    if (!last) throw new Error('No scan or manual count remains to undo.')
    append({ kind: 'undo', target: last.id })
    session.status = 'draft'
  } else if (op === 'resume') {
    session.status = 'draft'
  } else if (op === 'review' || op === 'apply') {
    const evidence = countEvidence(session)
    if (!evidence.lines.length)
      throw new Error(
        'Count at least one item, including an explicit zero if needed.',
      )
    if (
      (evidence.unresolved.length || evidence.uncounted.length) &&
      data.partial !== true
    )
      throw new Error(
        'Uncounted or unresolved items remain. Explicitly confirm a Partial count or finish them.',
      )
    for (const line of evidence.lines) {
      const item = scoped(line.ingredientId)
      if (line.inventoryRevision !== ctx.revision(item))
        throw new Error(
          'Stock moved: recount affected items against current balances before review or application.',
        )
      if (line.unit !== item.unit)
        throw new Error('Stock unit changed; recount this item.')
    }
    session.partial = !!(
      evidence.unresolved.length || evidence.uncounted.length
    )
    if (op === 'review') {
      session.status = 'ready'
      session.reviewedAt = ctx.now
    } else {
      if (session.status !== 'ready' || data.confirm !== true)
        throw new Error(
          'Review this count and explicitly confirm application.',
        )
      // All writes are returned only after all lines pass. API transaction rolls back every effect on failure.
      const reportLines: Item[] = []
      for (const line of evidence.lines) {
        const item = scoped(line.ingredientId)
        const plan = inventoryAdjustmentPlan(item, {
          quantity: line.countedQuantity,
          unit: item.unit,
          adjustmentMode: 'total',
        })
        plan.change = canonicalQuantity(plan.change)
        const hasHistory =
          Number(item.quantity) !== 0 ||
          item.openingStockRecorded ||
          w.ledger.some((l) => l.ingredientId === item.id)
        const opening = session.type === 'opening' && !hasHistory
        if (
          session.type === 'opening' &&
          hasHistory &&
          data.existingStockReviewed !== true
        )
          throw new Error(
            'Opening count includes existing stock/history. Confirm reconciliation of these items explicitly.',
          )
        let cost =
          typeof item.cost === 'number' &&
          Number.isFinite(item.cost) &&
          item.cost >= 0 &&
          !item.needsCostSetup
            ? item.cost
            : null
        if (
          opening &&
          line.countedQuantity > 0 &&
          line.openingValue == null &&
          cost == null
        )
          throw new Error(
            'Opening valuation unavailable. Enter a confirmed total opening value for this line.',
          )
        if (!opening && plan.change !== 0 && cost == null)
          throw new Error(
            'Valuation unavailable. Set up the item cost before applying a stock adjustment.',
          )
        let movementId: string | null = null,
          value: number | null = cost == null ? null : plan.change * cost
        const journalId = 'count-' + session.id + '-' + item.id
        if (opening && line.countedQuantity > 0) {
          const totalValue =
            line.openingValue ?? line.countedQuantity * cost!
          const entry = openingStockEntry(
            item,
            {
              enabled: true,
              operationId:
                'count-' +
                session.id +
                '-' +
                session.scope.findIndex(
                  (b: Item) => b.ingredientId === item.id,
                ),
              unit: item.storageUnit || item.unit,
              quantity: convert(
                line.countedQuantity,
                item.unit,
                item.storageUnit || item.unit,
                item.conversions,
              ),
              value: totalValue,
              date: appliedDate,
            },
            w.ledger,
          )!
          if (entry.replay)
            throw new Error(
              'Opening operation already exists. Refresh count history.',
            )
          cost = totalValue / line.countedQuantity
          value = totalValue
          movementId = entry.ledger.id
          save('ingredients', { ...entry.item, needsCostSetup: false })
          save('ledger', {
            ...entry.ledger,
            countId: session.id,
            reason: 'Approved opening count ' + session.name,
            occurredAt: ctx.now,
            actor: ctx.actor,
            evidence: line.evidence,
          })
          if (entry.journal) save('journals', entry.journal)
        } else if (plan.change !== 0) {
          movementId = journalId
          save('ingredients', { ...item, quantity: plan.resultingQuantity })
          save('ledger', {
            id: movementId,
            name: item.name,
            ingredientId: item.id,
            quantity: plan.change,
            unit: item.unit,
            amount: value,
            date: appliedDate,
            type: 'adjustment',
            reason: 'Reviewed physical count ' + session.name,
            correctionOf: session.correctionOf || null,
            countId: session.id,
            previousQuantity: plan.previousQuantity,
            resultingQuantity: plan.resultingQuantity,
            inventoryUnit: plan.inventoryUnit,
            inventoryQuantity: plan.inventoryQuantity,
            previousInventoryQuantity: plan.previousInventoryQuantity,
            resultingInventoryQuantity: plan.resultingInventoryQuantity,
            occurredAt: ctx.now,
            actor: ctx.actor,
            evidence: line.evidence,
          })
          if (!Number.isFinite(value))
            throw new Error('Inventory value is too large.')
          const amount = Math.round(Math.abs(value!) * 100) / 100
          if (amount > 0)
            save('journals', {
              id: 'journal-' + movementId,
              name: 'Inventory count: ' + item.name,
              sourceId: movementId,
              date: appliedDate,
              status: 'posted',
              lines:
                value! > 0
                  ? [
                      {
                        account: 'Inventory asset',
                        debit: amount,
                        credit: 0,
                      },
                      { account: 'Other income', debit: 0, credit: amount },
                    ]
                  : [
                      {
                        account: 'Inventory shrink/waste COGS',
                        debit: amount,
                        credit: 0,
                      },
                      {
                        account: 'Inventory asset',
                        debit: 0,
                        credit: amount,
                      },
                    ],
            })
        }
        reportLines.push({
          ...line,
          difference: plan.change,
          previousQuantity: plan.previousQuantity,
          resultingQuantity: plan.resultingQuantity,
          adjustmentId: movementId,
          costBasis: cost,
          costBasisAt: ctx.now,
          valueDifference: value,
          valuationBasis: opening
            ? 'Confirmed opening value / existing cost'
            : 'Saved weighted-average canonical unit cost',
        })
      }
      session.status = 'completed'
      session.appliedAt = ctx.now
      session.approvedAt = ctx.now
      session.approver = ctx.actor
      session.report = {
        lines: reportLines,
        uncounted: evidence.uncounted,
        unresolved: evidence.unresolved,
      }
    }
  } else throw new Error('Unsupported count operation.')
  if (!['review', 'apply', 'cancel', 'takeover'].includes(op))
    session.status = 'draft'
  session.lines = countEvidence(session).lines
  session.revision += 1
  session.operations.push(operationId)
  session.operationFingerprints = {
    ...(session.operationFingerprints || {}),
    [operationId]: fingerprint,
  }
  session.lastSavedAt = ctx.now
  save('inventory_counts', session)
  return effects
}
/** Posting-time display basis; canonical stock quantities stay untouched. */
export function countLineView(line: Item): Item {
  const factor = line.displayFactor || 1
  return {
    ...line,
    unit: line.displayUnit || line.unit,
    canonicalUnit: line.unit,
    canonicalCountedQuantity: line.countedQuantity,
    systemQuantity: Number((line.systemQuantity * factor).toFixed(8)),
    countedQuantity:
      line.countedQuantity == null
        ? undefined
        : Number((line.countedQuantity * factor).toFixed(8)),
    costBasis: line.costBasis == null ? null : line.costBasis / factor,
    evidence: (line.evidence || []).map((e: Item) => ({
      ...e,
      quantity: Number((e.quantity * factor).toFixed(8)),
    })),
  }
}
export function countCsv(session: Item) {
  const raw = countSummary(session)
  const summary = {
    ...raw,
    lines: raw.lines.map(countLineView),
    uncounted: raw.uncounted.map(countLineView),
  }
  const header = [
    'Business',
    'Count',
    'Type',
    'Status',
    'Full/Partial',
    'Count reference',
    'Business timezone',
    'Reference timestamp',
    'Started at',
    'Counter',
    'Approver',
    'Approved at',
    'Applied at',
    'Item',
    'Expected',
    'Counted',
    'Difference',
    'Unit',
    'Counted at',
    'Adjustment',
    'Cost basis',
    'Value difference',
    'Cost effective at',
    'Evidence',
    'Notes',
  ]
  const common = [
    session.businessName,
    session.name,
    session.type,
    session.status,
    session.partial || summary.uncounted.length || summary.unresolved.length
      ? 'Partial / incomplete scope'
      : 'Full',
    session.id,
    session.timezone,
    session.countAt,
    session.startedAt,
    session.counter,
    session.approver || '',
    session.approvedAt || '',
    session.appliedAt || '',
  ]
  const rows = [
    ...summary.lines.map((l: Item) => [
      ...common,
      l.name,
      l.systemQuantity,
      l.countedQuantity,
      l.countedQuantity - l.systemQuantity,
      l.unit,
      l.countedAt,
      l.adjustmentId || '',
      l.costBasis ?? 'Unavailable',
      l.valueDifference ?? 'Unavailable',
      l.costBasisAt || '',
      JSON.stringify(l.evidence),
      l.note || '',
    ]),
    ...summary.uncounted.map((l: Item) => [
      ...common,
      l.name,
      l.systemQuantity,
      'Uncounted',
      '',
      '',
      ...Array(10).fill(''),
    ]),
    ...summary.unresolved.map((e: Item) => [
      ...common,
      'Unresolved barcode ' + e.barcode,
      '',
      '',
      '',
      '',
      e.at,
      '',
      '',
      '',
      '',
      '',
      '',
    ]),
  ]
  return csv(
    rows.map((row: unknown[]) =>
      Object.fromEntries(
        header.map((key, index) => [key, row[index] ?? '']),
      ),
    ) as Item[],
  )
}
