import { sql } from 'drizzle-orm'
import {
  check,
  pgTable,
  primaryKey,
  bigint,
  serial,
  integer,
  index,
  text,
  timestamp,
  jsonb,
  uuid,
  numeric,
  boolean,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
export const businesses = pgTable('businesses', {
  id: uuid().defaultRandom().primaryKey(),
  businessName: text('business_name').notNull(),
  identityOwner: text('identity_owner').unique(),
  sessionHash: text('session_hash').unique(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
const base = () => ({
  id: text().notNull(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  data: jsonb().$type<Record<string, any>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdBy: text('created_by').notNull().default('owner'),
  updatedBy: text('updated_by').notNull().default('owner'),
})
const orgTable = (name: string) =>
  pgTable(name, base(), (t) => [
    uniqueIndex(`${name}_org_id`).on(t.businessId, t.id),
  ])
export const users = pgTable(
  'users',
  {
    ...base(),
    identityId: text('identity_id').notNull(),
    role: text().notNull().default('Owner'),
    active: boolean().default(true),
  },
  (t) => [
    uniqueIndex('users_org_id').on(t.businessId, t.id),
    uniqueIndex('users_identity').on(t.identityId, t.businessId),
  ],
)
export const vendors = orgTable('vendors')
export const units = orgTable('units')
export const ingredients = pgTable(
  'ingredients',
  {
    ...base(),
    quantity: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    cost: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
  },
  (t) => [uniqueIndex('ingredients_org_id').on(t.businessId, t.id)],
)
export const inventoryCounts = orgTable('inventory_counts')
export const ingredientConversions = orgTable('ingredient_conversions')
export const compoundIngredientLines = orgTable('compound_ingredient_lines')
export const recipes = orgTable('recipes')
export const recipeImports = orgTable('recipe_imports')
export const recipeLines = pgTable(
  'recipe_lines',
  {
    ...base(),
    recipeId: text('recipe_id').notNull(),
    ingredientId: text('ingredient_id').notNull(),
    quantity: numeric({ precision: 20, scale: 8 }).notNull(),
    unit: text().notNull(),
  },
  (t) => [
    uniqueIndex('recipe_lines_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.recipeId],
      foreignColumns: [recipes.businessId, recipes.id],
    }),
    foreignKey({
      columns: [t.businessId, t.ingredientId],
      foreignColumns: [ingredients.businessId, ingredients.id],
    }),
  ],
)
export const products = pgTable(
  'products',
  {
    ...base(),
    recipeId: text('recipe_id'),
    quantity: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    cost: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
  },
  (t) => [
    uniqueIndex('products_org_id').on(t.businessId, t.id),
    check('products_nonnegative_stock', sql`${t.quantity} >= 0`),
    check('products_nonnegative_cost', sql`${t.cost} >= 0`),
    foreignKey({
      columns: [t.businessId, t.recipeId],
      foreignColumns: [recipes.businessId, recipes.id],
    }),
  ],
)
export const productPackagingLines = pgTable(
  'product_packaging_lines',
  {
    ...base(),
    productId: text('product_id').notNull(),
    ingredientId: text('ingredient_id').notNull(),
    quantity: numeric({ precision: 20, scale: 8 }).notNull(),
  },
  (t) => [
    uniqueIndex('product_packaging_lines_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.productId],
      foreignColumns: [products.businessId, products.id],
    }),
    foreignKey({
      columns: [t.businessId, t.ingredientId],
      foreignColumns: [ingredients.businessId, ingredients.id],
    }),
  ],
)
export const batchPlans = orgTable('batch_plans')
export const batchPlanLines = orgTable('batch_plan_lines')
export const batches = pgTable(
  'batches',
  { ...base(), recipeId: text('recipe_id').notNull() },
  (t) => [
    uniqueIndex('batches_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.recipeId],
      foreignColumns: [recipes.businessId, recipes.id],
    }),
  ],
)
export const batchUsage = orgTable('batch_usage')
export const lots = orgTable('lots')
export const ledger = pgTable(
  'ledger',
  {
    ...base(),
    ingredientId: text('ingredient_id'),
    productId: text('product_id'),
  },
  (t) => [
    uniqueIndex('ledger_org_id').on(t.businessId, t.id),
    index('ledger_product_stock')
      .on(t.businessId, t.productId)
      .where(sql`${t.productId} IS NOT NULL`),
    check(
      'ledger_one_stock_identity',
      sql`(${t.ingredientId} IS NULL) <> (${t.productId} IS NULL)`,
    ),
    foreignKey({
      columns: [t.businessId, t.productId],
      foreignColumns: [products.businessId, products.id],
    }),
    foreignKey({
      columns: [t.businessId, t.ingredientId],
      foreignColumns: [ingredients.businessId, ingredients.id],
    }),
  ],
)
export const orders = orgTable('orders')
export const orderLines = orgTable('order_lines')
export const expenses = orgTable('expenses')
export const sales = pgTable(
  'sales',
  { ...base(), productId: text('product_id') },
  (t) => [
    uniqueIndex('sales_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.productId],
      foreignColumns: [products.businessId, products.id],
    }),
  ],
)
export const accounts = orgTable('accounts')
export const journals = orgTable('journals')
export const journalLines = orgTable('journal_lines')
export const activity = orgTable('activity')
export const settings = orgTable('settings')
export const integrations = orgTable('integrations')

// Tax configuration is editable; completed sales retain independent JSON snapshots.
export const taxRates = orgTable('tax_rates')
export const productTaxAssignments = pgTable(
  'product_tax_assignments',
  {
    ...base(),
    productId: text('product_id').notNull(),
    taxRateId: text('tax_rate_id').notNull(),
  },
  (t) => [
    uniqueIndex('product_tax_assignments_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.productId],
      foreignColumns: [products.businessId, products.id],
    }),
    foreignKey({
      columns: [t.businessId, t.taxRateId],
      foreignColumns: [taxRates.businessId, taxRates.id],
    }),
  ],
)

