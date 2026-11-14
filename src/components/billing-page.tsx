import { StripeOwnerBilling } from './stripe-owner-billing'
import { PublicSite } from './public-site'
import './registration.css'

/** Owner-scoped billing uses the independent Stripe API. */
export function BillingPage() {
  return (
    <PublicSite>
      <section className="registration-shell">
        <div className="registration-paper">
          <p className="public-eyebrow">Settings</p>
          <h1>Subscription &amp; Billing</h1>
          <StripeOwnerBilling />
        </div>
      </section>
    </PublicSite>
  )
}
