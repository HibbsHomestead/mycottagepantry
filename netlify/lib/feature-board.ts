import { randomUUID } from 'node:crypto'
import type { boardRequests } from '../../db/review/schema'
import {
  boardTitleKey,
  type BoardCommand,
  type BoardDetail,
  type BoardListing,
  type BoardRequest,
} from '../../src/lib/feature-requests'
import type { SupportClient } from './support-core'

export type BoardDb = Pick<SupportClient, 'query'>
export type BoardActor = { id: string; moderator: boolean }
export class BoardError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const moderatorActions = new Set([
  'status',
  'triage',
  'merge',
  'hide',
  'reviewReport',
  'voteLimit',
  'anonymize',
])
const selectCard = `SELECT r.id,r.title,r.use_case,r.category,r.status,r.display_name,r.created_at,
  r.author_id=$1 AS own, r.author_id=$1 AND now()<r.created_at+interval '15 minutes' AS editable,
  r.hidden,r.has_image,r.tags,r.release_url,p.voted,p.following,
  (r.retained_votes+(SELECT count(*) FROM feature_board.participation v WHERE v.request_id=r.id AND v.voted))::int AS votes
  FROM feature_board.requests r LEFT JOIN feature_board.participation p ON p.request_id=r.id AND p.actor_id=$1`

type CardRow = Pick<
  typeof boardRequests.$inferSelect,
  'id' | 'title' | 'category' | 'status' | 'tags' | 'hidden'
> & {
  use_case: string
  display_name: string | null
  release_url: string | null
  created_at: string
  own: boolean | null
  editable: boolean | null
  has_image: boolean
  voted: boolean | null
  following: boolean | null
  votes: number
}

function card(row: CardRow, staff: boolean): BoardRequest {
  return {
    id: row.id,
    title: row.title,
    useCase: row.use_case,
    category: row.category,
    status: row.status,
    displayName: row.display_name || 'Anonymous baker',
    own: !!row.own,
    editable: !!row.editable && !row.hidden,
    votes: row.votes,
    voted: !!row.voted,
    following: !!row.following,
    hasImage: row.has_image,
    tags: row.tags,
    releaseUrl: row.release_url,
    createdAt: row.created_at,
    ...(staff ? { hidden: row.hidden } : {}),
  }
}

export async function listBoard(
  db: BoardDb,
  actor: BoardActor,
  params: URLSearchParams,
  exportAll = false,
): Promise<BoardListing> {
  const search = boardTitleKey((params.get('q') || '').slice(0, 100))
    .split(' ')
    .filter(Boolean)
    .slice(0, 8)
  const sort = params.get('sort')
  const order =
    sort === 'top'
      ? 'votes DESC,r.created_at DESC,r.id'
      : 'r.created_at DESC,r.id'
  const limit = exportAll ? null : 26
  const offset = Math.min(
    25000,
    (Math.max(1, Number.parseInt(params.get('page') || '', 10) || 1) - 1) * 25,
  )
  const { rows } = await db.query(
    `${selectCard}
    WHERE ($2 OR NOT r.hidden) AND r.merged_into IS NULL AND (NOT $3 OR r.author_id=$1)
    AND ($4='' OR r.status=$4) AND ($5='' OR r.category=$5)
    AND NOT EXISTS(SELECT 1 FROM unnest($6::text[]) AS token WHERE
      strpos(r.title_key || ' ' || lower(r.title) || ' ' || lower(r.use_case) || ' ' || lower(array_to_string(r.tags,' ')), token)=0)
    ORDER BY ${order} LIMIT $7 OFFSET $8`,
    [
      actor.id,
      actor.moderator,
      sort === 'mine',
      params.get('status') || '',
      params.get('category') || '',
      search,
      limit,
      offset,
    ],
  )
  const settings = (
    await db.query('SELECT vote_limit FROM feature_board.settings')
  ).rows[0]
  const preference = (
    await db.query(
      'SELECT notifications FROM feature_board.preferences WHERE actor_id=$1',
      [actor.id],
    )
  ).rows[0]
  const inbox = (
    await db.query(
      `SELECT h.id,h.request_id AS "requestId",h.status,r.title
    FROM feature_board.inbox i JOIN feature_board.history h ON h.id=i.event_id
    JOIN feature_board.requests r ON r.id=h.request_id
    WHERE i.actor_id=$1 AND i.read_at IS NULL AND NOT r.hidden ORDER BY h.created_at DESC LIMIT 30`,
      [actor.id],
    )
  ).rows
  const reports = actor.moderator
    ? (
        await db.query(`SELECT p.id,p.request_id AS "requestId",p.comment_id AS "commentId",p.reason,r.title
    FROM feature_board.reports p JOIN feature_board.requests r ON r.id=p.request_id
    WHERE p.reviewed_at IS NULL ORDER BY p.created_at LIMIT 50`)
      ).rows
    : undefined
  return {
    requests: (exportAll ? rows : rows.slice(0, 25)).map((row) =>
      card(row, actor.moderator),
    ),
    voteLimit: settings.vote_limit,
    notifications: !!preference?.notifications,
    inbox,
    reports,
    hasMore: !exportAll && rows.length > 25,
  }
}

