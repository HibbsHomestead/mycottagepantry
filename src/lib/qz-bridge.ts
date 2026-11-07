let bridge: any
export const desktopBridgeSupported = () =>
  typeof window !== 'undefined' &&
  !!window.WebSocket &&
  !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
async function api(query: string, body?: any) {
  const response = await fetch(
    '/api/workspace?' + query,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  )
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Printer request failed.')
  return result
}
export async function connectBridge(onClosed: () => void) {
  if (!desktopBridgeSupported())
    throw new Error(
      'Direct printing requires a supported desktop. Browser printing remains available.',
    )
  const configuration = await api('printerCertificate=1')
  if (!configuration.configured)
    throw new Error(
      'Direct printing signing is not configured. Use browser printing or ask your oven administrator to complete certificate setup.',
    )
  const module = await import('qz-tray')
  bridge = module.default
  bridge.security.setCertificatePromise(
    () => Promise.resolve(configuration.certificate),
    { rejectOnFailure: true },
  )
  bridge.security.setSignatureAlgorithm('SHA512')
  bridge.security.setSignaturePromise(
    () => () =>
      Promise.reject(
        new Error('Only server-authorized print jobs are allowed.'),
      ),
  )
  bridge.websocket.setClosedCallbacks(onClosed)
  if (!bridge.websocket.isActive())
    await bridge.websocket.connect({ retries: 0, delay: 0 })
  const version = await bridge.api.getVersion()
  const parts = String(version).split('.').map(Number)
  if (parts[0] < 2 || (parts[0] === 2 && parts[1] < 2)) {
    await bridge.websocket.disconnect()
    throw new Error(
      'QZ Tray 2.2 or newer is required. Use browser printing or update the bridge.',
    )
  }
  const signed = await api('printerSign=1', { operation: 'discover' })
  return (await bridge.printers.find(
    null,
    signed.signature,
    signed.timestamp,
  )) as string[]
}
export const bridgeConnected = () => !!bridge?.websocket.isActive()
export async function disconnectBridge() {
  if (bridgeConnected()) await bridge.websocket.disconnect()
}
export async function directPrint(jobId: string) {
  if (!bridgeConnected())
    throw new Error(
      'The bridge is disconnected. Connect it or use browser printing.',
    )
  const signed = await api('printerSign=1', { operation: 'print', jobId })
  const { printer, options, data } = signed.params
  await bridge.print(
    bridge.configs.create(printer, options),
    data,
    signed.signature,
    signed.timestamp,
  )
}
