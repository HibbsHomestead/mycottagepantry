import { useState } from 'react'
import {
  connectBridge,
  disconnectBridge,
  desktopBridgeSupported,
} from '@/lib/qz-bridge'
import type { PrinterProfile } from '@/lib/label-printers'
export function LabelPrinterSettings({
  profiles,
  canEdit,
  width = 288,
  height = 432,
  save,
  onTest,
  onConnection,
}: {
  profiles: PrinterProfile[]
  canEdit: boolean
  width?: number
  height?: number
  save: (data: any) => Promise<void>
  onTest: (p: PrinterProfile) => Promise<void>
  onConnection: (connected: boolean) => void
}) {
  const [status, setStatus] = useState(
      'Disconnected · browser printing available',
    ),
    [printers, setPrinters] = useState<string[]>([]),
    [allowed, setAllowed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const blank = (): PrinterProfile => ({
    id: '',
    name: 'Browser printer',
    method: 'browser',
    width: width / 72,
    height: height / 72,
    unit: 'in',
    orientation: width > height ? 'landscape' : 'portrait',
    offsetX: 0,
    offsetY: 0,
    preferred: false,
    options: { colorType: 'color' },
  })
  const [draft, setDraft] = useState<PrinterProfile>(blank)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const number = (
    key: 'width' | 'height' | 'offsetX' | 'offsetY' | 'dpi',
    label: string,
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        value={draft[key] ?? ''}
        onChange={(e) =>
          setDraft({
            ...draft,
            [key]:
              key === 'dpi' && e.target.value === ''
                ? undefined
                : Number(e.target.value),
          })
        }
      />
    </label>
  )
  return (
    <section className="panel panel-body label-printers">
      <h2>Printers · this device</h2>
      <p>
        Browser printing works with installed drivers. For direct printing,
        install{' '}
        <a href="https://qz.io/download/" target="_blank" rel="noreferrer">
          QZ Tray 2.2+
        </a>{' '}
        and your printer’s normal operating-system driver on a supported
        Windows, macOS or Linux desktop. Saved printers are not assumed to be
        installed on other computers.
      </p>
      <p role="status">{status}</p>
      {desktopBridgeSupported() ? (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={allowed}
              onChange={(e) => setAllowed(e.target.checked)}
            />{' '}
            Allow Cottage Pantry to connect to the local bridge and list
            installed printers.
          </label>
          <div className="button-row">
            <button
              className="btn secondary"
              disabled={!allowed || busy || !canEdit}
              onClick={() =>
                void run(async () => {
                  setStatus('Connecting…')
                  const found = await connectBridge(() => {
                    setStatus('Disconnected · browser printing available')
                    onConnection(false)
                  })
                  setPrinters(found)
                  onConnection(true)
                  setStatus(
                    `Connected · ${found.length} installed printers found`,
                  )
                  if (found.length)
                    setDraft((d) => ({ ...d, method: 'qz', name: found[0] }))
                })
              }
            >
              Connect printer
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await disconnectBridge()
                  onConnection(false)
                  setStatus('Disconnected · browser printing available')
                })
              }
            >
              Disconnect bridge
            </button>
          </div>
        </>
      ) : (
        <p>
          Direct printing is unavailable on this device. Use browser printing.
        </p>
      )}
      <p className="muted">
        Direct printing also requires the site administrator’s QZ certificate
        and server-side signing setup. QZ offers paid trusted certificates and
        support; certificate renewal or licensing costs may apply. The local
        bridge can ask you to authorize this site. No security settings need to
        be disabled.
      </p>
      {error && (
        <p role="alert" className="warning-text">
          {error}
        </p>
      )}
      <div className="studio-two">
        <label className="field">
          <span>Saved profile</span>
          <select
            value={draft.id}
            onChange={(e) =>
              setDraft(profiles.find((p) => p.id === e.target.value) || blank())
            }
          >
            <option value="">New profile</option>
            {profiles.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
                {p.preferred ? ' · preferred' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Connection method</span>
          <select
            value={draft.method}
            onChange={(e) =>
              setDraft({
                ...draft,
                method: e.target.value as PrinterProfile['method'],
              })
            }
          >
            <option value="browser">Browser printing</option>
            <option value="qz">Direct · QZ Tray</option>
          </select>
        </label>
        {draft.method === 'qz' ? (
          <label className="field">
            <span>Select installed printer</span>
            <select
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            >
              {!printers.includes(draft.name) && (
                <option>{draft.name} · availability unverified</option>
              )}
              {printers.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>Profile name</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
        )}
        <label className="field">
          <span>Units</span>
          <select
            value={draft.unit}
            onChange={(e) => {
              const u = e.target.value as 'in' | 'mm',
                factor = u === 'mm' ? 25.4 : 1 / 25.4
              setDraft({
                ...draft,
                unit: u,
                width: draft.width * factor,
                height: draft.height * factor,
                offsetX: draft.offsetX * factor,
                offsetY: draft.offsetY * factor,
              })
            }}
          >
            <option value="in">Inches</option>
            <option value="mm">Millimeters</option>
          </select>
        </label>
        {number('width', 'Label width')}
        {number('height', 'Label height')}
        <label className="field">
          <span>Orientation</span>
          <select
            value={draft.orientation}
            onChange={(e) =>
              setDraft({
                ...draft,
                orientation: e.target.value as PrinterProfile['orientation'],
              })
            }
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        {number('dpi', 'Resolution (DPI, if known)')}
        {number('offsetX', 'Horizontal alignment offset')}
        {number('offsetY', 'Vertical alignment offset')}
        <label className="field">
          <span>Driver color option</span>
          <select
            value={draft.options.colorType}
            onChange={(e) =>
              setDraft({
                ...draft,
                options: {
                  colorType: e.target.value as 'color' | 'blackwhite',
                },
              })
            }
          >
            <option value="color">Preserve design colors</option>
            <option value="blackwhite">Black and white</option>
          </select>
        </label>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.preferred}
          onChange={(e) => setDraft({ ...draft, preferred: e.target.checked })}
        />{' '}
        Preferred printer for this device
      </label>
      <div className="button-row">
        <button
          className="btn"
          disabled={!canEdit || busy}
          onClick={() =>
            void run(async () => {
              await save({ operation: 'save', profile: draft })
              setStatus('Profile saved for this device')
              setDraft(blank())
            })
          }
        >
          Save printer profile
        </button>
        <button
          className="btn secondary"
          disabled={
            !draft.id ||
            busy ||
            !canEdit ||
            !profiles.some((p) => JSON.stringify(p) === JSON.stringify(draft))
          }
          title="Save changes before testing this profile"
          onClick={() =>
            void run(async () => {
              await onTest(draft)
              setStatus(
                draft.method === 'qz'
                  ? 'Test submitted to print queue · verify the physical label'
                  : 'Test print dialog opened · verify size and alignment',
              )
            })
          }
        >
          Print test label
        </button>
        <button
          className="text-button"
          disabled={!draft.id || busy || !canEdit}
          onClick={() =>
            void run(async () => {
              await save({ operation: 'forget', profileId: draft.id })
              setDraft(blank())
              setStatus('Printer profile forgotten on this device')
            })
          }
        >
          Forget printer
        </button>
      </div>
      <p className="muted">
        Save size or alignment changes before testing. PDF printing uses one
        document page per roll label and one driver copy. Match paper size and
        select actual size / 100% in the browser and driver. Browser code cannot
        force every driver setting.
      </p>
    </section>
  )
}
