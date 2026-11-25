import {
  convert,
  isMixedPack,
  knownCurrentIngredientCost,
  number,
  packagingLines,
  recipeInputLines,
  units,
  validateDate,
  type Item,
  type Workspace,
} from './domain'
import { packageCost } from './ingredients'
import { basketProduction } from './basket-production'
import { marketOutput } from './production-destinations'
import { isPackaging } from './pantry-category'
import { activePrepLots } from './stock-prep'
import { stockUnitLabel } from './resale-stock'
import {
  productionBatchMultiplier,
  productionDefinition,
  productionRequirements,
  productionYieldConvert,
} from './production'
import { productionRunLines } from './production-run'
import { matchingPreparedLots } from './prepared-requirement'
import {
  assertRecipeComponentGraph,
  componentSourceId,
} from './recipe-components'

export type GrocerySources = {
  runs: string[]
  events: string[]
  recipes: { id: string; amount: number; basis: 'batches' | 'yield' }[]
  from: string
  to: string
}
export type GroceryLine = {
  id: string
  name: string
  unit: string
  kind:
    'Ingredients' | 'Packaging' | 'Supplies' | 'Purchased components' | 'Manual'
  vendor: string
  category: string
  needed: number
  onHand?: number
  onHandUnit?: string
  toBuy?: number
  packages?: number
  leftover?: number
  estimate?: number
  currency?: string
  review?: string
  notes?: string
  manual?: boolean
  sources: string[]
}
export type GroceryPrep = Pick<
  GroceryLine,
  'id' | 'name' | 'unit' | 'needed' | 'onHand' | 'sources'
> & { toMake: number }
export type GroceryProduct = {
  id: string
  name: string
  basket: string
  perBasket: number
  assembly?: 'mixed pack'
  unit?: string
  required: number
  allocated: number
  unreserved: number
  toProduce: number
  extra: number
  toObtain: number
  issue?: string
  runs: {
    id: string
    lineId: string
    name: string
    status: string
    planned: number
    pending: number
    posted: number
  }[]
}
export type GroceryMark = {
  row: string
  checked: boolean
  at: number
  token: string
}
export type GroceryList = {
  id: string
  generatedAt: string
  sources: GrocerySources
  labels: string[]
  lines: GroceryLine[]
  prep: GroceryPrep[]
  products?: GroceryProduct[]
  calculationVersion?: 2
  selectedSourceCount?: number
  warnings: string[]
  manual: GroceryLine[]
  marks: Record<string, GroceryMark>
  overrides: Record<string, number>
}

export const emptyGrocerySources: GrocerySources = {
  runs: [],
  events: [],
  recipes: [],
  from: '',
  to: '',
}
export const isPlannedGroceryRun = (run: Item) =>
  ['draft', 'scheduled', 'planned'].includes(run.status)
export const isGroceryRecipe = (recipe: Item) =>
  !recipe.archived && recipe.workflow !== 'handmade'
export const isShoppingLine = (
  line: GroceryLine,
  overrides: GroceryList['overrides'],
) =>
  !!line.review ||
  (overrides[line.id] ?? line.toBuy ?? 0) > 0 ||
  line.manual === true

export function newerGroceryMark(candidate: GroceryMark, prior?: GroceryMark) {
  return (
    !prior ||
    candidate.at > prior.at ||
    (candidate.at === prior.at && candidate.token > prior.token)
  )
}

const epsilon = 1e-8
const amount = (value: unknown) => Math.max(0, Number(value) || 0)
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Review the production setup.'
const addSource = (sources: string[], source: string) => {
  if (!sources.includes(source)) sources.push(source)
}

