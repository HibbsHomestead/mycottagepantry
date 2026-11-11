import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { barcodeText, scanFormats } from '@/lib/barcodes'
import './inventory-tools.css'

export function BarcodeScanner({
  onCode,
  onClose,
}: {
  onCode: (raw: string, format?: string) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null),
    release = useRef<() => void>(() => {}),
    accepted = useRef(false),
    starting = useRef(false),
    pending = useRef(false)
  const [manual, setManual] = useState(''),
    [error, setError] = useState(''),
    [running, setRunning] = useState(false)
  useEffect(() => {
    const pause = () => {
      release.current()
      setRunning(false)
    }
    const visibility = () => {
      if (document.hidden) pause()
    }
    window.addEventListener('pagehide', pause)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pagehide', pause)
      document.removeEventListener('visibilitychange', visibility)
      release.current()
    }
  }, [])
  function accept(raw: string, format?: string) {
    try {
      const code = barcodeText(raw)
      if (accepted.current) return
      accepted.current = true
      release.current()
      onCode(code, format)
    } catch (e) {
      release.current()
      setRunning(false)
      setError((e as Error).message)
    }
  }
  async function start() {
    if (starting.current || pending.current) return
    release.current()
    starting.current = true
    accepted.current = false
    setError('')
    setRunning(true)
    let stopped = false,
      stream: MediaStream | undefined,
      controls: { stop: () => void } | undefined,
      frame = 0
    release.current = () => {
      stopped = true
      starting.current = false
      cancelAnimationFrame(frame)
      controls?.stop()
      stream?.getTracks().forEach((t) => t.stop())
      if (video.current) video.current.srcObject = null
    }
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'Camera scanning needs HTTPS and an available camera. Use manual entry below.',
        )
      pending.current = true
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      pending.current = false
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const element = video.current!
      element.srcObject = stream
      await element.play()
      if (stopped) return
      const Native = (window as any).BarcodeDetector
      const supported = Native
        ? await Native.getSupportedFormats().catch(() => [])
        : []
      if (stopped) return
      const formats = scanFormats.filter((f) => supported.includes(f))
      // Fall back when native support omits the priority retail formats.
      if (Native && scanFormats.every((f) => formats.includes(f))) {
        const detector = new Native({ formats })
        let last = 0
        const detect = async (time: number) => {
          if (stopped) return
          if (time - last >= 250) {
            last = time
            try {
              const results = await detector.detect(element)
              if (!stopped && results[0]?.rawValue) {
                accept(results[0].rawValue, results[0].format)
                return
              }
            } catch {
              /* A transient unreadable frame is not a new request. */
            }
          }
          if (!stopped) frame = requestAnimationFrame(detect)
        }
        frame = requestAnimationFrame(detect)
      } else {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (stopped) return
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 250,
          delayBetweenScanSuccess: 1000,
        })
        controls = await reader.decodeFromStream(stream, element, (result) => {
          if (!stopped && result)
            accept(
              result.getText(),
              (
                {
                  15: 'upc_e',
                  14: 'upc_a',
                  7: 'ean_13',
                  6: 'ean_8',
                  4: 'code_128',
                  11: 'qr_code',
                } as Record<number, string>
              )[result.getBarcodeFormat()],
            )
        })
        if (stopped) controls?.stop()
      }
    } catch (e) {
      pending.current = false
      if (stopped) return
      release.current()
      setRunning(false)
      setError(
        (e as any)?.name === 'NotAllowedError'
          ? 'Camera permission was denied. In Safari, open the page menu → Website Settings → Camera for this site. In Chrome, open site controls → Permissions → Camera. Allow Cottage Pantry, then tap Retry camera. Your browser controls how long permission lasts; private sessions or cleared site settings may ask again.'
          : (e as any)?.name === 'NotReadableError'
            ? 'Camera is in use or could not start. Close other camera apps or tabs, then tap Retry camera or enter the code manually.'
            : 'Camera unavailable. Check that this device has an enabled camera, then tap Retry camera or enter the code manually.',
      )
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          release.current()
          onClose()
        }
      }}
    >
      <DialogContent
        className="inventory-tool-dialog barcode-scanner-dialog"
        overlayClassName="barcode-scanner-overlay"
      >
        <DialogTitle>Scan barcode</DialogTitle>
        <DialogDescription>
          One code per scan. Camera frames stay on this device. Scanning never
          posts stock or payments.
        </DialogDescription>
        <video
          ref={video}
          muted
          playsInline
          aria-label="Barcode camera preview"
          className="barcode-video"
        />
        {!running && (
          <button className="btn" onClick={() => void start()}>
            {error ? 'Retry camera' : 'Start rear camera'}
          </button>
        )}
        {error && (
          <p role="alert" className="warning-text">
            {error}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            accept(manual)
          }}
        >
          <label className="field">
            Barcode or internal QR text
            <input
              autoComplete="off"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
          </label>
          <button className="btn secondary" disabled={!manual.trim()}>
            Use entered code
          </button>
        </form>
        <button
          className="btn secondary"
          onClick={() => {
            release.current()
            onClose()
          }}
        >
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  )
}
