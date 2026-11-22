import { SubmissionForm } from './submission-form'
import { FormErrorNotice } from './form-error-notice'
import { customerMessage } from '@/lib/customer-message'
import { useEffect, useState } from 'react'
import { billingRequest } from '@/lib/billing-client'
import type { AdminMetadata } from '@/lib/platform-admin-types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
const amount = (p: AdminMetadata) => {
  const format = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: p.currency,
  })
  return format.format(
    p.amountCents / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2),
  )
}
const date = (v: string) =>
  new Date(v).toLocaleDateString(undefined, { timeZone: 'UTC' })
const financeHref = '/oven#Finance/Overview'
const paymentHref = (id: string) =>
  '/oven?subscriptionPayment=' + encodeURIComponent(id) + '#Finance/Register'

/** All fields come from the verified, tenant-scoped payment API. */
export function SubscriptionExpenses() {
  const [data, setData] = useState<AdminMetadata | null>(null)
  const [payment, setPayment] = useState<AdminMetadata | null>(null)
  const [account, setAccount] = useState('')
  const [category, setCategory] = useState('Software')
  const [automatic, setAutomatic] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [defaultAccount, setDefaultAccount] = useState('')
  const [defaultCategory, setDefaultCategory] = useState('Software')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastRecorded, setLastRecorded] = useState('')
  const [expanded, setExpanded] = useState(false)
  async function send(body: AdminMetadata) {
    const result = await billingRequest(body)
    setData(result.expenses)
    return result.expenses
  }
  useEffect(() => {
    let active = true
    billingRequest({ action: 'expenses' })
      .then((result) => {
        if (!active) return
        setData(result.expenses)
        setEnabled(result.expenses?.preference?.enabled || false)
        setDefaultAccount(result.expenses?.preference?.account || '')
        setDefaultCategory(result.expenses?.preference?.category || 'Software')
      })
      .catch(() => {
        if (active)
          setError(
            'Subscription expense records could not be loaded. Refresh this page to retry.',
          )
      })
    return () => {
      active = false
    }
  }, [])
  async function run(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (failure) {
      setError(
        customerMessage(
          failure,
          'We couldn’t save that change. Your entries are kept here. Please retry or contact support.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  if (!data?.available) {
    if (data?.preference?.configured)
      return (
        <section className="subscription-expenses">
          <h3>Subscription expense tracking</h3>
          <p>
            Finance is not available on your current plan. Automatic recording
            cannot post new entries.
          </p>
          {data.preference.enabled ? (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await send({ action: 'expense_preferences', enabled: false })
                  setNotice('Automatic tracking is off.')
                })
              }
            >
              Turn off automatic tracking
            </button>
          ) : (
            <p>Automatic tracking is off.</p>
          )}
          <FormErrorNotice message={error} />
        </section>
      )
    return error ? <FormErrorNotice message={error} /> : null
  }
  const payments: AdminMetadata[] = data.payments || []
  const offer = payments.find(
    (p) => p.kind === 'payment' && !p.dismissed && p.status !== 'recorded',
  )
  function review(p: AdminMetadata) {
    setPayment(p)
    setAccount(p.account || '')
    setCategory(p.category || 'Software')
    setAutomatic(false)
    setConfirmed(false)
    setError('')
    setNotice('')
    if (p.kind === 'refund') {
      const original = payments.find((x) => x.id === p.originalPaymentId)
      setAccount(original?.account || '')
      setCategory(original?.category || 'Software')
    }
  }
  const options = (items: string[]) =>
    items.map((value) => (
      <option key={value} value={value}>
        {value === 'Software' ? 'Software & subscriptions' : value}
      </option>
    ))
  return (
    <section
      className="subscription-expenses billing-card"
      aria-label="Subscription expenses"
    >
      {data.notice && <p role="status">{data.notice}</p>}
      {offer && (
        <div className="subscription-expense-offer">
          <h3>Add this to your business expenses?</h3>
          <p>Record your Cottage Pantry subscription in Finance.</p>
          <p>
            <strong>
              {offer.planName} · {amount(offer)} {offer.currency}
            </strong>
            <br />
            {date(offer.paidAt)} · Software &amp; subscriptions
          </p>
          <p className="billing-small">
            This only records payments already made. It does not authorize
            additional charges.
          </p>
          {offer.status === 'review' && (
            <p>
              Saved for review. Choose an available account and category to
              finish recording.
            </p>
          )}
          <div className="button-row">
            <button className="btn primary" onClick={() => review(offer)}>
              Add to Finance
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await send({ action: 'expense_skip', paymentId: offer.id })
                })
              }
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p role="status">
          {notice}{' '}
          <a href={lastRecorded ? paymentHref(lastRecorded) : financeHref}>
            View in Finance
          </a>
        </p>
      )}

      <details
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        open={expanded}
      >
        <summary>Subscription payment records &amp; automatic tracking</summary>
        <p>
          Record successful payments in this business’s Finance section. Turning
          tracking off leaves your subscription and existing records unchanged.
          Past payments are not added automatically.
        </p>
        <SubmissionForm
          className="subscription-expense-form"
          onSubmit={(event) => {
            event.preventDefault()
            run(async () => {
              await send({
                action: 'expense_preferences',
                enabled,
                account: defaultAccount,
                category: defaultCategory,
              })
              setNotice('Subscription expense preferences saved.')
            })
          }}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Automatically record subscription payments
          </label>
          <label>
            Default category
            <select
              value={defaultCategory}
              onChange={(e) => setDefaultCategory(e.target.value)}
              required={enabled}
            >
              {options(data.categories)}
            </select>
          </label>
          <label>
            Default payment account
            <select
              value={defaultAccount}
              onChange={(e) => setDefaultAccount(e.target.value)}
              required={enabled}
            >
              <option value="">Choose an account</option>
              {options(data.accounts)}
            </select>
          </label>
          <p className="billing-small">
            Each future successful payment is recorded using these defaults. If
            they are unavailable, the payment stays available for review.
          </p>

          <FormErrorNotice message={error} />
          <button className="btn secondary" disabled={busy}>
            Save tracking preferences
          </button>
        </SubmissionForm>
        <h4>Confirmed payments and refunds</h4>
        {!payments.length && (
          <p>No paid subscription payments are available to record.</p>
        )}
        <ul className="subscription-payment-list">
          {payments.map((p) => (
            <li key={p.id}>
              <span>
                {p.kind === 'refund' ? 'Refund · ' : ''}
                {p.planName} · {amount(p)} {p.currency} · {date(p.paidAt)}
              </span>
              {p.status === 'recorded' ? (
                <span>
                  Recorded · <a href={paymentHref(p.id)}>View in Finance</a>
                </span>
              ) : (
                <button className="btn secondary" onClick={() => review(p)}>
                  {p.status === 'review' ? 'Review' : 'Add to Finance'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
      <Dialog
        open={!!payment}
        onOpenChange={(open) => {
          if (!busy && !open) setPayment(null)
        }}
      >
        <DialogContent className="subscription-expense-dialog">
          <DialogHeader>
            <DialogTitle>
              {payment?.kind === 'refund'
                ? 'Review subscription refund'
                : 'Review subscription expense'}
            </DialogTitle>
            <DialogDescription>
              Record a payment already made. This does not charge you or change
              your subscription.
            </DialogDescription>
          </DialogHeader>
          {payment && (
            <SubmissionForm
              className="subscription-expense-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (!confirmed || !account || busy) return
                run(async () => {
                  await send({
                    action: 'expense_record',
                    paymentId: payment.id,
                    category,
                    account,
                    confirmed: true,
                  })
                  setLastRecorded(payment.id)
                  if (automatic) {
                    try {
                      await send({
                        action: 'expense_preferences',
                        enabled: true,
                        category,
                        account,
                      })
                      setEnabled(true)
                      setDefaultCategory(category)
                      setDefaultAccount(account)
                    } catch {
                      setPayment(null)
                      setExpanded(true)
                      setDefaultCategory(category)
                      setDefaultAccount(account)
                      setNotice(
                        'Recorded in Finance. Automatic tracking was not enabled; review and save its preferences below.',
                      )
                      return
                    }
                  }
                  setPayment(null)
                  setNotice('Recorded in Finance.')
                })
              }}
            >
              <p>
                <strong>
                  {payment.planName} · {amount(payment)} {payment.currency}
                </strong>
                <br />
                {date(payment.paidAt)} · {payment.payee}
              </p>
              <p>{payment.description}</p>
              <p className="billing-small">
                {payment.kind === 'refund' ? 'Original invoice' : 'Invoice'}{' '}
                {payment.invoiceReference}. Discounts:{' '}
                {amount({
                  ...payment,
                  amountCents: (payment.invoiceDetails?.discounts || []).reduce(
                    (n: number, d: AdminMetadata) => n + (d.amount || 0),
                    0,
                  ),
                })}
                . Tax:{' '}
                {payment.invoiceDetails?.taxCents != null ||
                payment.invoiceDetails?.tax?.length
                  ? amount({
                      ...payment,
                      amountCents:
                        payment.invoiceDetails?.taxCents ??
                        payment.invoiceDetails.tax.reduce(
                          (n: number, t: AdminMetadata) => n + (t.amount || 0),
                          0,
                        ),
                    })
                  : 'Not provided separately'}
                . The expense includes the actual paid total.
              </p>
              {payment.receiptUrl && (
                <a href={payment.receiptUrl} target="_blank" rel="noreferrer">
                  View invoice or receipt
                </a>
              )}
              <label>
                Category
                <select
                  value={category}
                  disabled={payment.kind === 'refund'}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {options(data.categories)}
                </select>
              </label>
              <label>
                Payment account
                <select
                  value={account}
                  disabled={payment.kind === 'refund'}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Choose the account used to pay</option>
                  {options(data.accounts)}
                </select>
              </label>
              <p className="billing-small">
                If paid personally, save for review and ask your bookkeeper to
                record the supported owner contribution and business payment. No
                funding account is inferred from your card.
              </p>
              {payment.kind !== 'refund' && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={automatic}
                    onChange={(e) => setAutomatic(e.target.checked)}
                  />
                  Automatically record future subscription payments
                </label>
              )}
              {automatic && (
                <p>
                  Each future successful payment is recorded in this business
                  using this account and category. Past payments are not added.
                </p>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I confirm this payment and account are correct.
              </label>

              <FormErrorNotice message={error} />
              <div className="button-row">
                <button
                  type="submit"
                  className="btn primary"
                  disabled={busy || !confirmed || !account}
                >
                  Confirm and record
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await send({
                        action: 'expense_record',
                        paymentId: payment.id,
                        category,
                        account,
                        draft: true,
                      })
                      setPayment(null)
                      setNotice(
                        automatic
                          ? 'Saved for review. Finish setting the default account and category in automatic tracking before enabling it.'
                          : 'Saved for review; balances are unchanged.',
                      )
                    })
                  }
                >
                  Save for review
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => setPayment(null)}
                >
                  Cancel
                </button>
              </div>
            </SubmissionForm>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
