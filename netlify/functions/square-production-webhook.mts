import type { Config } from '@netlify/functions'
import { squareBillingWebhook } from '../lib/square-webhook'
/** Receives verified references before release; never enables checkout. */
export default async (request: Request) =>
  squareBillingWebhook(request, 'production')
export const config: Config = { path: '/api/square/production/webhook' }
