import type { Config } from '@netlify/functions'
import { squareBillingWebhook } from '../lib/square-webhook'
export default async (request: Request) =>
  squareBillingWebhook(request, 'sandbox')
export const config: Config = { path: '/api/square/sandbox/webhook' }
