import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { admin, AuthError } from '@netlify/identity'
import sharp from 'sharp'
import { z } from 'zod'
import { boardCommand } from '../../src/lib/feature-requests'
import {
  AdminError,
  adminTransaction,
  hasRecentAdminVerification,
  requireAdmin,
  requireAdminOrigin,
} from './platform-admin-core'
import { deploymentRuntime, serverEnvironment } from './runtime-environment'
import {
  limitedBody,
  privateHeaders,
  supportActor,
  SupportError,
  type SupportClient,
} from './support-core'
import {
  BoardError,
  boardDetail,
  changeBoard,
  checkBoardPermission,
  limitBoardAction,
  listBoard,
  type BoardActor,
} from './feature-board'

const responseHeaders = {
  ...privateHeaders(),
  'X-Robots-Tag': 'noindex',
  'Content-Security-Policy':
    "default-src 'none'; frame-ancestors 'none'; sandbox",
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: responseHeaders })
const store = () =>
  getStore({ name: 'feature-board-public-screenshots', consistency: 'strong' })

async function identify(
  request: Request,
  moderator: boolean,
): Promise<BoardActor> {
  if (!moderator) return { id: (await supportActor()).id, moderator: false }
  requireAdminOrigin(request)
  return adminTransaction(async (db) => {
    const session = await requireAdmin(db, request)
    if (
      !['owner', 'admin'].includes(session.role) ||
      !hasRecentAdminVerification(session)
    )
      throw new BoardError(
        403,
        'Open the administration portal and renew administrator verification.',
      )
    return { id: session.identity_id, moderator: true }
  })
}

async function cleanScreenshot(value: string) {
  const input =
    /^data:image\/(?:png|jpe?g|webp);base64,([a-z0-9+/]+={0,2})$/i.exec(value)
  if (!input)
    throw new BoardError(400, 'Choose a PNG, JPEG, or WebP screenshot.')
  const buffer = Buffer.from(input[1], 'base64')
  if (buffer.byteLength > 2 * 1024 * 1024)
    throw new BoardError(413, 'Choose a screenshot under 2 MB.')
  try {
    const image = sharp(buffer, {
      limitInputPixels: 16_777_216,
      failOn: 'error',
    })
    const { format, pages } = await image.metadata()
    if (
      !format ||
      !['png', 'jpeg', 'webp'].includes(format) ||
      (pages ?? 1) !== 1
    )
      throw new Error('Unsupported image')
    return await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 84 })
      .toBuffer()
  } catch {
    throw new BoardError(
      400,
      'Choose a still PNG, JPEG, or WebP screenshot under 16 megapixels.',
    )
  }
}

export function boardCsvCell(value: string | number) {
  const text = String(value)
  return `"${(/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`
}