function purchasingSuggestion(line: GroceryLine, item: Item, today: string) {
  if (!line.toBuy || line.review) return
  const offer = item.purchaseOffers?.find(
    (entry: Item) =>
      entry.preferred &&
      (!entry.offerExpiresAt || entry.offerExpiresAt >= today),
  )
  let contents: number | undefined
  let price: number | undefined
  if (offer) {
    try {
      const basis = packageCost({ ...item, storageUnit: item.unit }, offer)
      contents = basis.contents
      price = Number(offer.packagePrice)
      line.currency = offer.currency || 'USD'
    } catch {
      contents = undefined
    }
  } else {
    try {
      const packageUnit = item.purchaseSetup?.packageUnit || item.purchaseUnit
      if (
        packageUnit &&
        (item.purchaseSetup?.packageUnit || units[packageUnit]?.factor === 0)
      )
        contents = convert(1, packageUnit, item.unit, item.conversions)
      else if (amount(item.amountPerPackage))
        contents = convert(
          item.amountPerPackage,
          item.storageUnit || item.unit,
          item.unit,
          item.conversions,
        )
    } catch {
      contents = undefined
    }
  }
  if (contents && Number.isFinite(contents)) {
    const count = line.toBuy / contents
    line.packages = Math.max(1, Math.ceil(count - Number.EPSILON * count))
    line.leftover = Math.max(0, line.packages * contents - line.toBuy)
  }
  const unitCost = knownCurrentIngredientCost(item)
  const quoteDate = String(
    offer?.checkedAt || offer?.priceCheckedAt || '',
  ).slice(0, 10)
  const recordedDate = String(item.lastPurchaseDate || '').slice(0, 10)
  if (
    price !== undefined &&
    line.packages &&
    (unitCost === undefined || (quoteDate && quoteDate >= recordedDate))
  )
    line.estimate = price * line.packages
  else if (unitCost !== undefined) {
    line.estimate =
      (contents && line.packages ? contents * line.packages : line.toBuy) *
      unitCost
    line.currency = item.currency || 'USD'
  }
}

