import { prepareHostedStripeLaunch } from '../lib/stripe-launch'

export default {
  async deploySucceeded() {
    await prepareHostedStripeLaunch()
  },
}