export async function boardDetail(
  db: BoardDb,
  actor: BoardActor,
  id: string,
): Promise<BoardDetail> {
  const result = (
    await db.query(
      `WITH RECURSIVE chain AS (
      SELECT id,hidden,merged_into,ARRAY[id] AS path FROM feature_board.requests WHERE id=$2
      UNION ALL SELECT r.id,r.hidden,r.merged_into,c.path||r.id FROM feature_board.requests r JOIN chain c ON r.id=c.merged_into
      WHERE ($3 OR NOT c.hidden) AND NOT r.id=ANY(c.path)
    ) ${selectCard} JOIN chain ON chain.id=r.id WHERE chain.merged_into IS NULL AND ($3 OR NOT chain.hidden)`,
      [actor.id, id, actor.moderator],
    )
  ).rows[0]
  if (!result) throw new BoardError(404, 'Request not found.')
  const comments = (
    await db.query(
      `SELECT id,body,coalesce(display_name,'Anonymous baker') AS "displayName",created_at AS "createdAt",hidden
    FROM feature_board.comments WHERE request_id=$1 AND ($2 OR NOT hidden) ORDER BY created_at DESC LIMIT 100`,
      [result.id, actor.moderator],
    )
  ).rows
  const history = (
    await db.query(
      `SELECT id,status,note,created_at AS "createdAt"
    FROM feature_board.history WHERE request_id=$1 ORDER BY created_at DESC`,
      [result.id],
    )
  ).rows
  return {
    request: card(result, actor.moderator),
    comments,
    history,
    redirected: id !== result.id,
  }
}

export function checkBoardPermission(
  actor: BoardActor,
  action: BoardCommand['action'],
) {
  if (moderatorActions.has(action) !== actor.moderator)
    throw new BoardError(
      403,
      actor.moderator
        ? 'Use your customer sign-in to participate.'
        : 'Verified platform administrator access is required.',
    )
}

const rates: Record<string, [number, number]> = {
  submit: [5, 86400],
  edit: [15, 3600],
  withdraw: [15, 3600],
  comment: [15, 3600],
  vote: [60, 3600],
  follow: [60, 3600],
  report: [10, 3600],
}

export async function limitBoardAction(
  db: BoardDb,
  actor: BoardActor,
  action: BoardCommand['action'],
) {
  const rule = rates[action]
  if (!rule) return
  const [maximum, seconds] = rule
  const row = (
    await db.query(
      `INSERT INTO feature_board.limits(actor_id,action,count,until) VALUES($1,$2,1,now()+$3*interval '1 second')
    ON CONFLICT(actor_id,action) DO UPDATE SET count=CASE WHEN limits.until<=now() THEN 1 ELSE least(limits.count+1,$4+1) END,
    until=CASE WHEN limits.until<=now() THEN excluded.until ELSE limits.until END RETURNING count`,
      [actor.id, action, seconds, maximum],
    )
  ).rows[0]
  if (row.count > maximum)
    throw new BoardError(429, 'Too many attempts. Try again later.')
}

function publicText(value: string, minimum = 1) {
  const plain = value
    .replace(/[\p{Cc}\p{Cf}]/gu, (character) =>
      character === '\n' || character === '\t' ? character : '',
    )
    .trim()
  if (
    plain.length < minimum ||
    /([\p{L}\p{N}!?])\1{9,}/iu.test(plain) ||
    /\b(?:fuck|shit|bitch)\b/i.test(plain)
  )
    throw new BoardError(
      400,
      'Use clear, appropriate text without repeated characters.',
    )
  if ((plain.match(/https?:\/\/\S+/gi)?.length || 0) >= 3)
    throw new BoardError(400, 'Please remove repeated links.')
  return plain
}