// Label Studio documents retain editable JSON and relational organization keys.
export const labelTemplates = pgTable(
  'label_templates',
  { ...base(), productId: text('product_id') },
  (t) => [
    uniqueIndex('label_templates_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.productId],
      foreignColumns: [products.businessId, products.id],
    }),
  ],
)
export const labelRecoveryDrafts = pgTable(
  'label_recovery_drafts',
  {
    ...base(),
    identityId: text('identity_id').notNull(),
    labelId: text('label_id').notNull(),
  },
  (t) => [uniqueIndex('label_recovery_drafts_org_id').on(t.businessId, t.id)],
)
export const brandKits = orgTable('brand_kits')
export const graphicAssets = orgTable('graphic_assets')
export const labelElements = pgTable(
  'label_elements',
  { ...base(), templateId: text('template_id').notNull() },
  (t) => [
    uniqueIndex('label_elements_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.templateId],
      foreignColumns: [labelTemplates.businessId, labelTemplates.id],
    }),
  ],
)
export const labelVersions = pgTable(
  'label_versions',
  { ...base(), templateId: text('template_id').notNull() },
  (t) => [
    uniqueIndex('label_versions_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.templateId],
      foreignColumns: [labelTemplates.businessId, labelTemplates.id],
    }),
  ],
)
export const labelPrintJobs = pgTable(
  'label_print_jobs',
  {
    ...base(),
    templateId: text('template_id').notNull(),
    productId: text('product_id'),
    batchId: text('batch_id'),
  },
  (t) => [
    uniqueIndex('label_print_jobs_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.templateId],
      foreignColumns: [labelTemplates.businessId, labelTemplates.id],
    }),
    foreignKey({
      columns: [t.businessId, t.productId],
      foreignColumns: [products.businessId, products.id],
    }),
    foreignKey({
      columns: [t.businessId, t.batchId],
      foreignColumns: [batches.businessId, batches.id],
    }),
  ],
)

export const fontAssets = orgTable('font_assets')

