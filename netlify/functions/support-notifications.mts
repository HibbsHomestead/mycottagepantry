import { dispatchSupportMail } from '../lib/support-mail'
export default async () => {
  await dispatchSupportMail()
  return new Response(null, { status: 204 })
}
export const config = { schedule: '*/10 * * * *' }