export function generateGroceryList(
  state: Workspace,
  sources: GrocerySources,
  id: string,
  generatedAt: string,
): GroceryList {
  const list: GroceryList = {
    id,
    generatedAt,
    sources,
    calculationVersion: 2,
    selectedSourceCount: 0,
    labels: [],
    warnings: [],
    lines: [],
    prep: [],
    manual: [],
    marks: {},
    overrides: {},
  }
  const rows = new Map<string, GroceryLine>()
  const prepRows = new Map<string, GroceryPrep>()
  const prepRemaining = new Map<string, number>()
  const directPrepRemaining = new Map<string, number>()
  const directPrepLots = new Map<string, Set<string>>()
  const purchasedRows = new Map<string, GroceryLine>()
  const basketProducts: GroceryProduct[] = []
  list.products = basketProducts
  const ingredients = state.ingredients || []
  const recipes = state.recipes || []
  const products = state.products || []
  const batches = (state.batches || []).filter(isPlannedGroceryRun)
  const byIngredient = new Map(ingredients.map((item) => [item.id, item]))
  const warn = (source: string, error: unknown) =>
    addSource(
      list.warnings,
      `${source}: ${typeof error === 'string' ? error : errorMessage(error)}`,
    )
  const add = (
    input: Item,
    item: Item | undefined,
    quantity: number,
    source: string,
    review?: string,
    keepInputUnit = false,
  ) => {
    const unit = (keepInputUnit ? input.unit : item?.unit || input.unit) || ''
    const itemId = item?.id || input.ingredientId || input.itemId
    const kind =
      input.groceryPackaging || (item && isPackaging(item))
        ? 'Packaging'
        : input.productionSupply ||
            ['supply', 'material'].includes(item?.usedAs)
          ? 'Supplies'
          : 'Ingredients'
    const key = JSON.stringify([kind, itemId, unit, review || ''])
    let row = rows.get(key)
    if (!row) {
      const offer = item?.purchaseOffers?.find((entry: Item) => entry.preferred)
      row = {
        id: `line-${rows.size + 1}`,
        name:
          item?.name ||
          input.name ||
          input.ingredientName ||
          `Unavailable ingredient (${itemId || 'no reference'})`,
        unit,
        needed: 0,
        kind,
        sources: [],
        review,
        vendor:
          offer?.vendor ||
          state.vendors?.find((vendor) => vendor.id === item?.vendorId)?.name ||
          item?.vendor ||
          '',
        category: item?.category || '',
        notes: item?.notes,
      }
      rows.set(key, row)
      if (
        review?.startsWith('Needs unit review') &&
        item?.trackInventory !== false &&
        item
      ) {
        row.onHand = amount(item.quantity)
        row.onHandUnit = item.unit
      }
    }
    row.needed += quantity
    addSource(row.sources, source)
  }
  const recipeInputs = (
    recipe: Item,
    multiplier: number,
    source: string,
    graph: Item[],
    historic: Item[] = [],
    prepSources: Record<string, string> = {},
  ) => {
    const inputs = recipeInputLines(recipe, graph)
    if (!inputs.length)
      warn(source, `${recipe.name} has no recipe ingredients.`)
    for (const line of inputs) {
      const bases =
        line.sourceRecipePath
          ?.slice(1)
          .map((id: string) => graph.find((recipe) => recipe.id === id)?.name)
          .filter(Boolean) || []
      material(
        line,
        multiplier,
        [source, ...bases].join(' → '),
        graph,
        historic,
        prepSources,
      )
    }
  }
  function material(
    input: Item,
    multiplier: number,
    source: string,
    graph: Item[],
    historic: Item[] = [],
    prepSources: Record<string, string> = {},
  ) {
    const item = byIngredient.get(input.ingredientId)
    const fallback =
      item || historic.find((record) => record.id === input.ingredientId)
    let quantity: number
    try {
      quantity = number(input.quantity, 'Recipe input quantity') * multiplier
    } catch (error) {
      warn(source, error)
      return
    }
    if (quantity <= 0) return
    if (!item || item.archived) {
      add(
        input,
        fallback,
        quantity,
        source,
        item
          ? 'Archived item · reference only'
          : 'Unavailable item · reference only',
        true,
      )
      return
    }
    let normalized: number
    try {
      normalized = convert(
        quantity,
        input.unit || (input.groceryPackaging ? 'each' : ''),
        item.unit,
        item.conversions,
      )
    } catch {
      add(
        input,
        item,
        quantity,
        source,
        `Needs unit review (${input.unit || 'missing unit'} → ${item.unit})`,
        true,
      )
      return
    }
    if (input.prepared) {
      const eligible = matchingPreparedLots(
        item,
        state.lots || [],
        input.prepared,
      )
      const allowed = prepSources[item.id]
        ? eligible.filter((lot) => lot.id === prepSources[item.id])
        : eligible
      const selected = allowed.find(
        (lot) =>
          (directPrepRemaining.get(lot.id) ?? lot.quantity) >=
          normalized - epsilon,
      )
      if (selected)
        directPrepRemaining.set(
          selected.id,
          (directPrepRemaining.get(selected.id) ?? selected.quantity) -
            normalized,
        )
      else
        warn(
          source,
          `${item.name}: prepare more ${input.prepared.method} stock or review allocation. Unportioned stock is not a substitute.`,
        )
      const key = JSON.stringify([
        item.id,
        input.prepared.method,
        input.prepared.perPortion,
        input.prepared.outputUnit,
      ])
      const prep = prepRows.get(key) || {
        id: key,
        name: `${item.name} · ${input.prepared.method}`,
        unit: item.unit,
        needed: 0,
        onHand: 0,
        toMake: 0,
        sources: [],
      }
      const counted = directPrepLots.get(key) || new Set<string>()
      for (const lot of allowed) {
        if (counted.has(lot.id)) continue
        prep.onHand = (prep.onHand ?? 0) + amount(lot.quantity)
        counted.add(lot.id)
      }
      directPrepLots.set(key, counted)
      prep.needed += normalized
      if (!selected) prep.toMake += normalized
      addSource(prep.sources, source)
      prepRows.set(key, prep)
      return
    }
    const componentId = componentSourceId(
      input as Item & { ingredientId: string },
      ingredients,
    )
    if (!componentId) {
      add(input, item, normalized, source)
      return
    }
    const component = graph.find((recipe) => recipe.id === componentId)
    if (!component || component.archived) {
      add(
        input,
        item,
        normalized,
        source,
        'Prep recipe unavailable · reference only',
      )
      return
    }
    const onHand = item.trackInventory === false ? 0 : amount(item.quantity)
    const available = prepRemaining.get(item.id) ?? onHand
    const used = Math.min(available, normalized)
    const shortage = Math.max(0, normalized - used)
    prepRemaining.set(item.id, available - used)
    const prep = prepRows.get(item.id) || {
      id: item.id,
      name: item.name,
      unit: item.unit,
      needed: 0,
      onHand,
      toMake: 0,
      sources: [],
    }
    prep.needed += normalized
    prep.toMake += shortage
    addSource(prep.sources, source)
    prepRows.set(item.id, prep)
    if (shortage <= epsilon) return
    let output: number
    try {
      output = productionYieldConvert(
        shortage,
        item.unit,
        component.yieldUnit,
        item.conversions,
      )
    } catch {
      add(
        input,
        item,
        normalized,
        source,
        `Needs unit review (${item.unit} → ${component.yieldUnit || 'missing yield unit'})`,
      )
      return
    }
    recipeInputs(
      component,
      productionBatchMultiplier(component, output),
      `${source} → ${component.name}`,
      graph,
      historic,
    )
  }
  const runRecipe = (
    recipe: Item,
    multiplier: number,
    source: string,
    frozen: Item[] = [],
    historic: Item[] = [],
    prepSources: Record<string, string> = {},
  ) => {
    const graph = [
      ...frozen,
      ...recipes.filter(
        (item) => !frozen.some((saved) => saved.id === item.id),
      ),
    ]
    const validated = assertRecipeComponentGraph(
      recipe,
      { recipes: graph, ingredients },
      true,
    )
    recipeInputs(recipe, multiplier, source, validated, historic, prepSources)
  }
  const productInputs = (
    definition: Item,
    output: number,
    label: string,
    prepSources?: Record<string, string>,
  ) => {
    if (definition.recipe) {
      const recipe = definition.recipe
      const source = `${label} (${recipe.name})`
      runRecipe(
        recipe,
        productionBatchMultiplier(
          recipe,
          output *
            number(
              definition.product.unitsPerPackage,
              'Output per package',
              0.000001,
            ),
        ),
        source,
        definition.recipes,
        definition.ingredients,
        prepSources,
      )
      for (const input of packagingLines(definition.product))
        material(
          { ...input, groceryPackaging: true },
          output,
          source,
          recipes,
          definition.ingredients,
        )
      return
    }
    const wholeOutput = Math.ceil(output)
    const packaging = packagingLines(definition.product)
    for (const input of productionRequirements(definition, wholeOutput)
      .requirements) {
      if (input.kind === 'product') continue
      material(
        {
          ...input,
          ingredientId: input.itemId,
          prepared: input.source?.prepared,
          productionSupply: !!input.supplyQuantity,
          groceryPackaging: packaging.some(
            (entry) => entry.ingredientId === input.itemId,
          ),
        },
        output / wholeOutput,
        label,
        recipes,
        definition.ingredients,
      )
    }
  }
  const purchaseComponent = (
    item: Item,
    required: number,
    covered: number,
    shortage: number,
    source: string,
  ) => {
    const row = purchasedRows.get(item.id) || {
      id: `purchased-${purchasedRows.size + 1}`,
      name: item.name,
      unit: stockUnitLabel(item, 2),
      kind: 'Purchased components' as const,
      vendor:
        state.vendors?.find((vendor) => vendor.id === item.vendorId)?.name ||
        item.vendor ||
        '',
      category: item.category || '',
      needed: 0,
      onHand: 0,
      toBuy: 0,
      sources: [],
    }
    row.needed += required
    row.onHand = (row.onHand ?? 0) + covered
    row.toBuy = (row.toBuy ?? 0) + shortage
    addSource(row.sources, source)
    purchasedRows.set(item.id, row)
  }
  const range = !!(sources.from || sources.to)
  if (range) {
    validateDate(sources.from)
    validateDate(sources.to)
    if (sources.from > sources.to)
      throw new Error('End date must follow the start date.')
    list.labels.push(`Production from ${sources.from} to ${sources.to}`)
  }
  for (const id of sources.runs)
    if (!batches.some((run) => run.id === id))
      warn('Selected run', 'A run is no longer planned or available.')
  const events = (state.events || []).filter((event) =>
    sources.events.includes(event.id),
  )
  for (const event of events) list.labels.push(event.name)
  if (events.length < sources.events.length)
    warn('Selected event', 'An event is no longer available.')
  const links = (state.event_batch_links || []).filter((link) =>
    sources.events.includes(link.eventId),
  )
  for (const event of events)
    if (
      !batches.some((run) =>
        productionRunLines(run).some(
          (line) => marketOutput(run, line, event.id, state).planned > 0,
        ),
      ) &&
      !links.some(
        (link) =>
          link.eventId === event.id &&
          batches.some((run) => run.id === link.recordId) &&
          link.allocations?.some((allocation: Item) => allocation.quantity > 0),
      )
    )
      warn(event.name, 'No linked planned output allocations.')
  const selected = batches.flatMap((run) => {
    const full =
      sources.runs.includes(run.id) ||
      (range && run.date >= sources.from && run.date <= sources.to)
    const linked = links.filter((link) => link.recordId === run.id)
    if (!full && !linked.length && !sources.events.length) return []
    const runName = run.name || 'Production run'
    if (full) list.labels.push(`${runName}${run.date ? ` · ${run.date}` : ''}`)
    const modern = productionRunLines(run)
    return (modern.length ? modern : [run]).flatMap((line) => {
      const allocations = modern.length
        ? events.flatMap((event) => {
            const { planned } = marketOutput(run, line, event.id, state)
            return planned > 0 ? [{ quantity: planned, event: event.name }] : []
          })
        : linked.flatMap((link) =>
            (link.allocations || [])
              .filter(
                (entry: Item) =>
                  entry.lineId === line.id &&
                  entry.productId === line.productId &&
                  Number(entry.quantity) > 0,
              )
              .map((entry: Item) => ({
                quantity: Number(entry.quantity),
                event: events.find((event) => event.id === link.eventId)?.name,
              })),
          )
      const label = [
        full
          ? ''
          : allocations
              .map((entry) => entry.event)
              .filter(Boolean)
              .join(' + '),
        runName,
        run.date || '',
        modern.length && line.name !== runName ? line.name : '',
      ]
        .filter(Boolean)
        .join(' · ')
      const selectedOutput = full
        ? Number(line.quantity)
        : Math.min(
            Number(line.quantity),
            allocations.reduce((sum, entry) => sum + entry.quantity, 0),
          )
      if (!full && !(selectedOutput > 0)) return []
      if (!full) addSource(list.labels, label)
      return [
        { run, line, full, selectedOutput, label, modern: !!modern.length },
      ]
    })
  })
  const linkedBaskets = new Map<string, string[]>()
  const runKey = (run: Item, line: Item) => JSON.stringify([run.id, line.id])
  const basketLines = new Set<Item>()
  const selectedKeys = new Set(
    selected.map(({ run, line }) => runKey(run, line)),
  )
  const plannedIds = new Set(batches.map((run) => run.id))
  for (const { run, line, label, modern } of [...selected]) {
    if (!modern) continue
    const product = products.find((item) => item.id === line.productId)
    if ((product?.workflow || line.definition?.product?.workflow) !== 'kit')
      continue
    basketLines.add(line)
    const mixed = isMixedPack(product || line.definition?.product)
    const basket = `${label} · ${line.quantity} ${mixed ? 'mixed pack' : 'basket'}${Number(line.quantity) === 1 ? '' : 's'}`
    try {
      const components = basketProduction(line, state, run.id)
      if (!components.length)
        warn(
          basket,
          'No included products are available. Review the basket definition.',
        )
      for (const entry of components) {
        const source = `${basket} → ${entry.name}`
        for (const linked of entry.sources) {
          if (!linked.pending) continue
          const key = runKey(linked.run, linked.line)
          const parents = linkedBaskets.get(key) || []
          addSource(parents, source)
          linkedBaskets.set(key, parents)
          if (!selectedKeys.has(key)) {
            const label = linked.run.name || linked.line.name
            if (plannedIds.has(linked.run.id)) {
              selected.push({
                run: linked.run,
                line: linked.line,
                full: true,
                selectedOutput: Number(linked.line.quantity),
                label,
                modern: true,
              })
              selectedKeys.add(key)
              addSource(list.labels, `${label} · linked component run`)
            } else
              warn(
                source,
                `${label}: linked production status requires review.`,
              )
          }
        }
        const stockGap = Math.max(
          0,
          entry.allocated + entry.posted - entry.ready,
        )
        const toObtain = entry.resale ? entry.unplanned + stockGap : 0
        const awaitingAssignment =
          !entry.resale &&
          entry.choice.useExistingRun &&
          entry.unplanned > epsilon
        const freshPlan = awaitingAssignment
          ? undefined
          : entry.requirementCandidate
        const issue = [
          entry.item?.archived
            ? 'Product is archived. Review the basket contents.'
            : '',
          awaitingAssignment
            ? `${entry.unplanned} packages still to assign from an existing run. Link output in Production before calculating those shopping needs.`
            : entry.setup,
          stockGap > epsilon && !entry.resale
            ? `${stockGap} allocated or posted packages are no longer available. Review the production allocation.`
            : '',
        ]
          .filter(Boolean)
          .join(' ')
        basketProducts.push({
          id: JSON.stringify([run.id, line.id, entry.component.productId]),
          name: entry.name,
          basket,
          perBasket: Number(entry.component.quantity),
          ...(mixed ? { assembly: 'mixed pack', unit: entry.component.basis === 'unpackaged' ? entry.component.contentUnit : undefined } : {}),
          required: entry.required,
          allocated: entry.allocated,
          unreserved: Math.max(
            0,
            entry.eligible - entry.allocated - entry.posted,
          ),
          toProduce: entry.resale ? 0 : entry.pending + entry.unplanned,
          extra: freshPlan
            ? Math.max(0, Number(freshPlan.quantity) - entry.unplanned)
            : 0,
          toObtain,
          issue: issue || undefined,
          runs: entry.sources.map(({ run, line, pending, posted }) => ({
            id: run.id,
            lineId: line.id,
            name: run.name || line.name,
            status: run.status,
            planned: Number(line.quantity),
            pending,
            posted,
          })),
        })
        if (issue) warn(source, issue)
        try {
          if (entry.resale && entry.item && !entry.item.archived)
            purchaseComponent(
              entry.item,
              entry.required,
              entry.required - toObtain,
              toObtain,
              source,
            )
          else if (freshPlan)
            productInputs(
              freshPlan.definition,
              Number(freshPlan.quantity),
              source,
            )
        } catch (error) {
          warn(source, error)
        }
      }
    } catch (error) {
      warn(basket, error)
    }
  }
  list.selectedSourceCount = selected.length + sources.recipes.length
  for (const { run, line, full, selectedOutput, label, modern } of selected) {
    try {
      if (modern) {
        const product = products.find((item) => item.id === line.productId)
        const definition =
          (!basketLines.has(line) && line.definition) ||
          (product && productionDefinition(product, state, line.mapping || {}))
        if (!definition)
          throw new Error('Production definition is unavailable.')
        const parents = linkedBaskets.get(runKey(run, line))
        const output = number(
          parents || basketLines.has(line) ? line.quantity : selectedOutput,
          'Planned selling packages',
          full ? 1 : 0.000001,
        )
        productInputs(
          definition,
          output,
          parents ? `${parents.join('; ')} → ${label}` : label,
          line.prepSources,
        )
      } else {
        const recipe = recipes.find((item) => item.id === run.recipeId)
        if (!recipe) throw new Error('Recipe is unavailable.')
        const multiplier =
          number(run.count, 'Batch count', 0.000001) *
          (full ? 1 : selectedOutput / Number(line.quantity))
        const source = `${label} (${recipe.name})`
        runRecipe(recipe, multiplier, source)
        const candidates = products.filter(
          (item) => item.recipeId === recipe.id,
        )
        const product =
          candidates.find((item) => item.id === run.productId) ||
          (candidates.length === 1 ? candidates[0] : undefined)
        if (product)
          for (const input of packagingLines(product))
            material(
              { ...input, groceryPackaging: true },
              (number(recipe.yield, 'Recipe yield', 0.000001) * multiplier) /
                number(product.unitsPerPackage, 'Output per package', 0.000001),
              source,
              recipes,
            )
      }
    } catch (error) {
      warn(label, error)
    }
  }
  for (const choice of sources.recipes) {
    const recipe = recipes.find(
      (item) => item.id === choice.id && isGroceryRecipe(item),
    )
    if (!recipe) {
      warn('Selected recipe', 'A recipe is no longer available.')
      continue
    }
    const label = `${recipe.name} · ${choice.amount} ${choice.basis === 'yield' ? recipe.yieldUnit : choice.amount === 1 ? 'batch' : 'batches'}`
    list.labels.push(label)
    try {
      runRecipe(
        recipe,
        choice.basis === 'yield'
          ? productionBatchMultiplier(recipe, choice.amount)
          : choice.amount,
        label,
      )
    } catch (error) {
      warn(label, error)
    }
  }
  if (
    !range &&
    !sources.runs.length &&
    !sources.recipes.length &&
    !sources.events.length
  )
    throw new Error(
      'Select at least one production run, date range, linked event, or recipe.',
    )
  const remaining = new Map<string, number>()
  for (const [key, row] of rows) {
    if (row.review) continue
    const [, itemId] = JSON.parse(key)
    const item = byIngredient.get(itemId)!
    const prepared = activePrepLots(state.lots, itemId).reduce(
      (sum, lot) => sum + amount(lot.quantity),
      0,
    )
    const available =
      remaining.get(itemId) ?? Math.max(0, amount(item.quantity) - prepared)
    row.onHand = item.trackInventory === false ? undefined : available
    remaining.set(itemId, Math.max(0, available - row.needed))
    const shortage = Math.max(0, row.needed - (row.onHand ?? 0))
    row.toBuy = shortage > epsilon ? shortage : 0
    purchasingSuggestion(row, item, generatedAt.slice(0, 10))
  }
  list.lines = [...rows.values(), ...purchasedRows.values()].sort(
    (left, right) => left.name.localeCompare(right.name),
  )
  for (const [productId, row] of purchasedRows) {
    const item = products.find((product) => product.id === productId)
    const count = Number(item?.purchaseDefaults?.itemsPerPack)
    const price = Number(item?.purchaseDefaults?.packPrice)
    if (!row.toBuy || !Number.isSafeInteger(count) || count < 1) continue
    row.packages = Math.ceil(row.toBuy / count)
    row.leftover = row.packages * count - row.toBuy
    if (Number.isFinite(price) && price >= 0)
      row.estimate = row.packages * price
  }
  list.prep = [...prepRows.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  )
  return list
}

