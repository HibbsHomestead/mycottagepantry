import { createHash, createSign } from 'node:crypto'
export function qzConfigured() {
  return !!(process.env.QZ_CERTIFICATE && process.env.QZ_PRIVATE_KEY)
}
export function qzCertificate() {
  if (!qzConfigured())
    throw new Error(
      'Direct printing signing is not configured. Use browser printing.',
    )
  return process.env.QZ_CERTIFICATE!.replace(/\\n/g, '\n')
}
// The server constructs all calls. No client-provided request text is signed.
export function signQzCall(call: 'printers.find' | 'print', params: unknown) {
  if (!qzConfigured())
    throw new Error(
      'Direct printing signing is not configured. Use browser printing.',
    )
  const timestamp = Date.now()
  const digest = createHash('sha256')
    .update(JSON.stringify({ call, params, timestamp }))
    .digest('hex')
  try {
    const signer = createSign('SHA512')
    signer.update(digest)
    signer.end()
    return {
      params,
      timestamp,
      signature: signer.sign(
        process.env.QZ_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        'base64',
      ),
    }
  } catch {
    throw new Error(
      'Direct printing certificate/signing configuration needs attention. Use browser printing.',
    )
  }
}
