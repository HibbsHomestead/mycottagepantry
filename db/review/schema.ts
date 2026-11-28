import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { boardCategories, boardStatuses } from '../../src/lib/feature-requests'

const featureBoard = pgSchema('feature_board')
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const boardSettings = featureBoard.table(
  'settings',
  {
    singleton: boolean().primaryKey().default(true),
    voteLimit: integer('vote_limit'),
  },
  (columns) => [
    check('settings_singleton_check', sql`${columns.singleton}`),
    check(
      'settings_vote_limit_check',
      sql`${columns.voteLimit} BETWEEN 1 AND 1000`,
    ),
  ],
)

export const boardRequests = featureBoard.table(
  'requests',
  {
    id: uuid().primaryKey(),
    authorId: text('author_id'),
    displayName: text('display_name'),
    title: text().notNull(),
    titleKey: text('title_key').notNull(),
    useCase: text('use_case').notNull(),
    category: text({ enum: boardCategories }).notNull(),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    status: text({ enum: boardStatuses }).notNull().default('New'),
    releaseUrl: text('release_url'),
    hasImage: boolean('has_image').notNull().default(false),
    hidden: boolean().notNull().default(false),
    mergedInto: uuid('merged_into').references(
      (): AnyPgColumn => boardRequests.id,
    ),
    retainedVotes: integer('retained_votes').notNull().default(0),
    createdAt: createdAt(),
  },
  (columns) => [
    uniqueIndex('board_active_titles')
      .on(columns.titleKey)
      .where(sql`NOT ${columns.hidden} AND ${columns.mergedInto} IS NULL`),
    index('board_request_author').on(columns.authorId),
    check(
      'requests_status_check',
      sql`${columns.status} IN ('New','Under review','Planned','In progress','Shipped','Not planned')`,
    ),
    check('requests_retained_votes_check', sql`${columns.retainedVotes} >= 0`),
    check(
      'requests_check',
      sql`${columns.mergedInto} IS DISTINCT FROM ${columns.id}`,
    ),
  ],
)

export const boardParticipation = featureBoard.table(
  'participation',
  {
    requestId: uuid('request_id')
      .notNull()
      .references(() => boardRequests.id),
    actorId: text('actor_id').notNull(),
    voted: boolean().notNull().default(false),
    following: boolean().notNull().default(false),
  },
  (columns) => [
    primaryKey({ columns: [columns.requestId, columns.actorId] }),
    index('board_participation_actor').on(columns.actorId),
  ],
)

export const boardComments = featureBoard.table(
  'comments',
  {
    id: uuid().primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => boardRequests.id),
    authorId: text('author_id'),
    displayName: text('display_name'),
    body: text().notNull(),
    hidden: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (columns) => [
    index('board_comment_request').on(columns.requestId, columns.createdAt),
    index('board_comment_author').on(columns.authorId),
  ],
)

export const boardHistory = featureBoard.table(
  'history',
  {
    id: uuid().primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => boardRequests.id),
    actorId: text('actor_id'),
    status: text({ enum: boardStatuses }).notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (columns) => [
    index('board_history_request').on(columns.requestId, columns.createdAt),
  ],
)

export const boardInbox = featureBoard.table(
  'inbox',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => boardHistory.id),
    actorId: text('actor_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (columns) => [
    primaryKey({ columns: [columns.eventId, columns.actorId] }),
    index('board_inbox_actor').on(columns.actorId),
  ],
)

export const boardPreferences = featureBoard.table('preferences', {
  actorId: text('actor_id').primaryKey(),
  notifications: boolean().notNull().default(false),
})

export const boardReports = featureBoard.table(
  'reports',
  {
    id: uuid().primaryKey(),
    reporterId: text('reporter_id').notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => boardRequests.id),
    commentId: uuid('comment_id').references(() => boardComments.id),
    reason: text().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (columns) => [
    uniqueIndex('board_unique_report').on(
      columns.reporterId,
      columns.requestId,
      sql`COALESCE(${columns.commentId},'00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
)

export const boardAudit = featureBoard.table('audit', {
  id: uuid().primaryKey(),
  actorId: text('actor_id'),
  action: text().notNull(),
  requestId: uuid('request_id').references(() => boardRequests.id),
  commentId: uuid('comment_id').references(() => boardComments.id),
  reason: text(),
  createdAt: createdAt(),
})

export const boardLimits = featureBoard.table(
  'limits',
  {
    actorId: text('actor_id').notNull(),
    action: text().notNull(),
    count: integer().notNull(),
    until: timestamp({ withTimezone: true }).notNull(),
  },
  (columns) => [primaryKey({ columns: [columns.actorId, columns.action] })],
)
