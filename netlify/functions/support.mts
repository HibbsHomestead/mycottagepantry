import { demoRequested, demoUnavailable } from '../lib/demo-session'
import supportHandler from '../lib/support-handler'
export default (request: Request) =>
  demoRequested(request) ? demoUnavailable() : supportHandler(request)
export const config = { path: '/api/support' }
