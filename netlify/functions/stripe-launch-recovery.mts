import { prepareHostedStripeLaunch } from '../lib/stripe-launch'

export default async () => {
  await prepareHostedStripeLaunch()
}

export const config = { schedule: '*/5 * * * *' }