// Receipt review and consignment records are private to each business.
export const receiptExtractions = orgTable('receipt_extractions')
export const consignors = orgTable('consignors')
export const financeTransactions = pgTable(
  'finance_transactions',
  { ...base(), receiptId: text('receipt_id'), billId: text('bill_id') },
  (t) => [
    uniqueIndex('finance_transactions_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.receiptId],
      foreignColumns: [receiptExtractions.businessId, receiptExtractions.id],
    }),
    foreignKey({
      columns: [t.businessId, t.billId],
      foreignColumns: [t.businessId, t.id],
    }),
  ],
)
export const consignmentItems = pgTable(
  'consignment_items',
  { ...base(), consignorId: text('consignor_id').notNull() },
  (t) => [
    uniqueIndex('consignment_items_org_id').on(t.businessId, t.id),
    uniqueIndex('consignment_items_owner').on(
      t.businessId,
      t.id,
      t.consignorId,
    ),
    foreignKey({
      columns: [t.businessId, t.consignorId],
      foreignColumns: [consignors.businessId, consignors.id],
    }),
  ],
)
export const consignmentSales = pgTable(
  'consignment_sales',
  {
    ...base(),
    consignorId: text('consignor_id').notNull(),
    itemId: text('item_id').notNull(),
  },
  (t) => [
    uniqueIndex('consignment_sales_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.itemId, t.consignorId],
      foreignColumns: [
        consignmentItems.businessId,
        consignmentItems.id,
        consignmentItems.consignorId,
      ],
    }),
  ],
)
export const consignmentMovements = pgTable(
  'consignment_movements',
  {
    ...base(),
    consignorId: text('consignor_id').notNull(),
    itemId: text('item_id').notNull(),
  },
  (t) => [
    uniqueIndex('consignment_movements_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.itemId, t.consignorId],
      foreignColumns: [
        consignmentItems.businessId,
        consignmentItems.id,
        consignmentItems.consignorId,
      ],
    }),
  ],
)
export const consignmentPayouts = pgTable(
  'consignment_payouts',
  { ...base(), consignorId: text('consignor_id').notNull() },
  (t) => [
    uniqueIndex('consignment_payouts_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.consignorId],
      foreignColumns: [consignors.businessId, consignors.id],
    }),
  ],
)
export const vendorMatches = pgTable(
  'vendor_matches',
  { ...base(), itemId: text('item_id') },
  (t) => [
    uniqueIndex('vendor_matches_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.itemId],
      foreignColumns: [ingredients.businessId, ingredients.id],
    }),
  ],
)
export const financeReviews = pgTable(
  'finance_reviews',
  { ...base(), transactionId: text('transaction_id').notNull() },
  (t) => [
    uniqueIndex('finance_reviews_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.transactionId],
      foreignColumns: [financeTransactions.businessId, financeTransactions.id],
    }),
  ],
)

