import { aiEnabled } from './feature-flags'
import { parseCookBook } from '../../src/lib/cookbook'
import { cookBookArchive } from './cookbook'
import { randomUUID, createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { getStore } from '@netlify/blobs'
import {
  recipeDraftSchema,
  recipeApprovalBlockers,
  parseRecipeText,
  suggestIngredient,
  lineIssues,
  measurement,
  duplicateRecipes,
  recipeMethod,
  reprocessRecipeDraft,
  separateExtractedContent,
} from '../../src/lib/recipe-import'
import { baseUnit, type Item, type Workspace } from '../../src/lib/domain'
import {
  cookbookAdapters,
  fetchRecipeUrl,
  recipesFromHtml,
  recipeUpload,
  extractRecipeDocument,
} from './recipe-import'
import { extractionFailure } from './receipt-extraction'
type Context = {
  client: any
  org: string
  role: string
  actor: string
  state: Workspace
  save: (table: string, item: Item) => Promise<void>
  stage?: (stage: string) => void
}
export class RecipeImportError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export async function handleRecipeImport(req: Request, c: Context) {
  const { client, org, role, actor, state, save } = c,
    url = new URL(req.url),
    canEdit = ['Owner', 'Manager'].includes(role)
  const rows = await client.query(
    "SELECT data FROM recipe_imports WHERE business_id=$1 ORDER BY (data->>'status' IN ('approved','cancelled')) ASC, created_at DESC LIMIT 200",
    [org],
  )
  const records = rows.rows.map((r: any) => r.data) as any[]
  const put = async (record: any) => {
    record.updatedAt = new Date(
      Math.max(Date.now(), (Date.parse(record.updatedAt) || 0) + 1),
    ).toISOString()
    record.updatedBy = actor
    await client.query(
      'INSERT INTO recipe_imports(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,updated_at=NOW()',
      [record.id, org, JSON.stringify(record)],
    )
  }
  const json = async (data: any, status = 200) => {
    await client.query('COMMIT')
    return Response.json(data, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  if (req.method === 'GET') {
    const id = url.searchParams.get('recipeImportFile')
    if (id) {
      const stored = await client.query(
        'SELECT data FROM recipe_imports WHERE business_id=$1 AND id=$2',
        [org, id],
      )
      const record = stored.rows
        .map((r: any) => r.data)
        .find((d: any) => d.id === id)
      if (!record || !record.originalKey)
        throw new Error('Import source not found in this oven.')
      if (!record.originalKey.startsWith(org + '/'))
        throw new Error('Invalid import file reference.')
      const bytes = await getStore('recipe-import-files').get(
        record.originalKey,
        { type: 'arrayBuffer' },
      )
      if (!bytes)
        return json({ error: 'Original import file is unavailable.' }, 404)
      await client.query('COMMIT')
      return new Response(bytes, {
        headers: {
          'Content-Type':
            record.mime === 'text/html'
              ? 'text/plain; charset=utf-8'
              : record.mime,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition':
            url.searchParams.has('download') ||
            record.mime === 'application/zip'
              ? `attachment; filename="recipe-source.${({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/zip': 'zip' } as any)[record.mime] || 'txt'}"`
              : 'inline',
        },
      })
    }
    if (url.searchParams.has('id')) {
      const id = url.searchParams.get('id')
      const stored = await client.query(
        'SELECT data FROM recipe_imports WHERE business_id=$1 AND id=$2',
        [org, id],
      )
      const record = stored.rows
        .map((r: any) => r.data)
        .find((d: any) => d.id === id)
      if (!record)
        return json({ error: 'Import draft not found in this oven.' }, 404)
      return json({ import: record })
    }
    return json({
      imports: records.map((r) => ({
        id: r.id,
        draft: { title: r.draft.title, sourceId: r.draft.sourceId || '' },
        sourceUrl: r.sourceUrl,
        sourceHash: r.sourceHash,
        status: r.status,
        filename: r.filename,
        method: r.method,
        summary: true,
      })),
      cookbookProviders: cookbookAdapters.filter((p) => p.enabled),
      canEdit,
    })
  }
  if (!canEdit)
    throw new Error('An Owner or Manager must import or approve recipes.')
  const multipart = (req.headers.get('content-type') || '').startsWith(
    'multipart/form-data',
  )
  const body = multipart ? null : await req.json()
  if (
    !multipart &&
    ['save', 'approve', 'cancel', 'previewReprocess', 'reprocess'].includes(
      body.operation,
    )
  ) {
    c.stage?.('draft_lookup')
    // A reopened draft must not depend on the queue's pagination limit.
    const stored = await client.query(
      'SELECT data FROM recipe_imports WHERE business_id=$1 AND id=$2 FOR UPDATE',
      [org, body.id],
    )
    const record = stored.rows
      .map((r: any) => r.data)
      .find((d: any) => d.id === body.id)
    if (!record)
      throw new RecipeImportError(
        'IMPORT_NOT_FOUND',
        404,
        'Import draft not found in this oven. Your edits remain open.',
      )
    if (
      record.status === 'approved' &&
      ['previewReprocess', 'reprocess'].includes(body.operation)
    )
      throw new Error(
        'Approved recipes cannot be repaired by reprocessing an import. Review the existing recipe separately; no duplicate was created.',
      )
    if (record.status === 'approved')
      return json({
        import: record,
        recipeId: record.recipeId,
        alreadyApproved: true,
      })
    if (record.status === 'cancelled')
      throw new Error(
        'This import was cancelled. Start a new import to continue.',
      )
    c.stage?.('revision_check')
    // A response can be lost after COMMIT. Retrying the identical save is safe,
    // while different edits from a stale window still require review.
    const parsed =
      body.operation === 'save' ? recipeDraftSchema.safeParse(body.draft) : null
    if (
      body.operation === 'save' &&
      parsed?.success &&
      isDeepStrictEqual(parsed.data, record.draft)
    )
      return json({ import: record, alreadySaved: true })
    if (body.expectedUpdatedAt !== record.updatedAt)
      throw new RecipeImportError(
        'IMPORT_REVISION_CONFLICT',
        409,
        'This import changed in another window. Reopen it before saving or approving.',
      )
    if (body.operation === 'cancel') {
      record.status = 'cancelled'
      await put(record)
      return json({ import: record })
    }
    c.stage?.('draft_validation')
    const draft = recipeDraftSchema.parse(body.draft)
    if (['previewReprocess', 'reprocess'].includes(body.operation)) {
      if (
        !record.sourceText ||
        !['text/plain', 'application/zip', 'text/html'].includes(record.mime)
      )
        throw new Error(
          'Readable preserved source text is unavailable for safe local reprocessing. Review the original file manually; no paid extraction is started.',
        )
      const repair = reprocessRecipeDraft(
        draft,
        record.sourceText,
        state.ingredients,
      )
      if (!repair.draft.sourceUrl)
        repair.draft.sourceUrl = record.sourceUrl || ''
      if (body.operation === 'previewReprocess') return json({ repair })
      if (body.confirmReplaceEdits !== true)
        throw new Error(
          'Review the proposed repair and confirm before replacing draft edits.',
        )
      record.reprocessPreviousDraft = draft
      record.draft = repair.draft
      record.sourceUrl = repair.draft.sourceUrl
      record.status = 'needs_review'
      record.error = ''
      record.reprocessedAt = new Date().toISOString()
      await put(record)
      return json({ import: record, repair })
    }
    if (!draft.sourceUrl) draft.sourceUrl = record.sourceUrl || ''
    record.draft = draft
    record.sourceUrl = draft.sourceUrl
    if (body.operation === 'save') {
      c.stage?.('draft_write')
      await put(record)
      c.stage?.('commit')
      return json({ import: record })
    }
    c.stage?.('approval_validation')
    const blockers = recipeApprovalBlockers(
      draft,
      record.sourceText || '',
      state.ingredients,
    )
    if (blockers.length)
      throw new Error(blockers.map((b) => b.message).join(' '))
    const duplicates = duplicateRecipes(
      draft,
      record.sourceUrl || '',
      state.recipes,
      record.sourceHash,
    )
    if (
      duplicates.length &&
      !['copy', 'version'].includes(body.duplicateDecision)
    )
      throw new Error(
        'Possible duplicate: choose Import as a copy or review a new version.',
      )
    if (
      body.duplicateDecision === 'version' &&
      !duplicates.some((r) => r.id === body.targetRecipeId)
    )
      throw new Error(
        'Choose an existing matching recipe for the reviewed version.',
      )
    const recipeId = 'import-' + record.id,
      ingredients = [...state.ingredients]
    if (state.recipes.some((r) => r.id === recipeId))
      throw new Error(
        'This recipe identifier is already in use. No existing recipe was changed.',
      )
    const lines: any[] = []
    for (const [index, line] of draft.lines.entries()) {
      let ingredient = ingredients.find((i) => i.id === line.ingredientId)
      if (
        line.decision === 'match' &&
        (!ingredient || ['packaging', 'supply'].includes(ingredient.usedAs))
      )
        throw new Error(
          'Choose a Pantry ingredient in this oven for every matched line.',
        )
      if (line.decision === 'new') {
        if (['package', 'case'].includes(line.unit))
          throw new Error(
            'Confirm physical package contents and choose a known storage unit before creating a Pantry ingredient.',
          )
        if (ingredients.some((i) => i.id === `${recipeId}-ingredient-${index}`))
          throw new Error(
            'An ingredient with this import identifier already exists. No record was overwritten.',
          )
        const canonical = baseUnit(line.unit)
        ingredient = {
          id: `${recipeId}-ingredient-${index}`,
          name: line.name.trim(),
          usedAs: 'ingredient',
          category: 'Imported — needs review',
          unit: canonical,
          storageUnit: line.unit,
          recipeUnit: line.unit,
          quantity: 0,
          cost: 0,
          currentCost: null,
          packagePrice: null,
          purchaseQuantity: null,
          needsCostSetup: true,
          threshold: 0,
          conversions: [],
          allergens: [],
          reviewed: false,
          notes:
            'Created with recipe import approval. Purchase/cost details and label/allergen review are required. No opening stock or purchase was recorded.',
        }
        await save('ingredients', ingredient)
        ingredients.push(ingredient)
      }
      if (!ingredient)
        throw new Error('Resolve each Pantry ingredient before approval.')
      const m = measurement(line)
      lines.push({
        ...m,
        ingredientId: ingredient.id,
        group: line.group,
        original: line.original,
        preparation: line.preparation,
        uncertainty: line.uncertainty,
        cupStandard: line.cupStandard,
      })
    }
    const costIssues = draft.lines.filter(
      (l, index) =>
        lineIssues(
          {
            ...l,
            decision: 'match',
            ingredientId: lines[index].ingredientId,
            confirmed: true,
          },
          ingredients,
        ).length,
    ).length
    const recipe: Item = {
      id: recipeId,
      name: draft.title.trim(),
      description: draft.description,
      category: 'Imported',
      yield: draft.yieldQuantity,
      yieldUnit: draft.yieldUnit,
      lines,
      instructions: recipeMethod(draft),
      optionalAdditions: draft.optionalAdditions,
      sourceUrl: draft.sourceUrl,
      sourceAttribution: draft.sourceAttribution,
      prepMinutes: draft.prepMinutes,
      cookMinutes: draft.cookMinutes,
      notes: draft.notes,
      author: draft.author,
      laborMinutes: 0,
      laborRate: 0,
      overhead: 0,
      importCostIssues: costIssues,
      importProvenance: {
        importId: record.id,
        sourceUrl: record.sourceUrl || '',
        sourceHash: record.sourceHash,
        sourceId: draft.sourceId,
        sourceApp: draft.sourceApp || record.method,
        importedAt: record.createdAt,
        approvedAt: new Date().toISOString(),
        approvedBy: actor,
      },
      supersedesRecipeId:
        body.duplicateDecision === 'version' ? body.targetRecipeId : null,
    }
    c.stage?.('recipe_write')
    await save('recipes', recipe)
    record.status = 'approved'
    record.recipeId = recipeId
    record.approvedBy = actor
    record.approvedAt = new Date().toISOString()
    c.stage?.('approval_write')
    await put(record)
    await save('activity', {
      id: randomUUID(),
      name: 'Recipe import approved',
      detail: draft.title,
      date: new Date().toISOString().slice(0, 10),
      type: 'recipeImport',
      actor,
    })
    c.stage?.('commit')
    return json({ import: record, recipeId })
  }
  if (
    records.filter((r) => !['cancelled', 'approved'].includes(r.status))
      .length >= 100
  )
    throw new Error(
      'Review or cancel existing imports before adding more (100 active drafts maximum).',
    )
  const recent = records.filter(
    (r) => Date.now() - Date.parse(r.createdAt) < 3600000,
  )
  if (recent.length >= 20)
    throw new Error(
      'Up to 20 recipe imports per oven per hour are available. Try again later.',
    )
  const sourceId = randomUUID(),
    createdAt = new Date().toISOString()
  let original: Buffer,
    mime = 'text/plain',
    sourceText = '',
    sourceUrl = '',
    filename = '',
    method = 'Pasted text',
    drafts = [],
    error = '',
    status = 'needs_review'
  let cookbookEntries: { draft: any; sourceUrl: string; text: string }[] = []
  if (multipart) {
    const form = await req.formData(),
      file = form.get('file')
    if (!(file instanceof File)) throw new Error('Choose a recipe file.')
    if (form.get('provider') === 'cookbook') {
      original = Buffer.from(await file.arrayBuffer())
      if (original.length > 5_000_000)
        throw new Error('Use a CookBook file under 5 MB.')
      const entries =
        original.subarray(0, 2).toString() === 'PK'
          ? await cookBookArchive(original)
          : [
              {
                ...parseCookBook(original.toString('utf8')),
                text: original.toString('utf8'),
              },
            ]
      cookbookEntries = entries
      drafts = entries.map((e) => e.draft)
      sourceText = entries.map((e) => e.text).join('\n\n')
      sourceUrl = entries.length === 1 ? entries[0].sourceUrl : ''
      mime =
        original.subarray(0, 2).toString() === 'PK'
          ? 'application/zip'
          : 'text/plain'
      filename = file.name.slice(0, 200)
      method = 'CookBook Manager export'
    } else {
      const upload = await recipeUpload(file)
      original = upload.bytes
      mime = upload.mime
      sourceText = upload.text
      filename = file.name.slice(0, 200)
      method = 'File upload'
      if (sourceText) drafts = [parseRecipeText(sourceText)]
      else if (!aiEnabled()) {
        status = 'needs_review'
        error =
          'Automatic document reading is unavailable. Your original is preserved; paste its recipe text or enter the details manually.'
        drafts = [recipeDraftSchema.parse({})]
      } else
        try {
          drafts = await extractRecipeDocument(original, mime)
        } catch (e) {
          const failure = extractionFailure(e)
          status = failure.status
          error =
            failure.status === 'not_configured'
              ? 'Recipe extraction is not configured. Enable AI Gateway for this site or configure the supported server-side Gemini provider. You can still paste text or enter details manually.'
              : 'We couldn’t extract recipe details. You can still review the original and enter details manually.'
          drafts = [recipeDraftSchema.parse({})]
        }
    }
  } else if (body?.operation === 'create' && body.kind === 'cookbook') {
    sourceText = String(body.text || '')
    if (!sourceText || sourceText.length > 60000)
      throw new Error('Paste up to 60,000 characters.')
    const parsed = parseCookBook(sourceText)
    drafts = [parsed.draft]
    sourceUrl = parsed.sourceUrl
    original = Buffer.from(sourceText)
    method = 'CookBook Manager shared text'
  } else if (body?.operation === 'create' && body.kind === 'text') {
    sourceText = String(body.text || '')
    if (!sourceText.trim() || sourceText.length > 60000)
      throw new Error('Paste recipe text of 1–60,000 characters.')
    original = Buffer.from(sourceText)
    drafts = [parseRecipeText(sourceText)]
  } else if (body?.operation === 'create' && body.kind === 'url') {
    const fetched = await fetchRecipeUrl(String(body.url || ''))
    original = fetched.bytes
    mime = fetched.mime
    sourceUrl = fetched.url
    method = 'Recipe link'
    if (mime === 'text/html') {
      const parsed = recipesFromHtml(original.toString('utf8'))
      sourceText = parsed.text
      drafts = parsed.recipes.length
        ? parsed.recipes
        : [parseRecipeText(sourceText)]
    } else if (mime === 'application/ld+json') {
      const parsed = recipesFromHtml(
        '<script type="application/ld+json">' +
          original.toString('utf8').replace(/<\/script/gi, '<\\/script') +
          '</script>',
      )
      sourceText = original.toString('utf8')
      drafts = parsed.recipes.length
        ? parsed.recipes
        : [recipeDraftSchema.parse({})]
    } else {
      sourceText = original.toString('utf8').slice(0, 60000)
      drafts = [parseRecipeText(sourceText)]
    }
  } else
    throw new Error(
      'Choose file upload, pasted text or a public recipe link. No cookbook account integration is currently connected.',
    )
  if (
    recent.length + drafts.length > 20 ||
    records.filter((r) => !['approved', 'cancelled'].includes(r.status))
      .length +
      drafts.length >
      100
  )
    throw new Error(
      'This source exceeds the remaining import queue limit. Review existing drafts before importing it.',
    )
  const originalKey = `${org}/${sourceId}/original`
  await getStore('recipe-import-files').set(
    originalKey,
    new Uint8Array(original).buffer,
  )
  const imports = []
  for (const extracted of drafts.slice(0, 10)) {
    const draft = separateExtractedContent(extracted)
    if (!draft.sourceUrl)
      draft.sourceUrl =
        cookbookEntries.find((e) => e.draft === extracted)?.sourceUrl ||
        sourceUrl
    for (const line of draft.lines) {
      const matches = suggestIngredient(line, state.ingredients)
      if (matches.length === 1) {
        line.ingredientId = matches[0].id
        line.decision = 'match'
      }
    }
    const record = {
      id: randomUUID(),
      name: draft.title || filename || 'Untitled recipe import',
      draft,
      status,
      error,
      sourceUrl: draft.sourceUrl,
      sourceText:
        cookbookEntries.find((e) => e.draft === extracted)?.text || sourceText,
      filename,
      mime,
      method,
      originalKey,
      sourceHash: createHash('sha256')
        .update(
          cookbookEntries.find((e) => e.draft === extracted)?.text || original,
        )
        .digest('hex'),
      createdAt,
      createdBy: actor,
      updatedAt: createdAt,
    }
    await put(record)
    imports.push(record)
  }
  return json({ imports })
}
