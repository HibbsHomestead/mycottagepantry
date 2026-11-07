import type { AdminMetadata } from '../../src/lib/platform-admin-types'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { catalogSnapshotSchema, externalGTIN } from '../../src/lib/catalog'
import { AdminError, audit, type AdminClient } from './platform-admin-core'
import { limitedBody } from './support-core'

export async function handleAdminCatalog(
  c: AdminClient,
  request: Request,
  session: AdminMetadata,
  reference: string,
) {
  if (!session.mfa_at)
    throw new AdminError(
      403,
      'MFA_REQUIRED',
      'Complete administrator verification before managing the catalog.',
    )
  if (!['owner', 'admin'].includes(session.role))
    throw new AdminError(
      403,
      'ADMIN_REQUIRED',
      'Catalog publishing requires a platform administrator.',
    )
  if (request.method === 'GET') {
    const items = (
      await c.query(
        `SELECT i.*,r.id AS revision_id,r.data FROM catalog_items i JOIN LATERAL(SELECT id,data FROM catalog_revisions WHERE item_id=i.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true ORDER BY i.created_at DESC LIMIT 200`,
      )
    ).rows
    const submissions = (
      await c.query(
        "SELECT id,business_id,data,created_at FROM catalog_submissions WHERE status='pending' ORDER BY created_at LIMIT 100",
      )
    ).rows
    return { items, submissions }
  }
  const input = z
    .object({
      operation: z.enum(['publish', 'status', 'reject']),
      id: z.string().max(100).optional(),
      expectedRevision: z.string().max(100).optional(),
      snapshot: catalogSnapshotSchema.optional(),
      sources: z
        .array(
          z
            .object({
              url: z.url().startsWith('https://').max(2000),
              license: z.string().min(1).max(1000),
            })
            .strict(),
        )
        .max(10)
        .default([]),
      reviewScope: z.string().trim().min(10).max(2000),
      rights: z.literal(true),
      status: z.enum(['active', 'withdrawn', 'superseded']).optional(),
      submission: z
        .object({ id: z.string().max(100), businessId: z.uuid() })
        .strict()
        .optional(),
    })
    .strict()
    .parse(JSON.parse((await limitedBody(request, 50000)).toString()))
  let submission
  if (input.submission) {
    submission = (
      await c.query(
        "SELECT * FROM catalog_submissions WHERE id=$1 AND business_id=$2 AND status='pending' FOR UPDATE",
        [input.submission.id, input.submission.businessId],
      )
    ).rows[0]
    if (!submission)
      throw new AdminError(
        409,
        'SUBMISSION_CHANGED',
        'This submission was already reviewed. Reload the queue.',
      )
  }
  const id = input.id || randomUUID()
  if (input.operation === 'publish') {
    const snapshot = catalogSnapshotSchema.parse(input.snapshot)
    if (snapshot.entryType === 'branded' && !input.sources.length)
      throw new AdminError(
        400,
        'SOURCE_REQUIRED',
        'Cite a permitted source and the fields checked.',
      )
    const identityKey = snapshot.fields.barcode
      ? externalGTIN(snapshot.fields.barcode, snapshot.fields.barcodeFormat)
      : JSON.stringify([
          snapshot.kind,
          snapshot.fields.name.trim().toLowerCase(),
          snapshot.fields.brand?.trim().toLowerCase(),
          snapshot.fields.variant?.trim().toLowerCase(),
          snapshot.fields.purchaseQuantity,
          snapshot.fields.purchaseUnit,
        ])
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'catalog-publish:' + identityKey,
    ])
    if (!input.id && !snapshot.fields.barcode) {
      const duplicate = (
        await c.query(
          "SELECT i.id FROM catalog_items i JOIN LATERAL (SELECT data FROM catalog_revisions WHERE item_id=i.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true WHERE i.kind=$1 AND LOWER(TRIM(r.data->'fields'->>'name'))=LOWER(TRIM($2)) AND LOWER(TRIM(COALESCE(r.data->'fields'->>'brand','')))=LOWER(TRIM($3)) AND LOWER(TRIM(COALESCE(r.data->'fields'->>'variant','')))=LOWER(TRIM($4)) AND COALESCE(r.data->'fields'->>'purchaseQuantity','')=$5 AND COALESCE(r.data->'fields'->>'purchaseUnit','')=$6 LIMIT 1",
          [
            snapshot.kind,
            snapshot.fields.name,
            snapshot.fields.brand || '',
            snapshot.fields.variant || '',
            String(snapshot.fields.purchaseQuantity || ''),
            snapshot.fields.purchaseUnit || '',
          ],
        )
      ).rows[0]
      if (duplicate)
        throw new AdminError(
          409,
          'CATALOG_DUPLICATE',
          'A catalog entry has the same identity and package details. Review that entry for a correction or distinguish the actual variant before publishing.',
        )
    }
    let identifier: string | undefined
    if (snapshot.fields.barcode) {
      identifier = externalGTIN(
        snapshot.fields.barcode,
        snapshot.fields.barcodeFormat,
      )
      const duplicate = (
        await c.query(
          'SELECT item_id FROM catalog_identifiers WHERE identifier=$1',
          [identifier],
        )
      ).rows[0]
      if (duplicate && duplicate.item_id !== input.id)
        throw new AdminError(
          409,
          'CATALOG_DUPLICATE',
          'This barcode already belongs to a catalog package. Open that entry and review a correction instead of publishing a duplicate.',
        )
    }
    if (submission?.data.targetId && submission.data.targetId !== input.id)
      throw new AdminError(
        409,
        'CORRECTION_TARGET',
        'Publish this correction as a revision of its existing catalog entry.',
      )
    const existing = (
      await c.query('SELECT kind FROM catalog_items WHERE id=$1 FOR UPDATE', [
        id,
      ])
    ).rows[0]
    if (existing) {
      const latest = (
        await c.query(
          'SELECT id,data FROM catalog_revisions WHERE item_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
          [id],
        )
      ).rows[0]
      if (
        input.expectedRevision !== latest.id ||
        latest.data.entryType !== snapshot.entryType ||
        existing.kind !== snapshot.kind
      )
        throw new AdminError(
          409,
          'CATALOG_CHANGED',
          'The catalog entry changed or has a different item/entry type. Reload before publishing; generic starters and specific packages need separate entries.',
        )
    } else
      await c.query('INSERT INTO catalog_items(id,kind) VALUES($1,$2)', [
        id,
        snapshot.kind,
      ])
    const revisionId = randomUUID()
    await c.query(
      'INSERT INTO catalog_revisions(id,item_id,data,created_by) VALUES($1,$2,$3,$4)',
      [
        revisionId,
        id,
        JSON.stringify({
          ...snapshot,
          sources: input.sources,
          reviewScope: input.reviewScope,
          reviewedAt: new Date().toISOString(),
        }),
        session.identity_id,
      ],
    )
    await c.query('DELETE FROM catalog_identifiers WHERE item_id=$1', [id])
    if (identifier)
      await c.query(
        'INSERT INTO catalog_identifiers(identifier,item_id,raw,format) VALUES($1,$2,$3,$4)',
        [
          identifier,
          id,
          snapshot.fields.barcode,
          snapshot.fields.barcodeFormat || 'gtin',
        ],
      )
  } else if (input.operation === 'status') {
    if (!input.id || !input.status)
      throw new AdminError(
        400,
        'STATUS_REQUIRED',
        'Choose an entry and its status.',
      )
    await c.query('UPDATE catalog_items SET status=$2 WHERE id=$1', [
      input.id,
      input.status,
    ])
  } else if (!submission)
    throw new AdminError(
      400,
      'SUBMISSION_REQUIRED',
      'Choose a pending submission.',
    )
  if (submission)
    await c.query(
      'UPDATE catalog_submissions SET status=$3,updated_by=$4,updated_at=NOW() WHERE id=$1 AND business_id=$2',
      [
        submission.id,
        submission.business_id,
        input.operation === 'reject' ? 'rejected' : 'approved',
        session.identity_id,
      ],
    )
  await audit(
    c,
    session.identity_id,
    'catalog:' + input.operation,
    id,
    'success',
    reference,
    input.reviewScope,
  )
  return { ok: true, id }
}
