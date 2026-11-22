import { randomUUID } from 'node:crypto'
import {
  validateCustomFactor,
  type BakingReference,
} from '../../src/lib/baking-converter'
import { units } from '../../src/lib/domain'
const projection = `id, business_id AS "businessId", reference_id AS "referenceId", inventory_ingredient_id AS "inventoryIngredientId", ingredient_name AS "ingredientName", description, reference_weight_g::float8 AS "referenceWeightG", reference_volume_ml::float8 AS "referenceVolumeMl", original_quantity::float8 AS "originalQuantity", original_unit AS "originalUnit", source_name AS "sourceName", source_url AS "sourceUrl", brand, scope`
export async function handleBakingConverter(
  req: Request,
  client: any,
  org: string,
  role: string,
) {
  if (req.method === 'POST') {
    if (!['Owner', 'Manager'].includes(role))
      return Response.json(
        { error: 'Only owners and managers can save custom conversions.' },
        { status: 403 },
      )
    const input = await req.json()
    const { weight, volume } = validateCustomFactor(input)
    const originalQuantity =
      input.originalQuantity == null ? volume : Number(input.originalQuantity)
    const originalUnit = input.originalUnit || 'ml'
    if (
      !units[originalUnit] ||
      units[originalUnit].category !== 'volume' ||
      !Number.isFinite(originalQuantity) ||
      originalQuantity <= 0 ||
      Math.abs(originalQuantity * units[originalUnit].factor - volume) >
        volume * 1e-12
    )
      throw new Error(
        'The original volume must match the measured conversion basis.',
      )
    const privateId = input.privateId || null
    if (privateId) {
      const owned = await client.query(
        "SELECT id FROM baking_conversion_references WHERE id=$1 AND business_id=$2 AND scope='private'",
        [privateId, org],
      )
      if (!owned.rowCount)
        throw new Error('Your custom conversion is unavailable.')
    }
    const referenceId = input.referenceId || null,
      inventoryId = input.inventoryIngredientId || null
    if (referenceId) {
      const reference = await client.query(
        "SELECT id FROM baking_conversion_references WHERE id=$1 AND scope='shared'",
        [referenceId],
      )
      if (!reference.rowCount)
        throw new Error('The reference ingredient is unavailable.')
    }
    if (inventoryId) {
      const ingredient = await client.query(
        'SELECT id FROM ingredients WHERE business_id=$1 AND id=$2',
        [org, inventoryId],
      )
      if (!ingredient.rowCount)
        throw new Error('The saved ingredient is unavailable.')
    }
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [
      org,
    ])
    const existing = await client.query(
      'SELECT id FROM baking_conversion_references WHERE business_id=$1 AND (($2::text IS NOT NULL AND reference_id=$2) OR ($3::text IS NOT NULL AND inventory_ingredient_id=$3) OR ($4::text IS NOT NULL AND id=$4))',
      [org, referenceId, inventoryId, privateId],
    )
    if (existing.rowCount > 1)
      throw new Error(
        'This reference and inventory ingredient have different custom factors. Select the existing factor to edit it.',
      )
    const id = existing.rows[0]?.id || randomUUID()
    await client.query(
      `INSERT INTO baking_conversion_references (id,business_id,reference_id,inventory_ingredient_id,ingredient_name,description,reference_weight_g,reference_volume_ml,original_quantity,original_unit,source_name,source_url,scope)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Your measured conversion','','private')
      ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, reference_weight_g=EXCLUDED.reference_weight_g, reference_volume_ml=EXCLUDED.reference_volume_ml, original_quantity=EXCLUDED.original_quantity, original_unit=EXCLUDED.original_unit
      WHERE baking_conversion_references.business_id=$2 AND baking_conversion_references.scope='private'`,
      [
        id,
        org,
        referenceId,
        inventoryId,
        input.ingredientName.trim(),
        input.description.trim(),
        weight,
        volume,
        originalQuantity,
        originalUnit,
      ],
    )
  } else if (req.method !== 'GET')
    return new Response('Method not allowed', { status: 405 })
  const records = await client.query(
    `SELECT ${projection} FROM baking_conversion_references WHERE scope='shared' OR business_id=$1 ORDER BY ingredient_name,brand`,
    [org],
  )
  // Only explicit, verified inventory relationships qualify. Never guess a density.
  const inventory = await client.query(
    "SELECT id,data FROM ingredients WHERE business_id=$1 AND data->>'usedAs'='ingredient'",
    [org],
  )
  const saved: BakingReference[] = []
  for (const row of inventory.rows) {
    for (const c of row.data.conversions || []) {
      const a = units[c.from],
        b = units[c.to]
      if (!c.verified || !a || !b || a.category === b.category) continue
      const left = Number(c.amountFrom) * a.factor,
        right = Number(c.amountTo) * b.factor
      if (!(
        left > 0 &&
        right > 0 &&
        Number.isFinite(left) &&
        Number.isFinite(right)
      ))
        continue
      if (
        ![a.category, b.category].includes('weight') ||
        ![a.category, b.category].includes('volume')
      )
        continue
      saved.push({
        id: 'inventory-' + row.id,
        ingredientName: row.data.name,
        description: c.notes || 'Verified saved ingredient conversion',
        referenceWeightG: a.category === 'weight' ? left : right,
        referenceVolumeMl: a.category === 'volume' ? left : right,
        originalQuantity: Number(c.amountFrom),
        originalUnit: c.from,
        sourceName: 'Verified saved ingredient conversion',
        sourceUrl: '',
        scope: 'private',
        inventoryIngredientId: row.id,
      })
      break
    }
  }
  return Response.json(
    { references: [...records.rows, ...saved] },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