export const groceryQuantity = (value: number, unit: string) =>
  `${value.toLocaleString('en-US', { maximumFractionDigits: 8 })}${unit ? ` ${unit}` : ''}`

export function groceryAmount(
  line: GroceryLine,
  overrides: GroceryList['overrides'],
) {
  const override = overrides[line.id]
  if (override !== undefined)
    return `${groceryQuantity(override, line.unit)} · edited`
  if (line.review) return line.review
  if (!line.toBuy) return 'Covered by stock'
  return `${groceryQuantity(line.toBuy, line.unit)}${line.packages ? ` · ${line.packages} ${line.packages === 1 ? 'package' : 'packages'}` : ''}`
}

export function groceryGroups(lines: GroceryLine[], by: 'vendor' | 'category') {
  const groups = new Map<string, { label: string; lines: GroceryLine[] }>()
  for (const line of lines) {
    const name = line[by] || (by === 'vendor' ? 'No vendor' : 'No category')
    const label = `${line.kind} · ${name}`
    const group = groups.get(label) || { label, lines: [] }
    group.lines.push(line)
    groups.set(label, group)
  }
  return [...groups.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  )
}

export function groceryEmptyMessage(list: GroceryList) {
  if (!list.calculationVersion)
    return 'This saved snapshot predates basket-content expansion. Recalculate to check current needs.'
  if (list.warnings.length || list.lines.some((line) => line.review))
    return 'Some requirements could not be calculated. Resolve the planning notes or items needing review before relying on this list.'
  if (!list.selectedSourceCount)
    return 'No production sources selected for this snapshot.'
  if (list.prep.some((entry) => entry.toMake > epsilon))
    return 'No purchases needed. Check Prep Before Production for work still to do.'
  return 'Everything required is covered by stock.'
}