export async function handleFeatureBoard(request: Request) {
  const url = new URL(request.url)
  const enabled =
    ['dev', 'deploy-preview'].includes(deploymentRuntime().context || '') &&
    serverEnvironment('FEATURE_BOARD_REVIEW_ENABLED') === 'true'
  if (request.method === 'GET' && url.searchParams.has('availability'))
    return json({ enabled })
  if (!enabled)
    return json({ error: 'The feature board is not open yet.' }, 404)
  try {
    const write = request.method === 'POST'
    if (!write && request.method !== 'GET')
      throw new BoardError(405, 'Method not allowed.')
    if (
      ['cross-site', 'same-site'].includes(
        request.headers.get('sec-fetch-site') || '',
      ) ||
      (write && request.headers.get('origin') !== url.origin)
    )
      throw new BoardError(403, 'Open the board directly in Cottage Pantry.')
    if (
      write &&
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get('content-type') || '',
      )
    )
      throw new BoardError(415, 'Use a JSON request.')
    const actor = await identify(request, url.searchParams.get('admin') === '1')
    const db = (await getDatabase().pool.connect()) as SupportClient
    let uploaded: string | undefined
    let transaction = false
    try {
      if (write) {
        let raw: unknown
        try {
          raw = JSON.parse((await limitedBody(request, 2_820_000)).toString())
        } catch (error) {
          if (error instanceof SupportError) throw error
          throw new BoardError(400, 'The request could not be read.')
        }
        const command = boardCommand.parse(raw)
        checkBoardPermission(actor, command.action)
        await limitBoardAction(db, actor, command.action)
        if (command.action === 'anonymize') {
          try {
            await admin.getUser(command.subject)
            throw new BoardError(
              409,
              'This Identity account still exists. Complete verified deletion first.',
            )
          } catch (error) {
            if (error instanceof BoardError) throw error
            if (!(error instanceof AuthError && error.status === 404))
              throw new BoardError(
                503,
                'Account deletion could not be verified. No board records were changed.',
              )
          }
        }
        const screenshot =
          command.action === 'submit' && command.image
            ? await cleanScreenshot(command.image)
            : undefined
        await db.query('BEGIN')
        transaction = true
        const result = await changeBoard(
          db,
          actor,
          command,
          {
            put: async (key, bytes) => {
              uploaded = key
              await store().set(key, new Uint8Array(bytes).buffer)
            },
            remove: (key) => store().delete(key),
          },
          screenshot,
        )
        await db.query('COMMIT')
        return json(result)
      }
      const id = url.searchParams.get('id')
      const image = url.searchParams.get('image')
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      transaction = true
      let response: Response
      if (image) {
        const imageId = z.uuid().parse(image)
        const row = (
          await db.query(
            'SELECT has_image FROM feature_board.requests WHERE id=$1 AND ($2 OR NOT hidden) AND merged_into IS NULL',
            [imageId, actor.moderator],
          )
        ).rows[0]
        const bytes = row?.has_image
          ? await store().get(imageId, { type: 'arrayBuffer' })
          : null
        if (!bytes) throw new BoardError(404, 'Screenshot not found.')
        response = new Response(bytes, {
          headers: { ...responseHeaders, 'Content-Type': 'image/webp' },
        })
      } else if (id)
        response = json(await boardDetail(db, actor, z.uuid().parse(id)))
      else if (url.searchParams.has('export')) {
        if (!actor.moderator)
          throw new BoardError(
            403,
            'Only verified platform administrators can export the board.',
          )
        const board = await listBoard(db, actor, new URLSearchParams(), true)
        const lines = board.requests.map((row) =>
          [
            row.id,
            row.title,
            row.useCase,
            row.category,
            row.status,
            row.votes,
            row.hidden ? 'Hidden' : 'Visible',
            new Date(row.createdAt).toISOString(),
          ]
            .map(boardCsvCell)
            .join(','),
        )
        response = new Response(
          [
            'ID,Title,Use case,Category,Status,Votes,Visibility,Submitted',
            ...lines,
          ].join('\r\n'),
          {
            headers: {
              ...responseHeaders,
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition':
                'attachment; filename="feature-requests.csv"',
            },
          },
        )
      } else response = json(await listBoard(db, actor, url.searchParams))
      await db.query('COMMIT')
      return response
    } catch (error) {
      if (transaction) await db.query('ROLLBACK').catch(() => undefined)
      if (uploaded)
        await store()
          .delete(uploaded)
          .catch(() => undefined)
      throw error
    } finally {
      db.release()
    }
  } catch (error) {
    if (
      error instanceof BoardError ||
      error instanceof AdminError ||
      error instanceof SupportError
    )
      return json({ error: error.message }, error.status)
    if (error instanceof z.ZodError)
      return json(
        {
          error:
            'Check your entries. Titles are 5–100 characters, use cases 12–2,000, and comments 3–1,000.',
        },
        400,
      )
    return json({ error: 'The feature board is temporarily unavailable.' }, 503)
  }
}
