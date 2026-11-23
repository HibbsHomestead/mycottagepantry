import { useEffect, useRef, useState } from 'react'
import {
  businessPriceTaxMode,
  money,
  type BusinessPriceTaxMode,
  type Item,
} from '@/lib/domain'
import {
  priceTaxChoiceLabel,
  type PriceTaxPlan,
  type PriceTaxStrategy,
} from '@/lib/business-price-tax'
import { FormErrorNotice } from './form-error-notice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import './business-price-tax.css'

export function ProductPriceTaxField({
  product,
  business,
  change,
  disabled,
}: {
  product: Item
  business: Item
  change: (key: string, value: string) => void
  disabled?: boolean
}) {
  const mode = product.priceTaxMode || 'configured'
  const original = useRef(mode).current
  return (
    <label className="field">
      <span>Entered prices</span>
      <select
        value={mode}
        onChange={(e) => change('priceTaxMode', e.target.value)}
        disabled={disabled}
      >
        <option value="inherit">
          Use business default (
          {priceTaxChoiceLabel(businessPriceTaxMode(business)).toLowerCase()})
        </option>
        <option value="includes">Price includes tax (product override)</option>
        <option value="before">Tax added at sale (product override)</option>
        {original === 'configured' && (
          <option value="configured">
            Use tax rate settings (existing product)
          </option>
        )}
        {original.startsWith('saved-') && (
          <option value={original}>
            {priceTaxChoiceLabel(original)} (previously saved default)
          </option>
        )}
      </select>
    </label>
  )
}

type PriceTaxAction = 'priceTaxDefault' | 'priceTaxPreview' | 'priceTaxApply'
type Review = { plan: PriceTaxPlan; review: string }
export type PriceTaxRequest = (
  action: PriceTaxAction,
  data: Record<string, unknown>,
) => Promise<{
  plan?: PriceTaxPlan
  review?: string
  priceTaxResult?: { updated: number; failed: number }
}>

