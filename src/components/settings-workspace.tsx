import { CategoryTaxSettings } from './product-categories'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Palette,
  Sun,
  Moon,
  Monitor,
  Check,
  Download,
  Upload,
  Building2,
  ShieldCheck,
  Package,
  SlidersHorizontal,
  Receipt,
  Plug,
  Database,
  ArrowRight,
} from 'lucide-react'
import {
  accentThemes,
  appearanceVariables,
  defaultAppearance,
  type Appearance,
} from '@/lib/appearance'
import {
  applicableTaxes,
  money,
  units,
  unitLabel,
  type Item,
  type Workspace,
} from '@/lib/domain'
import { TaxRateEditor } from './financial-editors'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
export const settingsSections = [
  'Business Profile',
  'Appearance',
  'Units & Costing Defaults',
  'Inventory Rules',
  'Taxes',
  'Data Import & Export',
  'Integrations',
  'Team & Roles',
  'Backup / Data Management',
]
const icons = [
  Building2,
  Palette,
  SlidersHorizontal,
  Package,
  Receipt,
  Upload,
  Plug,
  ShieldCheck,
  Database,
]
export function SettingsWorkspace({
  workspace: w,
  section,
  go,
  open,
  appearance,
  preview,
  saveAppearance,
  saveBusiness,
  onCategoryConfig,
  exportData,
  backup,
  busy,
  canSave,
  openTaxReports,
  isOwner,
}: {
  workspace: Workspace
  isOwner?: boolean
  openTaxReports?: () => void
  section: string
  go: (section: string) => void
  open: (kind: string, item?: Item) => void
  appearance: Appearance
  preview: (a: Appearance) => void
  saveAppearance: () => Promise<void>
  saveBusiness: (item: Item) => Promise<void>
  onCategoryConfig?: (patch: Partial<Item>) => void
  exportData: (type: string, template?: boolean) => void
  backup: () => void
  busy: boolean
  canSave: boolean
}) {
  const business = w.settings[0],
    selected = settingsSections.includes(section) ? section : 'Business Profile'
  const [rates, setRates] = useState(
      business.taxRates ??
        applicableTaxes({ id: 'default', name: '' }, business),
    ),
    [error, setError] = useState(''),
    [savedSection, setSavedSection] = useState(''),
    [saving, setSaving] = useState(false)
  const taxDraftDirty = useRef(false)
  useEffect(() => {
    if (taxDraftDirty.current) return
    setRates(
      business.taxRates ??
        applicableTaxes({ id: 'default', name: '' }, business),
    )
  }, [business.taxRates, business.taxRate, business.jurisdiction])
  useEffect(() => {
    setSavedSection('')
  }, [appearance.theme, appearance.mode])
  const save = async (fn: () => Promise<void>) => {
    try {
      setError('')
      setSavedSection('')
      setSaving(true)
      await fn()
      setSavedSection(selected)
      if (selected === 'Taxes') taxDraftDirty.current = false
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="settings-workspace">
      <nav className="settings-nav" aria-label="Settings sections">
        {isOwner && (
          <a className="public-text-link" href="/oven/billing">
            Subscription & Billing
          </a>
        )}
        {settingsSections.map((s, i) => {
          const Icon = icons[i]
          return (
            <button
              key={s}
              className={selected === s ? 'active' : ''}
              aria-current={selected === s ? 'page' : undefined}
              onClick={() => go(s)}
            >
              <Icon size={18} />
              {s}
            </button>
          )
        })}
      </nav>
      <div className="settings-content">
        <section className="panel settings-section">
          <span className="eyebrow">OVEN SETTINGS</span>
          <h2>{selected}</h2>
          {selected === 'Appearance' && (
            <>
              <p>A little more you. Choose your oven color and display mode.</p>
              <fieldset className="theme-options">
                <legend>Accent theme</legend>
                <div className="theme-swatch-grid">
                  {accentThemes.map((t) => (
                    <label
                      className={`theme-swatch ${appearance.theme === t.id ? 'selected' : ''}`}
                      key={t.id}
                    >
                      <input
                        type="radio"
                        name="accent-theme"
                        value={t.id}
                        checked={appearance.theme === t.id}
                        onChange={() => preview({ ...appearance, theme: t.id })}
                      />
                      <span
                        className="swatch-colors"
                        style={
                          {
                            '--swatch': t.primary,
                            '--swatch-soft': t.accent,
                          } as CSSProperties
                        }
                      >
                        <i />
                        {appearance.theme === t.id && <Check size={18} />}
                      </span>
                      <strong>{t.name}</strong>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="display-options">
                <legend>Display mode</legend>
                <div>
                  {[
                    { id: 'light', name: 'Light', icon: Sun },
                    { id: 'dark', name: 'Dark', icon: Moon },
                    { id: 'system', name: 'System', icon: Monitor },
                  ].map(({ id, name, icon: Icon }) => (
                    <label
                      className={appearance.mode === id ? 'selected' : ''}
                      key={id}
                    >
                      <input
                        type="radio"
                        name="display-mode"
                        value={id}
                        checked={appearance.mode === id}
                        onChange={() =>
                          preview({
                            ...appearance,
                            mode: id as Appearance['mode'],
                          })
                        }
                      />
                      <Icon size={18} />
                      {name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div
                className="theme-preview"
                style={
                  appearanceVariables(
                    appearance,
                    typeof window !== 'undefined' &&
                      !!window.matchMedia?.('(prefers-color-scheme: dark)')
                        .matches,
                  ) as CSSProperties
                }
              >
                <aside>
                  <Package size={23} />
                  <i />
                  <i />
                  <i />
                </aside>
                <div>
                  <span className="eyebrow">LIVE PREVIEW</span>
                  <h3>Your pantry, in focus.</h3>
                  <strong>$1,248.60</strong>
                  <span className="status green">
                    <Check size={13} />
                    In stock
                  </span>
                  <button className="btn" type="button" tabIndex={-1}>
                    Receive stock <ArrowRight size={15} />
                  </button>
                </div>
              </div>
              <div className="appearance-footer">
                <p>
                  {canSave
                    ? 'Preview appearance changes here, then save them to your oven.'
                    : 'This device remembers your appearance for startup. Oven changes require an authorized connection.'}
                </p>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    preview({ ...appearance, theme: defaultAppearance.theme })
                  }
                >
                  Reset to default
                </button>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    preview(business.appearance || defaultAppearance)
                  }
                >
                  Use saved appearance
                </button>
                <button
                  className="btn"
                  disabled={busy || saving || !canSave}
                  onClick={() => save(saveAppearance)}
                >
                  {busy || saving ? 'Saving…' : 'Save appearance'}
                </button>
              </div>
              {!canSave && (
                <p className="muted">
                  An Owner or Manager can save the business appearance.
                </p>
              )}
            </>
          )}
          {selected === 'Business Profile' && (
            <>
              <p>
                Your business details, used across your oven and printed labels.
              </p>
              <dl className="business-details">
                {[
                  ['Business', business.name],
                  ['Owner', business.owner],
                  ['Email', business.email],
                  ['Address', business.address],
                  ['Jurisdiction', business.jurisdiction],
                  ['Oven timezone', business.timezone || 'America/Chicago'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v || 'Not set'}</dd>
                  </div>
                ))}
              </dl>
              <button
                className="btn"
                onClick={() => open('settings', business)}
              >
                Edit business profile
              </button>
            </>
          )}
          {selected === 'Units & Costing Defaults' && (
            <>
              <p>
                Start every new recipe with consistent labor, overhead, and
                pricing defaults.
              </p>
              <div className="defaults-grid">
                <div>
                  <small>Labor rate</small>
                  <strong>{money(business.laborRate || 0)} / hr</strong>
                </div>
                <div>
                  <small>Target margin</small>
                  <strong>{business.targetMargin ?? 65}%</strong>
                </div>
                <div>
                  <small>Overhead</small>
                  <strong>{money(business.defaultOverhead || 0)}</strong>
                  <small>{business.overheadMode || 'per batch'}</small>
                </div>
              </div>
              <div className="info-banner">
                <SlidersHorizontal size={22} />
                <p>
                  Weight uses grams, volume uses milliliters, and count uses
                  each. Cross-category conversions always require a verified
                  ingredient-specific value.
                </p>
              </div>
              <button
                className="btn"
                onClick={() => open('settings', business)}
              >
                Edit costing defaults
              </button>
              <details className="setting-disclosure">
                <summary>Supported measurement units</summary>
                {['weight', 'volume', 'count'].map((category) => (
                  <p key={category}>
                    <strong>{category}: </strong>
                    {Object.entries(units)
                      .filter(
                        ([, u]) => u.category === category && u.factor > 0,
                      )
                      .map(([id]) => unitLabel(id))
                      .join(', ')}
                  </p>
                ))}
                <p>
                  Package labels:{' '}
                  {Object.keys(units)
                    .filter((id) => units[id].factor === 0)
                    .join(', ')}
                  . Define verified contents per item, such as 1 bottle = 1 US
                  gallon and 1 case = 4 bottles. Packages have no universal
                  size.
                </p>
                <p>
                  Enter decimals or fractions (0.5, 1/4). Imported regional
                  measures require review. Display preferences do not convert
                  saved quantities or historical costs.
                </p>
              </details>
              <details className="setting-disclosure">
                <summary>Saved custom count units</summary>
                {w.units
                  ?.filter((u) => u.custom)
                  .map((u) => (
                    <p key={u.id}>
                      {u.name}: 1 {u.abbreviation} = {u.factor} each
                    </p>
                  ))}
                <p>
                  Create verified count units from a pantry item's detail view.
                </p>
              </details>
            </>
          )}
          {selected === 'Inventory Rules' && (
            <>
              <p>
                Stock changes stay traceable, from receiving to completed
                batches.
              </p>
              <div className="rule-list">
                {[
                  'Receipts update weighted-average inventory costs.',
                  'Batch completion deducts actual ingredients and tracked packaging.',
                  'Stock changes always create a ledger entry.',
                  'Reorder points and packaging tracking are configured per item.',
                ].map((r) => (
                  <p key={r}>
                    <Check size={18} />
                    {r}
                  </p>
                ))}
              </div>
              <button className="btn" onClick={() => open('receive-picker')}>
                Receive stock
              </button>
            </>
          )}
          {selected === 'Taxes' && (
            <>
              <CategoryTaxSettings
                business={business}
                products={w.products}
                canManage={canSave}
                onConfig={onCategoryConfig || (() => {})}
              />
              <p>
                Set only the rates that apply to your business. Completed sales
                keep their original rates.
              </p>
              <TaxRateEditor
                rates={rates}
                onChange={(next) => {
                  taxDraftDirty.current = true
                  setSavedSection('')
                  setRates(next)
                }}
              />
              <button
                className="btn"
                disabled={busy || saving || !canSave}
                onClick={() =>
                  save(() => saveBusiness({ ...business, taxRates: rates }))
                }
              >
                {busy || saving ? 'Saving…' : 'Save tax rates'}
              </button>
            </>
          )}
          {selected === 'Data Import & Export' && (
            <>
              <p>Move your records in clear, familiar CSV files.</p>
              <div className="data-action-grid">
                <div>
                  <Upload size={23} />
                  <h3>Import data</h3>
                  <p>
                    Import ingredients, recipes, products, sales, or expenses.
                    CSV · up to 500 rows.
                  </p>
                  <button className="btn" onClick={() => open('import')}>
                    Choose a CSV file
                  </button>
                </div>
                <div>
                  <Download size={23} />
                  <h3>Export data</h3>
                  <p>
                    Download a complete dataset for your records or accountant.
                  </p>
                  <DataMenu
                    label="Export data"
                    onSelect={(type) => exportData(type)}
                  />
                </div>
                <div>
                  <Package size={23} />
                  <h3>Download templates</h3>
                  <p>CSV column headers for the supported import types.</p>
                  <DataMenu
                    label="Choose template"
                    onSelect={(type) => exportData(type, true)}
                  />
                </div>
                <div>
                  <Database size={23} />
                  <h3>Backup data</h3>
                  <p>Download a point-in-time JSON copy of this oven.</p>
                  <button className="btn secondary" onClick={backup}>
                    Download backup · JSON
                  </button>
                </div>
              </div>
            </>
          )}
          {selected === 'Integrations' && (
            <>
              <div className="integration-row">
                <Receipt size={23} aria-hidden="true" />
                <div>
                  <h3>Tax reports &amp; exports</h3>
                  <p>
                    Recorded-sales tax reports and CSV exports are available in
                    Finances → Tax center. No tax service or filing connection
                    exists. Cottage Pantry does not file or submit returns.
                  </p>
                  {openTaxReports && (
                    <button className="btn secondary" onClick={openTaxReports}>
                      Open tax reports
                    </button>
                  )}
                </div>
                <span className="status neutral">Available</span>
              </div>
            </>
          )}
          {selected === 'Team & Roles' && (
            <>
              <p>
                Access stays scoped to this business. Invitations and member
                administration are not yet available.
              </p>
              {[
                'Owner',
                'Manager',
                'Production Staff',
                'Read-only Accountant',
              ].map((role, i) => (
                <div className="role-row" key={role}>
                  <strong>{role}</strong>
                  <small>
                    {
                      [
                        'Full oven access',
                        'Day-to-day management',
                        'Receiving and production',
                        'View and export records',
                      ][i]
                    }
                  </small>
                </div>
              ))}
              <button className="btn secondary" onClick={() => open('signin')}>
                Account & sign in
              </button>
            </>
          )}
          {selected === 'Backup / Data Management' && (
            <>
              <p>Keep a copy of your records outside this oven.</p>
              <div className="info-banner">
                <ShieldCheck size={23} />
                <p>
                  Backups contain business and financial records. Store your
                  downloaded file privately. Automatic backup scheduling and
                  backup restoration are not available.
                </p>
              </div>
              <button className="btn" onClick={backup}>
                <Download size={17} />
                Download oven backup · JSON
              </button>
            </>
          )}
          {saving && <p role="status">Saving…</p>}
          {!saving && savedSection === selected && (
            <p role="status">Saved successfully.</p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
function DataMenu({
  label,
  onSelect,
}: {
  label: string
  onSelect: (type: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="btn secondary">
          {label}
          <Download size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-menu">
        {['ingredients', 'recipes', 'products', 'sales', 'expenses'].map(
          (type) => (
            <DropdownMenuItem key={type} onSelect={() => onSelect(type)}>
              {type[0].toUpperCase() + type.slice(1)} · CSV
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