export function groceryProductSummary(product: GroceryProduct) {
  const packages = (quantity: number, descriptor = '') =>
    groceryQuantity(
      quantity,
      `${descriptor}${product.unit ? `${product.unit} ${quantity === 1 ? 'unit' : 'units'}` : quantity === 1 ? 'package' : 'packages'}`,
    )
  return [
    `${packages(product.perBasket)} per ${product.assembly || 'basket'}`,
    `${packages(product.required)} required`,
    `${packages(product.allocated)} allocated from finished stock`,
    `${packages(product.unreserved)} unreserved`,
    `${packages(product.toProduce)} to produce`,
    ...(product.extra
      ? [`${packages(product.extra, 'extra ')} from batch rounding`]
      : []),
    ...(product.toObtain ? [`${packages(product.toObtain)} to obtain`] : []),
  ].join(' · ')
}

export function groceryLinkedRun(run: GroceryProduct['runs'][number]) {
  return `${run.name} · ${run.status} · ${groceryQuantity(run.planned, 'packages planned in the batch')} · ${groceryQuantity(run.pending, 'pending for this basket')} · ${groceryQuantity(run.posted, 'posted for this basket')}`
}

export function groceryText(list: GroceryList, by: 'vendor' | 'category') {
  const lines = [...list.lines, ...list.manual]
  return [
    `Grocery & Prep — ${list.generatedAt}`,
    `Sources: ${list.labels.join('; ')}`,
    ...(!list.calculationVersion ? [groceryEmptyMessage(list)] : []),
    ...groceryWarnings(list).map((warning) => `Review: ${warning}`),
    '',
    'Products to make',
    ...(list.products || []).flatMap((product) => [
      `${product.name} — ${product.basket}: ${groceryProductSummary(product)}`,
      ...product.runs.map(groceryLinkedRun),
      ...(product.issue ? [`Review: ${product.issue}`] : []),
    ]),
    '',
    'Shopping list',
    ...(list.calculationVersion &&
    !lines.some((line) => isShoppingLine(line, list.overrides))
      ? [groceryEmptyMessage(list)]
      : []),
    ...groceryGroups(lines, by).flatMap((group) => [
      '',
      group.label,
      ...group.lines.map(
        (line) =>
          `[${list.marks[line.id]?.checked ? 'x' : ' '}] ${line.name}: ${groceryAmount(line, list.overrides)}${line.sources.length ? ` — ${line.sources.join('; ')}` : ''}`,
      ),
    ]),
    '',
    'Prep before production',
    ...list.prep.map(
      (prep) =>
        `${prep.name}: make ${groceryQuantity(prep.toMake, prep.unit)}; ${groceryQuantity(prep.onHand ?? 0, prep.unit)} on hand`,
    ),
  ].join('\n')
}

export function groceryWarnings(list: GroceryList) {
  return list.calculationVersion
    ? list.warnings
    : list.warnings.filter(
        (warning) =>
          !warning.includes('kit components are not ingredient purchases'),
      )
}