export function BusinessPriceTaxSettings({
  business,
  request,
  disabled,
}: {
  business: Item
  request?: PriceTaxRequest
  disabled: boolean
}) {
  const current = businessPriceTaxMode(business)
  const [mode, setMode] = useState<BusinessPriceTaxMode>(current)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const [strategy, setStrategy] = useState<PriceTaxStrategy | ''>('')
  const [overrides, setOverrides] = useState<'preserve' | 'replace' | ''>('')
  const [review, setReview] = useState<Review | null>(null)
  const [bulkError, setBulkError] = useState('')
  const locked = disabled || pending || !request
  useEffect(() => {
    setMode(current)
  }, [current])

  async function run(action: PriceTaxAction) {
    if (!request || locked) return
    if (action === 'priceTaxDefault') setError('')
    else setBulkError('')
    setNotice('')
    setPending(true)
    try {
      const response = await request(
        action,
        action === 'priceTaxDefault'
          ? { mode, expected: current }
          : {
              strategy,
              includeOverrides: overrides === 'replace',
              review: review?.review,
            },
      )
      if (action === 'priceTaxPreview') {
        if (!response.plan || !response.review)
          throw new Error('The preview could not be loaded. Try again.')
        setReview({ plan: response.plan, review: response.review })
      } else if (action === 'priceTaxApply') {
        if (!response.priceTaxResult)
          throw new Error(
            'The server did not confirm the update. Refresh before retrying.',
          )
        const { updated, failed } = response.priceTaxResult
        setNotice(
          `${updated} ${updated === 1 ? 'product' : 'products'} updated. ${failed} failed.`,
        )
        setOpen(false)
      } else {
        setNotice(
          'Business default saved. Existing prices keep their current tax treatment.',
        )
      }
    } catch (e) {
      if (action === 'priceTaxDefault') setError((e as Error).message)
      else {
        setReview(null)
        setBulkError((e as Error).message)
      }
    } finally {
      setPending(false)
    }
  }

  const plan = review?.plan
  return (
    <section
      className="tax-price-settings"
      aria-label="Product price tax treatment"
    >
      <fieldset disabled={locked}>
        <legend>How are your product prices entered?</legend>
        <label>
          <input
            type="radio"
            name="business-price-tax"
            checked={mode === 'includes'}
            onChange={() => {
              setMode('includes')
              setNotice('')
            }}
          />
          <span>
            <strong>Tax included in price</strong>
            <br />
            The entered price already includes applicable sales tax.
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="business-price-tax"
            checked={mode === 'before'}
            onChange={() => {
              setMode('before')
              setNotice('')
            }}
          />
          <span>
            <strong>Tax added to price</strong>
            <br />
            Applicable sales tax is added to the entered price.
          </span>
        </label>
      </fieldset>
      <p>
        This setting does not change tax rates, exemptions, or which products
        are taxable.
      </p>
      <p className="muted">
        The default applies to new products. To change how existing prices are
        treated, review and apply it separately.
      </p>
      {notice && <p role="status">{notice}</p>}
      <FormErrorNotice message={error} />
      <div className="tax-price-actions">
        <button
          type="button"
          className="btn"
          disabled={
            locked ||
            (current === mode && business.defaultPriceTaxMode === mode)
          }
          onClick={() => void run('priceTaxDefault')}
        >
          Save price tax default
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={locked || mode !== current}
          onClick={() => {
            setStrategy('')
            setOverrides('')
            setReview(null)
            setBulkError('')
            setOpen(true)
          }}
        >
          Apply to existing products…
        </button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next)
        }}
      >
        <DialogContent className="tax-price-dialog">
          <DialogHeader>
            <DialogTitle>Apply to existing products</DialogTitle>
            <DialogDescription>
              Apply “{priceTaxChoiceLabel(current)}” to existing products. Saved
              sales, receipts, orders, and tax records stay as recorded.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={locked}>
            <legend>What should stay the same?</legend>
            <label>
              <input
                type="radio"
                name="bulk-price-strategy"
                checked={strategy === 'entered'}
                onChange={() => {
                  setStrategy('entered')
                  setReview(null)
                }}
              />
              <span>
                <strong>Preserve entered prices</strong>
                <br />
                Keep the amounts entered on product records. The customer total
                and margin may change.
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="bulk-price-strategy"
                checked={strategy === 'total'}
                onChange={() => {
                  setStrategy('total')
                  setReview(null)
                }}
              />
              <span>
                <strong>Preserve customer totals</strong>
                <br />
                Recalculate entered prices to keep the customer total per
                selling unit using tax rates effective on the preview date. The
                margin may change. If a total cannot be matched to the cent,
                nothing is saved.
              </span>
            </label>
          </fieldset>
          <fieldset disabled={locked}>
            <legend>What should happen to product overrides?</legend>
            <label>
              <input
                type="radio"
                name="bulk-price-overrides"
                checked={overrides === 'preserve'}
                onChange={() => {
                  setOverrides('preserve')
                  setReview(null)
                }}
              />{' '}
              Preserve existing overrides
            </label>
            <label>
              <input
                type="radio"
                name="bulk-price-overrides"
                checked={overrides === 'replace'}
                onChange={() => {
                  setOverrides('replace')
                  setReview(null)
                }}
              />{' '}
              Replace existing overrides with the business default
            </label>
          </fieldset>
          {plan && (
            <div aria-live="polite">
              <p>
                <strong>{plan.rows.length} products affected</strong> ·{' '}
                {Object.entries(plan.counts)
                  .map(([type, count]) => `${type}: ${count}`)
                  .join(' · ')}
              </p>
              <p>
                {plan.overridesReplaced} overrides replaced ·{' '}
                {plan.overrides - plan.overridesReplaced} preserved · Tax rates
                on {plan.date}
              </p>
              {plan.rows.length > 0 && (
                <div
                  className="tax-price-review"
                  tabIndex={0}
                  role="region"
                  aria-label="Product price preview"
                >
                  <table>
                    <thead>
                      <tr>
                        {[
                          'Product',
                          'Current → proposed treatment',
                          'Price',
                          'Entered price',
                          'Tax',
                          'Customer total',
                          'Margin',
                        ].map((label) => (
                          <th key={label} scope="col">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {plan.rows.flatMap((row) =>
                        (row.prices.length ? row.prices : [null]).map(
                          (price) => (
                            <tr key={`${row.id}-${price?.field || 'unpriced'}`}>
                              <th scope="row">
                                {row.name}
                                <br />
                                <small>
                                  {row.type}
                                  {row.override ? ' · Override replaced' : ''}
                                </small>
                              </th>
                              {row.error ? (
                                <td colSpan={6}>{row.error}</td>
                              ) : (
                                <>
                                  <td>
                                    {priceTaxChoiceLabel(row.existingMode)} →
                                    Use business default
                                    <br />
                                    <small>
                                      {row.beforeLabel} → {row.afterLabel}
                                    </small>
                                  </td>
                                  {price ? (
                                    <>
                                      <td>
                                        {price.field === 'wholesale'
                                          ? 'Wholesale'
                                          : 'Selling'}
                                      </td>
                                      {(['price', 'tax', 'total'] as const).map(
                                        (field) => (
                                          <td key={field}>
                                            {money(price.before[field])} →{' '}
                                            {money(price.after[field])}
                                          </td>
                                        ),
                                      )}
                                      <td>
                                        {formatMargin(price.before.margin)} →{' '}
                                        {formatMargin(price.after.margin)}
                                      </td>
                                    </>
                                  ) : (
                                    <td colSpan={5}>No entered price</td>
                                  )}
                                </>
                              )}
                            </tr>
                          ),
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <FormErrorNotice
            message={
              bulkError ||
              (plan?.failures
                ? `0 products updated. ${plan.failures} of ${plan.rows.length} products failed validation. Review the affected rows or choose another strategy and preview again.`
                : '')
            }
          />
          <div className="tax-price-actions">
            <button
              type="button"
              className="btn secondary"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            {plan ? (
              <button
                type="button"
                className="btn"
                disabled={locked || !plan.rows.length || Boolean(plan.failures)}
                onClick={() => void run('priceTaxApply')}
              >
                Confirm and apply to {plan.rows.length}{' '}
                {plan.rows.length === 1 ? 'product' : 'products'}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={locked || !strategy || !overrides}
                onClick={() => void run('priceTaxPreview')}
              >
                Preview changes
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

const formatMargin = (value: number | null) =>
  value === null ? 'Unavailable' : `${value.toFixed(1)}%`
