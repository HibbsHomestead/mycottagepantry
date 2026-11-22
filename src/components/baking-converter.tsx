import { useEffect, useId, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Copy, RotateCcw } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { units, unitLabel, type Item } from '../lib/domain'
import {
  bakingConvert,
  bakingDisplay,
  ingredientUnits,
  ovenConvert,
  parseBakingQuantity,
  weightUnits,
  volumeUnits,
  yeastConvert,
  yeastRatios,
  type BakingReference,
} from '../lib/baking-converter'
import './baking-converter.css'

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <label className="baking-field" id={id}>
      <span>{label}</span>
      {children}
    </label>
  )
}
function UnitSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((u) => (
        <option key={u} value={u}>
          {unitLabel(u)}
        </option>
      ))}
    </select>
  )
}
function Result({
  result,
  text,
  reset,
  error,
}: {
  result: number | null
  text: string
  reset: () => void
  error?: string
}) {
  const [copy, setCopy] = useState('')
  useEffect(() => {
    setCopy('')
  }, [text])
  useEffect(() => {
    if (!copy) return
    const timer = setTimeout(() => setCopy(''), 2500)
    return () => clearTimeout(timer)
  }, [copy])
  return (
    <>
      <div className="baking-result" aria-live="polite">
        <span>Converted result</span>
        <strong>{result === null ? '—' : text}</strong>
      </div>
      {error && (
        <p className="baking-error" role="status">
          {error}
        </p>
      )}
      <div className="baking-actions">
        <button className="btn secondary" onClick={reset}>
          <RotateCcw size={16} /> Reset
        </button>
        <button
          className="btn"
          disabled={result === null}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text)
              setCopy('Copied')
            } catch {
              setCopy('Copy unavailable. Select the result to copy.')
            }
          }}
        >
          <Copy size={16} /> Copy Result
        </button>
        <span role="status">{copy}</span>
      </div>
    </>
  )
}
function MeasureCard({
  title,
  options,
  initialFrom,
  initialTo,
  reference,
}: {
  title: string
  options: string[]
  initialFrom: string
  initialTo: string
  reference?: BakingReference
}) {
  const [quantity, setQuantity] = useState('1'),
    [from, setFrom] = useState(initialFrom),
    [to, setTo] = useState(initialTo)
  const q = parseBakingQuantity(quantity)
  const density = reference
    ? reference.referenceWeightG / reference.referenceVolumeMl
    : undefined
  const result = q === null ? null : bakingConvert(q, from, to, density)
  const error =
    q === null
      ? 'Enter a non-negative quantity, such as 0.5, 1/2, or 1 1/2. A fraction must have a nonzero denominator.'
      : result === null
        ? 'Choose an ingredient with a valid weight-to-volume factor for this conversion, or use a smaller quantity.'
        : ''
  return (
    <section className="panel baking-card">
      <h2>{title}</h2>
      <div className="baking-controls">
        <Field label="Quantity">
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            aria-invalid={q === null}
            inputMode="text"
          />
        </Field>
        <Field label="From unit">
          <UnitSelect value={from} onChange={setFrom} options={options} />
        </Field>
        <button
          className="icon-button baking-swap"
          aria-label="Swap units"
          disabled={result === null}
          onClick={() => {
            if (result !== null) {
              setQuantity(String(result))
              setFrom(to)
              setTo(from)
            }
          }}
        >
          <ArrowLeftRight size={20} />
        </button>
        <Field label="To unit">
          <UnitSelect value={to} onChange={setTo} options={options} />
        </Field>
      </div>
      <Result
        result={result}
        text={`${bakingDisplay(result)} ${unitLabel(to)}${reference ? ' · ' + reference.ingredientName : ''}`}
        error={error}
        reset={() => {
          setQuantity('1')
          setFrom(initialFrom)
          setTo(initialTo)
        }}
      />
    </section>
  )
}
const quick = [
  ['1 cup', 1],
  ['3/4 cup', 3 / 4],
  ['2/3 cup', 2 / 3],
  ['1/2 cup', 1 / 2],
  ['1/3 cup', 1 / 3],
  ['1/4 cup', 1 / 4],
  ['1 tablespoon', 1 / 16],
  ['1 teaspoon', 1 / 48],
] as const
async function requestReferences(body?: object): Promise<BakingReference[]> {
  const response = await fetch('/api/workspace?bakingConverter', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.error || 'Conversion data is unavailable. Try again.')
  return data.references
}
export function BakingConverter({
  ready,
  canSave,
  ingredients,
}: {
  ready: boolean
  canSave: boolean
  ingredients: Item[]
}) {
  const [references, setReferences] = useState<BakingReference[]>([]),
    [selected, setSelected] = useState(''),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('Ingredients')
  const [weight, setWeight] = useState(''),
    [volume, setVolume] = useState('1'),
    [volumeUnit, setVolumeUnit] = useState('cup'),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [inventoryId, setInventoryId] = useState(''),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState('')
  async function load() {
    setLoading(true)
    try {
      setReferences(await requestReferences())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (ready) void load()
    else {
      setReferences([])
      setSelected('')
    }
  }, [ready])
  // A private override replaces its own reference or inventory entry for this bakery only.
  const options = references.filter(
    (r) =>
      !references.some(
        (o) =>
          o.id !== r.id &&
          o.scope === 'private' &&
          ((o.referenceId && o.referenceId === r.id) ||
            (r.id.startsWith('inventory-') &&
              o.inventoryIngredientId === r.inventoryIngredientId)),
      ),
  )
  const active =
    options.find((r) => r.id === selected || r.referenceId === selected) ||
    (!selected ? options[0] : undefined)
  const filtered = options.filter((r) =>
    `${r.ingredientName} ${r.brand || ''} ${r.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )
  const measuredWeight = parseBakingQuantity(weight),
    measuredVolume = parseBakingQuantity(volume)
  const customValid =
    measuredWeight !== null &&
    measuredWeight > 0 &&
    measuredVolume !== null &&
    measuredVolume > 0 &&
    !!(active?.ingredientName || name.trim())
  return (
    <div className="baking-converter">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="baking-tabs" aria-label="Baking conversion tools">
          {['Ingredients', 'Weight & Volume', 'Oven Temperature', 'Yeast'].map(
            (t) => (
              <TabsTrigger key={t} value={t}>
                {t}
              </TabsTrigger>
            ),
          )}
        </TabsList>
        <TabsContent value="Ingredients">
          <section className="panel baking-card">
            <h2>Every ingredient measures differently</h2>
            <p className="form-hint">
              Choose a reference or a verified saved ingredient. All volume
              measures below use US units.
            </p>
            <div className="baking-two">
              <Field label="Search ingredients">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Field>
              <Field label="Ingredient">
                <select
                  value={active?.id || ''}
                  onChange={(e) => {
                    setSelected(e.target.value)
                    setNotice('')
                  }}
                >
                  <option value="" disabled>
                    {loading ? 'Loading conversions…' : 'Choose an ingredient'}
                  </option>
                  {active && !filtered.some((r) => r.id === active.id) && (
                    <option value={active.id}>
                      {active.ingredientName}
                      {active.brand ? ` (${active.brand})` : ''}
                    </option>
                  )}
                  {filtered.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.ingredientName}
                      {r.brand ? ` (${r.brand})` : ''}
                      {r.scope === 'private' ? ' — your bakery' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {filtered.length === 0 && !loading && (
              <p className="form-hint">
                No matching conversion factors. Save your own measured factor
                below.
              </p>
            )}
            {error && (
              <p className="baking-error" role="alert">
                {error}{' '}
                <button className="btn secondary" onClick={load}>
                  Retry
                </button>
              </p>
            )}
            {!ready && (
              <p className="form-hint">
                Connecting to your bakery’s saved conversion data…
              </p>
            )}
          </section>
          <MeasureCard
            title="Ingredient converter"
            options={ingredientUnits}
            initialFrom="cup"
            initialTo="g"
            reference={active}
          />
          {active && (
            <section className="panel baking-card">
              <h3>
                {active.scope === 'shared'
                  ? 'Reference conversion'
                  : 'Your custom conversion'}
              </h3>
              <p>
                {bakingDisplay(active.referenceWeightG)} g per{' '}
                {bakingDisplay(active.referenceVolumeMl)} mL ·{' '}
                {active.ingredientName}
                {active.brand ? ` (${active.brand})` : ''}
              </p>
              <p className="form-hint">
                Original basis: {active.originalQuantity}{' '}
                {unitLabel(active.originalUnit)}. {active.description}{' '}
                {active.sourceUrl ? (
                  <a href={active.sourceUrl} target="_blank" rel="noreferrer">
                    {active.sourceName}
                  </a>
                ) : (
                  active.sourceName
                )}
              </p>
              <h3>Quick reference · {active.ingredientName}</h3>
              <table className="baking-table">
                <thead>
                  <tr>
                    <th>US volume</th>
                    <th>Estimated weight</th>
                  </tr>
                </thead>
                <tbody>
                  {quick.map(([label, q]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>
                        {bakingDisplay(
                          (q * units.cup.factor * active.referenceWeightG) /
                            active.referenceVolumeMl,
                        )}{' '}
                        g
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p className="baking-note">
            Volume-to-weight conversions are estimates and depend on the
            ingredient, brand, and measuring method. For consistent results,
            weigh ingredients.
          </p>
          <section className="panel baking-card">
            <details>
              <summary>Save a private measured conversion</summary>
              <p className="form-hint">
                Your factor takes priority for this ingredient in your bakery’s
                converter. Saving does not change inventory or recipe costing.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!customValid || !canSave) return
                  setSaving(true)
                  setNotice('')
                  try {
                    const data = await requestReferences({
                      privateId:
                        active?.scope === 'private' &&
                        !active.id.startsWith('inventory-')
                          ? active.id
                          : null,
                      referenceId:
                        active?.scope === 'shared'
                          ? active.id
                          : active?.referenceId,
                      inventoryIngredientId:
                        inventoryId || active?.inventoryIngredientId || null,
                      ingredientName: active?.ingredientName || name.trim(),
                      description,
                      referenceWeightG: measuredWeight,
                      originalQuantity: measuredVolume,
                      originalUnit: volumeUnit,
                      referenceVolumeMl:
                        measuredVolume! * units[volumeUnit].factor,
                    })
                    setReferences(data)
                    const saved = data.find(
                      (r) =>
                        r.scope === 'private' &&
                        ((active &&
                          r.referenceId ===
                            (active.referenceId || active.id)) ||
                          ((inventoryId || active?.inventoryIngredientId) &&
                            r.inventoryIngredientId ===
                              (inventoryId || active?.inventoryIngredientId)) ||
                          (active?.scope === 'private' && r.id === active.id) ||
                          (!active && r.ingredientName === name.trim())),
                    )
                    if (saved) setSelected(saved.id)
                    setNotice('Custom conversion saved for your bakery.')
                    setError('')
                  } catch (e) {
                    setNotice((e as Error).message)
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                <div className="baking-two">
                  <Field label="Ingredient basis">
                    <select
                      value={active ? 'selected' : 'new'}
                      onChange={(e) => {
                        setSelected(e.target.value === 'new' ? '__new__' : '')
                        setNotice('')
                      }}
                    >
                      <option value="selected">
                        Selected reference / saved ingredient
                      </option>
                      <option value="new">New custom ingredient</option>
                    </select>
                  </Field>
                  {!active && (
                    <Field label="Ingredient name">
                      <input
                        value={name}
                        maxLength={200}
                        required
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                  )}
                  <Field label="Optional inventory ingredient link">
                    <select
                      value={inventoryId}
                      onChange={(e) => setInventoryId(e.target.value)}
                    >
                      <option value="">No additional link</option>
                      {ingredients
                        .filter((i) => i.usedAs === 'ingredient')
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Measured weight (grams)">
                    <input
                      value={weight}
                      required
                      onChange={(e) => setWeight(e.target.value)}
                    />
                  </Field>
                  <Field label="Known volume">
                    <input
                      value={volume}
                      required
                      onChange={(e) => setVolume(e.target.value)}
                    />
                  </Field>
                  <Field label="Volume unit">
                    <UnitSelect
                      value={volumeUnit}
                      options={volumeUnits}
                      onChange={setVolumeUnit}
                    />
                  </Field>
                  <Field label="Preparation / measuring method">
                    <input
                      value={description}
                      maxLength={500}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                </div>
                {!customValid && (
                  <p className="form-hint">
                    Enter a positive measured weight, positive known volume, and
                    ingredient name to save.
                  </p>
                )}
                {!canSave && (
                  <p className="form-hint">
                    A connected owner or manager account is required to save.
                  </p>
                )}
                <p
                  role="status"
                  className={
                    notice && !notice.startsWith('Custom conversion saved')
                      ? 'baking-error'
                      : ''
                  }
                >
                  {notice}
                </p>
                <button
                  className="btn"
                  disabled={!customValid || !canSave || saving}
                >
                  {saving ? 'Saving…' : 'Save custom conversion'}
                </button>
              </form>
            </details>
          </section>
        </TabsContent>
        <TabsContent value="Weight & Volume">
          <div className="baking-two baking-card-grid">
            <MeasureCard
              title="Weight"
              options={weightUnits}
              initialFrom="lb"
              initialTo="oz"
            />
            <MeasureCard
              title="Volume"
              options={volumeUnits}
              initialFrom="cup"
              initialTo="tbsp"
            />
          </div>
          <p className="baking-note">
            oz measures weight; fl oz measures volume. Converting between weight
            and volume requires an ingredient-specific factor.{' '}
            <button
              className="btn secondary"
              onClick={() => setTab('Ingredients')}
            >
              Go to Ingredients
            </button>
          </p>
        </TabsContent>
        <TabsContent value="Oven Temperature">
          <OvenCard />
        </TabsContent>
        <TabsContent value="Yeast">
          <YeastCard />
        </TabsContent>
      </Tabs>
    </div>
  )
}
function OvenCard() {
  const [quantity, setQuantity] = useState('350'),
    [from, setFrom] = useState('°F')
  const q = parseBakingQuantity(quantity, true),
    to = from === '°F' ? '°C' : '°F'
  const value = q === null ? null : ovenConvert(q, from),
    result = value !== null && Number.isFinite(value) ? value : null
  return (
    <section className="panel baking-card">
      <h2>Oven temperature</h2>
      <div className="baking-controls">
        <Field label="Temperature">
          <input
            type="number"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="From scale">
          <UnitSelect value={from} onChange={setFrom} options={['°F', '°C']} />
        </Field>
        <button
          className="icon-button baking-swap"
          aria-label="Swap temperature scales"
          disabled={result === null}
          onClick={() => {
            setQuantity(String(result))
            setFrom(to)
          }}
        >
          <ArrowLeftRight size={20} />
        </button>
      </div>
      <Result
        result={result}
        text={`${bakingDisplay(result)} ${to}`}
        error={
          result === null
            ? 'Enter a finite numeric temperature. Negative temperatures are allowed.'
            : ''
        }
        reset={() => {
          setQuantity('350')
          setFrom('°F')
        }}
      />
      <p className="form-hint">
        Calculated using °C = (°F − 32) / 1.8, displayed to two decimal places.
        No fan or convection adjustment.
      </p>
      <h3>Common oven settings · approximate</h3>
      <table className="baking-table">
        <thead>
          <tr>
            <th>Fahrenheit</th>
            <th>Rounded Celsius setting</th>
          </tr>
        </thead>
        <tbody>
          {[250, 275, 300, 325, 350, 375, 400, 425, 450, 475, 500].map((f) => (
            <tr key={f}>
              <td>{f}°F</td>
              <td>≈ {Math.round(ovenConvert(f, '°F') / 10) * 10}°C</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
function YeastCard() {
  const types = Object.keys(yeastRatios)
  const [quantity, setQuantity] = useState('10'),
    [from, setFrom] = useState(types[0]),
    [to, setTo] = useState(types[1]),
    [unit, setUnit] = useState('g')
  const q = parseBakingQuantity(quantity),
    value = q === null ? null : yeastConvert(q, from, to),
    result = value !== null && Number.isFinite(value) ? value : null
  return (
    <section className="panel baking-card">
      <h2>Yeast substitution</h2>
      <div className="baking-two">
        <Field label="Starting yeast type">
          <UnitSelect value={from} onChange={setFrom} options={types} />
        </Field>
        <Field label="Target yeast type">
          <UnitSelect value={to} onChange={setTo} options={types} />
        </Field>
        <Field label="Quantity">
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Weight unit">
          <UnitSelect
            value={unit}
            onChange={(next) => {
              if (q !== null) setQuantity(String(bakingConvert(q, unit, next)))
              setUnit(next)
            }}
            options={['g', 'oz']}
          />
        </Field>
      </div>
      <div className="baking-actions">
        <button
          className="btn secondary"
          disabled={result === null}
          onClick={() => {
            setQuantity(String(result))
            setFrom(to)
            setTo(from)
          }}
        >
          <ArrowLeftRight size={16} /> Swap yeast types
        </button>
      </div>
      <Result
        result={result}
        text={`Approximately ${bakingDisplay(result)} ${unitLabel(unit)} ${to}`}
        error={
          result === null
            ? 'Enter a non-negative finite yeast weight, such as 10 or 1 1/2.'
            : ''
        }
        reset={() => {
          setQuantity('10')
          setFrom(types[0])
          setTo(types[1])
          setUnit('g')
        }}
      />
      <p className="form-hint">
        Ratio used: 1 g fresh yeast = 0.4 g active dry yeast = 0.33 g instant
        yeast. Every direction uses this same ratio.
      </p>
      <p className="baking-note">
        Yeast substitutions are approximate. Follow your recipe and yeast
        manufacturer’s instructions for preparation and use.
      </p>
    </section>
  )
}