function alias(value?: string) {
  if (!value) return null
  const plain = publicText(value)
  if (!/^[\p{L}\p{M}\p{N} .'-]+$/u.test(plain) || /\d{4,}/.test(plain))
    throw new BoardError(400, 'Use a public nickname, not contact information.')
  return plain
}

async function availableTitle(db: BoardDb, title: string, id?: string) {
  const key = boardTitleKey(title)
  if (key.length < 3) throw new BoardError(400, 'Enter a descriptive title.')
  if (
    (
      await db.query(
        'SELECT id FROM feature_board.requests WHERE title_key=$1 AND NOT hidden AND merged_into IS NULL AND id IS DISTINCT FROM $2',
        [key, id || null],
      )
    ).rows.length
  )
    throw new BoardError(
      409,
      'A request with this title already exists. Vote for that request instead.',
    )
  return key
}

async function audit(
  db: BoardDb,
  actor: BoardActor,
  action: string,
  id?: string,
  comment?: string,
  reason?: string,
) {
  await db.query(
    'INSERT INTO feature_board.audit(id,actor_id,action,request_id,comment_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [
      randomUUID(),
      actor.id,
      action,
      id || null,
      comment || null,
      reason || null,
    ],
  )
}

type BoardImages = {
  put: (key: string, bytes: Buffer) => Promise<void>
  remove: (key: string) => Promise<void>
}

export async function changeBoard(
  db: BoardDb,
  actor: BoardActor,
  command: BoardCommand,
  images: BoardImages,
  screenshot?: Buffer,
): Promise<{ id?: string }> {
  checkBoardPermission(actor, command.action)
  const settings = (
    await db.query('SELECT vote_limit FROM feature_board.settings FOR UPDATE')
  ).rows[0]
  if (command.action === 'submit') {
    const title = publicText(command.title, 5)
    const key = await availableTitle(db, title)
    const id = randomUUID()
    await db.query(
      `INSERT INTO feature_board.requests(id,author_id,display_name,title,title_key,use_case,category,has_image)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        actor.id,
        alias(command.displayName),
        title,
        key,
        publicText(command.useCase, 12),
        command.category,
        !!screenshot,
      ],
    )
    await db.query(
      "INSERT INTO feature_board.history(id,request_id,status) VALUES($1,$2,'New')",
      [randomUUID(), id],
    )
    if (screenshot) await images.put(id, screenshot)
    return { id }
  }
  if (command.action === 'preferences') {
    await db.query(
      `INSERT INTO feature_board.preferences(actor_id,notifications) VALUES($1,$2)
      ON CONFLICT(actor_id) DO UPDATE SET notifications=excluded.notifications`,
      [actor.id, command.notifications],
    )
    if (!command.notifications)
      await db.query('DELETE FROM feature_board.inbox WHERE actor_id=$1', [
        actor.id,
      ])
    return {}
  }
  if (command.action === 'read') {
    await db.query(
      'UPDATE feature_board.inbox SET read_at=now() WHERE actor_id=$1 AND event_id=$2',
      [actor.id, command.eventId],
    )
    return {}
  }
  if (command.action === 'voteLimit') {
    await db.query('UPDATE feature_board.settings SET vote_limit=$1', [
      command.limit,
    ])
    await audit(
      db,
      actor,
      'vote_limit',
      undefined,
      undefined,
      command.limit === null ? 'unlimited' : String(command.limit),
    )
    return {}
  }
  if (command.action === 'anonymize') {
    await anonymizeBoardAccount(db, actor, command, images)
    return {}
  }
  if (command.action === 'reviewReport') {
    const row = (
      await db.query(
        'UPDATE feature_board.reports SET reviewed_at=now() WHERE id=$1 AND reviewed_at IS NULL RETURNING request_id,comment_id',
        [command.id],
      )
    ).rows[0]
    if (!row) throw new BoardError(404, 'Open report not found.')
    await audit(
      db,
      actor,
      'report_reviewed',
      row.request_id,
      row.comment_id,
      publicText(command.reason, 3),
    )
    return { id: row.request_id }
  }

  const { id } = command
  const target = (
    await db.query(
      `SELECT *,now()<created_at+interval '15 minutes' AS recent FROM feature_board.requests
    WHERE id=$1 AND merged_into IS NULL AND ($2 OR NOT hidden)`,
      [id, actor.moderator],
    )
  ).rows[0]
  if (!target) throw new BoardError(404, 'Request not found or already merged.')

  switch (command.action) {
    case 'edit':
    case 'withdraw': {
      if (target.author_id !== actor.id || !target.recent)
        throw new BoardError(
          403,
          'Only the author can edit or withdraw a request within 15 minutes.',
        )
      if (command.action === 'withdraw') {
        if (target.has_image) await images.remove(id)
        await db.query(
          'UPDATE feature_board.requests SET hidden=true,has_image=false WHERE id=$1',
          [id],
        )
      } else {
        const title = publicText(command.title, 5)
        await db.query(
          'UPDATE feature_board.requests SET title=$2,title_key=$3,use_case=$4,category=$5,display_name=$6 WHERE id=$1',
          [
            id,
            title,
            await availableTitle(db, title, id),
            publicText(command.useCase, 12),
            command.category,
            alias(command.displayName),
          ],
        )
      }
      return { id }
    }
    case 'vote':
    case 'follow': {
      if (
        command.action === 'vote' &&
        command.enabled &&
        settings.vote_limit !== null
      ) {
        const total = (
          await db.query(
            `SELECT count(*)::int AS total FROM feature_board.participation p JOIN feature_board.requests r ON r.id=p.request_id
          WHERE p.actor_id=$1 AND p.request_id<>$2 AND p.voted AND NOT r.hidden AND r.merged_into IS NULL`,
            [actor.id, id],
          )
        ).rows[0].total
        const already = (
          await db.query(
            'SELECT voted FROM feature_board.participation WHERE request_id=$1 AND actor_id=$2',
            [id, actor.id],
          )
        ).rows[0]?.voted
        if (total >= settings.vote_limit && !already)
          throw new BoardError(
            409,
            `You can vote for up to ${settings.vote_limit} active requests.`,
          )
      }
      const column = command.action === 'vote' ? 'voted' : 'following'
      await db.query(
        `INSERT INTO feature_board.participation(request_id,actor_id,${column}) VALUES($1,$2,$3)
        ON CONFLICT(request_id,actor_id) DO UPDATE SET ${column}=excluded.${column}`,
        [id, actor.id, command.enabled],
      )
      return { id }
    }
    case 'comment':
      await db.query(
        'INSERT INTO feature_board.comments(id,request_id,author_id,display_name,body) VALUES($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          id,
          actor.id,
          alias(command.displayName),
          publicText(command.body, 3),
        ],
      )
      return { id }
    case 'report':
    case 'hide': {
      const comment = command.commentId
      if (
        comment &&
        !(
          await db.query(
            'SELECT id FROM feature_board.comments WHERE id=$1 AND request_id=$2 AND NOT hidden',
            [comment, id],
          )
        ).rows.length
      )
        throw new BoardError(404, 'Comment not found.')
      const reason = publicText(command.reason, 3)
      if (command.action === 'report') {
        await db.query(
          'INSERT INTO feature_board.reports(id,reporter_id,request_id,comment_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [randomUUID(), actor.id, id, comment || null, reason],
        )
      } else {
        if (comment)
          await db.query(
            'UPDATE feature_board.comments SET hidden=true WHERE id=$1',
            [comment],
          )
        else
          await db.query(
            'UPDATE feature_board.requests SET hidden=true WHERE id=$1',
            [id],
          )
        await audit(db, actor, 'hidden', id, comment, reason)
      }
      return { id }
    }
    case 'status': {
      if (target.hidden)
        throw new BoardError(
          409,
          'Hidden requests cannot publish status changes.',
        )
      const note = command.note ? publicText(command.note, 3) : null
      if (command.status === 'Not planned' && !note)
        throw new BoardError(400, 'Enter a public reason for Not planned.')
      if (command.status === target.status) return { id }
      const event = randomUUID()
      await db.query(
        'UPDATE feature_board.requests SET status=$2 WHERE id=$1',
        [id, command.status],
      )
      await db.query(
        'INSERT INTO feature_board.history(id,request_id,actor_id,status,note) VALUES($1,$2,$3,$4,$5)',
        [event, id, actor.id, command.status, note],
      )
      await db.query(
        `INSERT INTO feature_board.inbox(event_id,actor_id) SELECT $2,p.actor_id FROM feature_board.participation p
        JOIN feature_board.preferences pref ON pref.actor_id=p.actor_id AND pref.notifications
        WHERE p.request_id=$1 AND (p.voted OR p.following)`,
        [id, event],
      )
      return { id }
    }
    case 'triage': {
      const title = publicText(command.title, 5)
      await db.query(
        'UPDATE feature_board.requests SET title=$2,title_key=$3,category=$4,tags=$5,release_url=$6 WHERE id=$1',
        [
          id,
          title,
          await availableTitle(db, title, id),
          command.category,
          Array.from(new Set(command.tags.map((tag) => publicText(tag)))),
          command.releaseUrl || null,
        ],
      )
      await audit(db, actor, 'triaged', id)
      return { id }
    }
    case 'merge': {
      const primary = command.targetId
      if (
        id === primary ||
        target.hidden ||
        !(
          await db.query(
            'SELECT id FROM feature_board.requests WHERE id=$1 AND NOT hidden AND merged_into IS NULL',
            [primary],
          )
        ).rows.length
      )
        throw new BoardError(
          400,
          'Choose a different, visible primary request.',
        )
      await db.query(
        `INSERT INTO feature_board.participation(request_id,actor_id,voted,following)
        SELECT $2,actor_id,voted,following FROM feature_board.participation WHERE request_id=$1 AND (voted OR following)
        ON CONFLICT(request_id,actor_id) DO UPDATE SET voted=participation.voted OR excluded.voted,following=participation.following OR excluded.following`,
        [id, primary],
      )
      await db.query(
        `UPDATE feature_board.requests SET retained_votes=retained_votes+$2 WHERE id=$1`,
        [primary, target.retained_votes],
      )
      await db.query(
        'UPDATE feature_board.comments SET request_id=$2 WHERE request_id=$1',
        [id, primary],
      )
      await db.query(
        'UPDATE feature_board.reports SET request_id=$2 WHERE request_id=$1 AND comment_id IS NOT NULL',
        [id, primary],
      )
      await db.query(
        'UPDATE feature_board.requests SET merged_into=$2,retained_votes=0 WHERE id=$1',
        [id, primary],
      )
      await audit(db, actor, 'merged', id, undefined, primary)
      return { id: primary }
    }
  }
}

async function anonymizeBoardAccount(
  db: BoardDb,
  moderator: BoardActor,
  command: Extract<BoardCommand, { action: 'anonymize' }>,
  images: BoardImages,
) {
  const { subject, reviewed = [] } = command
  if (subject === moderator.id)
    throw new BoardError(
      400,
      'A different administrator must perform this action.',
    )
  const requests = (
    await db.query(
      'SELECT id,has_image FROM feature_board.requests WHERE author_id=$1',
      [subject],
    )
  ).rows
  const comments = (
    await db.query('SELECT id FROM feature_board.comments WHERE author_id=$1', [
      subject,
    ])
  ).rows
  const replacement = new Map(reviewed.map((row) => [row.id, row]))
  if (
    replacement.size !== reviewed.length ||
    reviewed.some(
      (row) =>
        !('title' in row ? requests : comments).some(
          (original) => original.id === row.id,
        ),
    )
  )
    throw new BoardError(
      400,
      'Reviewed replacements must belong to this deleted account and may only appear once.',
    )
  for (const row of reviewed) {
    if ('title' in row) {
      publicText(row.title, 5)
      publicText(row.useCase, 12)
    } else publicText(row.body, 3)
  }
  for (const row of requests) if (row.has_image) await images.remove(row.id)
  await db.query(
    `UPDATE feature_board.requests SET author_id=NULL,display_name=NULL,has_image=false,
    title='Anonymized feature request',title_key=id::text,use_case='Original text removed for privacy.',tags='{}',release_url=NULL WHERE author_id=$1`,
    [subject],
  )
  await db.query(
    `UPDATE feature_board.comments SET author_id=NULL,display_name=NULL,body='Original comment removed for privacy.' WHERE author_id=$1`,
    [subject],
  )
  for (const row of reviewed) {
    if ('title' in row)
      await db.query(
        'UPDATE feature_board.requests SET title=$2,use_case=$3 WHERE id=$1',
        [row.id, publicText(row.title, 5), publicText(row.useCase, 12)],
      )
    else
      await db.query('UPDATE feature_board.comments SET body=$2 WHERE id=$1', [
        row.id,
        publicText(row.body, 3),
      ])
  }
  await db.query(
    `UPDATE feature_board.history SET actor_id=NULL,note=NULL WHERE actor_id=$1`,
    [subject],
  )
  await db.query(
    `UPDATE feature_board.requests r SET retained_votes=retained_votes+1 FROM feature_board.participation p
    WHERE p.request_id=r.id AND p.actor_id=$1 AND p.voted AND r.merged_into IS NULL`,
    [subject],
  )
  for (const [table, column] of [
    ['participation', 'actor_id'],
    ['inbox', 'actor_id'],
    ['reports', 'reporter_id'],
    ['preferences', 'actor_id'],
    ['limits', 'actor_id'],
  ])
    await db.query(`DELETE FROM feature_board.${table} WHERE ${column}=$1`, [
      subject,
    ])
  await db.query(
    'UPDATE feature_board.audit SET actor_id=NULL,reason=NULL WHERE actor_id=$1',
    [subject],
  )
  await audit(db, moderator, 'account_content_anonymized')
}
