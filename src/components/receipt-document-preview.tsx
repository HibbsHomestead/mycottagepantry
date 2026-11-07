import { useEffect, useRef, useState } from 'react'
import {
  readReceiptResponse,
  receiptFileEndpoint,
} from '../lib/receipt-document'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export function ReceiptDocumentPreview({
  id,
  zoom,
  rotation,
  crop,
  highlight,
  localFile,
  fileEndpoint,
  documentLabel = 'receipt',
}: {
  id: string
  fileEndpoint?: string
  documentLabel?: string
  localFile?: File | null
  zoom: number
  rotation: number
  crop?: number[]
  highlight?: { bbox?: number[]; page?: number }
}) {
  const [document, setDocument] = useState<{
    bytes: Uint8Array
    mime: string
    url: string
  } | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  )
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false,
      url = ''
    setStatus('loading')
    setError('')
    setDocument(null)
    setPage(1)
    const source = localFile
      ? Promise.resolve(
          new Response(localFile, {
            headers: {
              'Content-Type':
                localFile.type ||
                (localFile.name.toLowerCase().endsWith('.pdf')
                  ? 'application/pdf'
                  : 'image/jpeg'),
            },
          }),
        )
      : fetch(fileEndpoint || receiptFileEndpoint(id), {
          credentials: 'same-origin',
          redirect: 'error',
        })
    void source
      .then(readReceiptResponse)
      .then((result) => {
        if (cancelled) return
        url = URL.createObjectURL(
          new Blob([new Uint8Array(result.bytes).buffer], {
            type: result.mime,
          }),
        )
        setDocument({ ...result, url })
        if (result.mime === 'image/heic') setStatus('failed')
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || 'Receipt loading failed.')
          setStatus('failed')
        }
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, retry, localFile, fileEndpoint])
  useEffect(() => {
    if (document?.mime !== 'application/pdf') return
    let cancelled = false
    let cleanup = () => {}
    setStatus('loading')
    void import('pdfjs-dist')
      .then(async (pdf) => {
        if (cancelled) return
        pdf.GlobalWorkerOptions.workerSrc = workerUrl
        const task = pdf.getDocument({ data: document.bytes.slice() })
        cleanup = () => {
          void task.destroy()
        }
        const doc = await task.promise
        if (cancelled) return
        setPages(doc.numPages)
        const p = await doc.getPage(page)
        if (cancelled || !canvas.current) return
        const viewport = p.getViewport({ scale: zoom * 1.3 })
        const target = canvas.current
        target.width = viewport.width
        target.height = viewport.height
        await p.render({ canvas: target, viewport }).promise
        if (!cancelled) setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('failed')
          setError(
            'This PDF could not be rendered. Retry or open the original.',
          )
        }
      })
    return () => {
      cancelled = true
      cleanup()
    }
  }, [document, page, zoom])
  async function original(download: boolean) {
    try {
      const file = await fetch(fileEndpoint || receiptFileEndpoint(id, true), {
        credentials: 'same-origin',
        redirect: 'error',
      }).then(readReceiptResponse)
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(file.bytes).buffer], { type: file.mime }),
      )
      const link = window.document.createElement('a')
      link.href = url
      if (download)
        link.download =
          documentLabel +
          '.' +
          {
            'application/pdf': 'pdf',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/heic': 'heic',
          }[file.mime]
      else {
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
      }
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Original could not be loaded.')
    }
  }
  return (
    <>
      <div className="button-row">
        <button
          disabled={!!localFile}
          className="btn secondary"
          onClick={() => void original(false)}
        >
          Open original
        </button>
        <button
          disabled={!!localFile}
          className="btn secondary"
          onClick={() => void original(true)}
        >
          Download original
        </button>
      </div>
      {status === 'loading' && (
        <p role="status">Loading {documentLabel} preview…</p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className="btn secondary"
            onClick={() => setRetry((v) => v + 1)}
          >
            Retry preview
          </button>
        </div>
      )}
      {document?.mime === 'application/pdf' ? (
        <>
          <div className="button-row">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous page
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next page
            </button>
          </div>
          <div className="receipt-image-wrap">
            <canvas
              ref={canvas}
              aria-label={documentLabel + ' PDF page ' + page}
            />
            {highlight?.bbox && highlight.page === page && (
              <Highlight bbox={highlight.bbox} />
            )}
          </div>
        </>
      ) : document?.mime === 'image/heic' ? (
        <p>
          HEIC preview is unsupported in this browser. Open or download the
          original, or upload a JPG. Manual entry remains available.
        </p>
      ) : (
        document && (
          <div
            className="receipt-image-wrap"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: 'top center',
              clipPath: crop
                ? `inset(${crop.map((v) => v + '%').join(' ')})`
                : undefined,
            }}
          >
            <img
              src={document.url}
              alt={'Uploaded ' + documentLabel}
              onLoad={() => setStatus('ready')}
              onError={() => {
                setStatus('failed')
                setError(
                  'The receipt image could not be displayed. Retry or open the original.',
                )
              }}
            />
            {highlight?.bbox && (!highlight.page || highlight.page === 1) && (
              <Highlight bbox={highlight.bbox} />
            )}
          </div>
        )
      )}
    </>
  )
}
function Highlight({ bbox: b }: { bbox: number[] }) {
  return (
    <div
      className="receipt-line-highlight"
      style={{
        left: b[0] * 100 + '%',
        top: b[1] * 100 + '%',
        width: b[2] * 100 + '%',
        height: b[3] * 100 + '%',
      }}
    />
  )
}