// Platform support is requester-private; workspace membership never grants ticket access.
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid().defaultRandom().primaryKey(),
    number: serial().notNull().unique(),
    requesterId: text('requester_id').notNull(),
    requesterEmail: text('requester_email').notNull(),
    workspaceId: uuid('workspace_id').references(() => businesses.id, {
      onDelete: 'set null',
    }),
    subject: text().notNull(),
    category: text().notNull(),
    status: text().notNull().default('new'),
    submissionKey: uuid('submission_key').notNull(),
    diagnostics: jsonb().$type<Record<string, string>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('support_ticket_submission').on(t.requesterId, t.submissionKey),
    index('support_ticket_inbox').on(t.updatedAt),
    index('support_ticket_requester').on(t.requesterId),
  ],
)
export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid().defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id),
    authorId: text('author_id').notNull(),
    kind: text().notNull(),
    body: text().notNull(),
    submissionKey: uuid('submission_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('support_message_submission').on(
      t.ticketId,
      t.authorId,
      t.submissionKey,
    ),
  ],
)
export const supportAttachments = pgTable(
  'support_attachments',
  {
    id: uuid().defaultRandom().primaryKey(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => supportMessages.id),
    objectKey: text('object_key').notNull(),
    byteSize: integer('byte_size').notNull(),
    submissionKey: uuid('submission_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('support_attachment_submission').on(
      t.messageId,
      t.submissionKey,
    ),
  ],
)
export const supportSettings = pgTable('support_settings', {
  id: text().primaryKey(),
  recipient: text(),
  pendingRecipient: text('pending_recipient'),
  recipientVerifiedAt: timestamp('recipient_verified_at', {
    withTimezone: true,
  }),
  fromAddress: text('from_address'),
  replyTo: text('reply_to'),
  enabled: boolean().notNull().default(false),
  version: integer().notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
export const supportOutbox = pgTable(
  'support_outbox',
  {
    id: uuid().defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id),
    messageId: uuid('message_id')
      .notNull()
      .references(() => supportMessages.id),
    kind: text().notNull(),
    targetIdentity: text('target_identity'),
    status: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    retryAt: timestamp('retry_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('support_outbox_event').on(t.messageId, t.kind),
    index('support_outbox_ready').on(t.status, t.retryAt),
  ],
)
export const supportDeliveryEvents = pgTable('support_delivery_events', {
  id: text().primaryKey(),
  notificationId: uuid('notification_id')
    .notNull()
    .references(() => supportOutbox.id),
  kind: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
export const supportAudit = pgTable('support_audit', {
  id: uuid().defaultRandom().primaryKey(),
  actorId: text('actor_id').notNull(),
  ticketId: uuid('ticket_id').references(() => supportTickets.id),
  action: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// Private registration foundation. No production policy acceptance or activation.
export const signupPlanIntents = pgTable(
  'signup_plan_intents',
  {
    id: uuid().defaultRandom().primaryKey(),
    planId: text('plan_id').notNull(),
    identityId: text('identity_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('signup_plan_intents_identity_updated').on(
      table.identityId,
      table.updatedAt,
    ),
  ],
)
export const registrationDrafts = pgTable('registration_drafts', {
  identityId: text('identity_id').primaryKey(),
  workspaceId: uuid('workspace_id').references(() => businesses.id),
  planId: text('plan_id').notNull().default('free'),
  stage: text().notNull().default('setup_incomplete'),
  profile: jsonb().$type<Record<string, any>>().notNull().default({}),
  checklist: jsonb().$type<string[]>().notNull().default([]),
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  testOnly: boolean('test_only').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const registrationAcceptances = pgTable('registration_acceptances', {
  id: uuid().defaultRandom().primaryKey(),
  identityId: text('identity_id')
    .notNull()
    .references(() => registrationDrafts.identityId),
  policyVersion: text('policy_version').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  testOnly: boolean('test_only').notNull().default(true),
})
export const workspaceBilling = pgTable('workspace_billing', {
  businessId: uuid('business_id')
    .primaryKey()
    .references(() => businesses.id),
  planId: text('plan_id'),
  source: text().notNull().default('unassigned'),
  status: text().notNull().default('setup_incomplete'),
  entitlementPolicy: text('entitlement_policy')
    .notNull()
    .default('kitchen-two-v1'),
  subscriptionId: text('subscription_id').unique(),
  paidFrom: timestamp('paid_from', { withTimezone: true }),
  paidThrough: timestamp('paid_through', { withTimezone: true }),
  snapshot: jsonb().$type<Record<string, any>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Platform subscription billing (separate from customer Square sales sync).
  environment: text(),
  billingOwnerIdentity: text('billing_owner_identity'),
  customerId: text('customer_id'),
  planVariationId: text('plan_variation_id'),
  providerStatus: text('provider_status'),
  providerVersion: integer('provider_version'),
  nextBillingDate: text('next_billing_date'),
  canceledDate: text('canceled_date'),
  lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
})
export const billingAttempts = pgTable('billing_attempts', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  identityId: text('identity_id').notNull(),
  planId: text('plan_id').notNull(),
  status: text().notNull().default('checkout_pending'),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  providerOrderId: text('provider_order_id').unique(),
  providerLinkId: text('provider_link_id').unique(),
  subscriptionId: text('subscription_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  environment: text().notNull().default('sandbox'),
  amountCents: integer('amount_cents'),
  planVariationId: text('plan_variation_id'),
  checkoutUrl: text('checkout_url'),
  consentVersion: text('consent_version'),
  consentHash: text('consent_hash'),
  consentedAt: timestamp('consented_at', { withTimezone: true }),
  customerId: text('customer_id'),
  errorCode: text('error_code'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
})
export const billingSubscriptions = pgTable('billing_subscriptions', {
  subscriptionId: text('subscription_id').primaryKey(),
  environment: text().notNull(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  attemptId: uuid('attempt_id').references(() => billingAttempts.id),
  customerId: text('customer_id').notNull(),
  planId: text('plan_id').notNull(),
  planVariationId: text('plan_variation_id').notNull(),
  status: text().notNull(),
  version: integer().notNull().default(0),
  claimedAt: timestamp('claimed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const billingInvoices = pgTable('billing_invoices', {
  id: text().primaryKey(),
  environment: text().notNull(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  subscriptionId: text('subscription_id')
    .notNull()
    .references(() => billingSubscriptions.subscriptionId),
  status: text().notNull(),
  amountCents: integer('amount_cents').notNull(),
  paidCents: integer('paid_cents').notNull().default(0),
  refundedCents: integer('refunded_cents').notNull().default(0),
  currency: text().notNull(),
  serviceFrom: text('service_from'),
  serviceThrough: text('service_through'),
  version: integer().notNull().default(0),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const billingPlanMappings = pgTable(
  'billing_plan_mappings',
  {
    environment: text().notNull(),
    planId: text('plan_id').notNull(),
    catalogPlanId: text('catalog_plan_id').notNull(),
    variationId: text('variation_id').notNull().unique(),
    amountCents: integer('amount_cents').notNull(),
    currency: text().notNull(),
    cadence: text().notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.environment, t.planId] })],
)
export const billingConnectionChecks = pgTable('billing_connection_checks', {
  id: uuid().defaultRandom().primaryKey(),
  environment: text().notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  ok: boolean().notNull(),
  merchantId: text('merchant_id'),
  locationId: text('location_id'),
  locationName: text('location_name'),
  currency: text(),
  country: text(),
  missing: jsonb().$type<string[]>().notNull().default([]),
  errorCode: text('error_code'),
})
export const billingEvents = pgTable('billing_events', {
  id: text().primaryKey(),
  merchantId: text('merchant_id').notNull(),
  kind: text().notNull(),
  objectId: text('object_id').notNull(),
  status: text().notNull().default('pending'),
  attempts: integer().notNull().default(0),
  errorCode: text('error_code'),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  environment: text().notNull().default('sandbox'),
})
export const complimentaryGrants = pgTable('complimentary_grants', {
  id: uuid().defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  ownerIdentity: text('owner_identity').notNull(),
  actorIdentity: text('actor_identity').notNull(),
  reason: text().notNull(),
  planId: text('plan_id').notNull().default('cottage-kitchen'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const registrationAudit = pgTable('registration_audit', {
  id: uuid().defaultRandom().primaryKey(),
  actorIdentity: text('actor_identity').notNull(),
  businessId: uuid('business_id').references(() => businesses.id),
  action: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const registrationLimits = pgTable('registration_limits', {
  key: text().primaryKey(),
  count: integer().notNull().default(1),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

// Platform administration is independent of Oven memberships and Identity metadata.
export const platformAdmins = pgTable('platform_admins', {
  identityId: text('identity_id').primaryKey(),
  role: text().notNull().default('admin'),
  enabled: boolean().notNull().default(true),
  epoch: integer().notNull().default(1),
  enrollmentUntil: timestamp('enrollment_until', { withTimezone: true }),
  grantedBy: text('granted_by').notNull(),
  reason: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const platformCredentials = pgTable('platform_credentials', {
  id: text().primaryKey(),
  identityId: text('identity_id')
    .notNull()
    .references(() => platformAdmins.identityId),
  publicKey: text('public_key').notNull(),
  counter: integer().notNull().default(0),
  transports: jsonb().$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const platformSessions = pgTable('platform_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  identityId: text('identity_id')
    .notNull()
    .references(() => platformAdmins.identityId),
  epoch: integer().notNull(),
  mfaAt: timestamp('mfa_at', { withTimezone: true }),
  origin: text().notNull(),
  challenge: text(),
  challengeKind: text('challenge_kind'),
  challengePurpose: text('challenge_purpose'),
  challengeUntil: timestamp('challenge_until', { withTimezone: true }),
  mfaMethod: text('mfa_method'),
  smsVerificationSid: text('sms_verification_sid'),
  smsSentAt: timestamp('sms_sent_at', { withTimezone: true }),
  smsUntil: timestamp('sms_until', { withTimezone: true }),
  smsSends: integer('sms_sends').notNull().default(0),
  smsAttempts: integer('sms_attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const platformAudit = pgTable('platform_audit', {
  id: uuid().defaultRandom().primaryKey(),
  actorId: text('actor_id'),
  action: text().notNull(),
  target: text(),
  outcome: text().notNull(),
  reason: text(),
  before: jsonb().$type<Record<string, unknown>>(),
  after: jsonb().$type<Record<string, unknown>>(),
  requestId: uuid('request_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const platformLimits = pgTable('platform_limits', {
  key: text().primaryKey(),
  count: integer().notNull().default(1),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

// Platform-only MFA records; gateway RLS is defined in the forward migration.
export const platformTotp = pgTable('platform_totp', {
  identityId: text('identity_id')
    .primaryKey()
    .references(() => platformAdmins.identityId),
  secretCiphertext: text('secret_ciphertext'),
  lastStep: bigint('last_step', { mode: 'number' }).notNull().default(-1),
  pendingCiphertext: text('pending_ciphertext'),
  pendingSession: text('pending_session').references(
    () => platformSessions.tokenHash,
    { onDelete: 'set null' },
  ),
  pendingUntil: timestamp('pending_until', { withTimezone: true }),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
})
/** One verified SMS destination per admin; numbers are encrypted at rest. */
export const platformSms = pgTable('platform_sms', {
  identityId: text('identity_id')
    .primaryKey()
    .references(() => platformAdmins.identityId),
  phoneCiphertext: text('phone_ciphertext'),
  phoneMasked: text('phone_masked'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  authorizedSession: text('authorized_session').references(
    () => platformSessions.tokenHash,
    { onDelete: 'set null' },
  ),
  authorizedUntil: timestamp('authorized_until', { withTimezone: true }),
  pendingCiphertext: text('pending_ciphertext'),
  pendingMasked: text('pending_masked'),
  pendingSid: text('pending_sid'),
  pendingSentAt: timestamp('pending_sent_at', { withTimezone: true }),
  pendingSends: integer('pending_sends').notNull().default(0),
  pendingAttempts: integer('pending_attempts').notNull().default(0),
})
export const platformRecoveryCodes = pgTable(
  'platform_recovery_codes',
  {
    identityId: text('identity_id')
      .notNull()
      .references(() => platformTotp.identityId, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.identityId, table.codeHash] })],
)

// Platform subscription merchant OAuth. No customer seller credentials live here.
export const squareBillingConnections = pgTable('square_billing_connections', {
  environment: text().primaryKey(),
  merchantId: text('merchant_id').notNull(),
  merchantName: text('merchant_name').notNull(),
  tokenCiphertext: text('token_ciphertext').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  scopes: jsonb().$type<string[]>().notNull(),
  locations: jsonb().$type<Record<string, unknown>[]>().notNull(),
  locationId: text('location_id'),
  status: text().notNull().default('connected'),
  connectedBy: text('connected_by').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const squareBillingOauthStates = pgTable('square_billing_oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  sessionHash: text('session_hash')
    .notNull()
    .references(() => platformSessions.tokenHash, { onDelete: 'cascade' }),
  identityId: text('identity_id').notNull(),
  environment: text().notNull(),
  origin: text().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  callbackAt: timestamp('callback_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  codeCiphertext: text('code_ciphertext'),
  candidateCiphertext: text('candidate_ciphertext'),
})
export const billingSyncRuns = pgTable('billing_sync_runs', {
  id: uuid().defaultRandom().primaryKey(),
  environment: text().notNull(),
  checked: integer().notNull(),
  swept: integer().notNull(),
  failures: integer().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// Shared reference data never contains tenant prices, stock, notes or uploads.
export const catalogItems = pgTable(
  'catalog_items',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    status: text().notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    check(
      'catalog_kind',
      sql`${t.kind} IN ('ingredient','packaging','supply')`,
    ),
    check(
      'catalog_status',
      sql`${t.status} IN ('active','withdrawn','superseded')`,
    ),
  ],
).enableRLS()
export const catalogRevisions = pgTable('catalog_revisions', {
  id: text().primaryKey(),
  itemId: text('item_id')
    .notNull()
    .references(() => catalogItems.id),
  data: jsonb().$type<Record<string, any>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by').notNull(),
}).enableRLS()
export const catalogIdentifiers = pgTable('catalog_identifiers', {
  identifier: text().primaryKey(),
  itemId: text('item_id')
    .notNull()
    .references(() => catalogItems.id),
  raw: text().notNull(),
  format: text().notNull(),
}).enableRLS()
export const ingredientCatalogSources = pgTable(
  'ingredient_catalog_sources',
  {
    ...base(),
    ingredientId: text('ingredient_id').notNull(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => catalogRevisions.id),
  },
  (t) => [
    uniqueIndex('ingredient_catalog_sources_org_id').on(t.businessId, t.id),
    foreignKey({
      columns: [t.businessId, t.ingredientId],
      foreignColumns: [ingredients.businessId, ingredients.id],
    }),
  ],
).enableRLS()
export const catalogSubmissions = pgTable(
  'catalog_submissions',
  {
    ...base(),
    status: text().notNull().default('pending'),
  },
  (t) => [
    uniqueIndex('catalog_submissions_org_id').on(t.businessId, t.id),
    check(
      'submission_status',
      sql`${t.status} IN ('pending','approved','rejected')`,
    ),
  ],
).enableRLS()
export const productLookupUsage = pgTable(
  'product_lookup_usage',
  {
    ...base(),
  },
  (t) => [uniqueIndex('product_lookup_usage_org_id').on(t.businessId, t.id)],
).enableRLS()

// Account-specific pilot controls and reservations, never part of public plan definitions.
export const photoPilotGrants = orgTable('photo_pilot_grants').enableRLS()
export const photoExtractionAttempts = orgTable(
  'photo_extraction_attempts',
).enableRLS()
