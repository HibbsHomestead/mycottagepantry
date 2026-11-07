import {
  launchFeatures,
  launchPricing,
  planIncludes,
  planUserLabel,
  type FeatureId,
  type PlanId,
} from '@/lib/launch-plans'
import { freeRegistrationPolicyReady } from '@/lib/free-registration-policy'
import { signupPlanHref } from '@/lib/signup-plan'

const copy: Record<
  PlanId,
  { headline: string; audience: string; benefits: readonly string[] }
> = {
  free: {
    headline: 'Start with a clearer picture.',
    audience: 'For food makers building a small recipe and product catalog.',
    benefits: [
      'Understand what each recipe and product costs.',
      'Include your time, packaging, overhead and waste.',
      'Keep ingredient and packaging costs together.',
      'Explore selling prices before choosing a price.',
      'Create standard labels — Coming soon for Free.',
      'Export a copy of your records.',
    ],
  },
  'mixing-bowl': {
    headline: 'Keep the day’s work in good order.',
    audience: 'For food makers running the everyday work of a solo business.',
    benefits: [
      'Understand what each recipe and product costs.',
      'Know what is on hand and what needs restocking.',
      'Plan and complete individual batches.',
      'Create and print labels with your logo and fonts.',
      'Record sales and business expenses.',
      'Review existing reports and export your figures.',
    ],
  },
  'bakers-bench': {
    headline: 'See what the next batches need.',
    audience:
      'For food makers looking for more planning tools as production grows.',
    benefits: [
      'Understand your recipe and product costs.',
      'Keep stock and low-stock information close at hand.',
      'Create and print labels for your products.',
      'Plan several batches together — Coming soon.',
      'Combine ingredient and packaging needs — Coming soon.',
      'Compare reporting periods — Coming soon.',
    ],
  },
  'cottage-kitchen': {
    headline: 'Run your business together — includes two users.',
    audience: 'For food makers and handmade businesses sharing the daily work.',
    benefits: [
      'Understand recipe, product and handmade material costs.',
      'Know what ingredients, packaging and materials are on hand.',
      'Track fabric lengths and separate remnants.',
      'Turn handmade production into finished stock.',
      'Create and print your own label designs.',
      'Share your business with individual logins; invitations Coming soon.',
    ],
  },
  'cottage-mercantile': {
    headline: 'Bring what you make and sell together.',
    audience:
      'For food makers, handmade businesses and resale sellers. The complete Cottage Pantry program — including resale, consignment, and business team access.',
    benefits: [
      'Bring food and handmade production records together.',
      'See purchase costs separately from selling prices.',
      'Receive packs and cases as sellable units.',
      'Keep track of consignment stock and sales.',
      'Record consignor payouts and customer refunds.',
      'Work together with individual logins; invitations Coming soon.',
    ],
  },
}

function scope(plan: PlanId, feature: FeatureId) {
  if (!planIncludes(plan, feature)) return '—'
  const f = launchFeatures.find((row) => row.id === feature)!
  if (feature === 'basicProductWorkflows') {
    if (plan === 'cottage-kitchen') return 'Handmade only; resale excluded'
    if (plan !== 'cottage-mercantile') return 'Proposed; access review pending'
  }
  if (
    plan === 'free' &&
    ['recipeCosting', 'productPricing', 'inventory'].includes(feature)
  )
    return 'Included; proposed count limits'
  if (plan === 'free' && 'freeScope' in f) return 'Coming soon for Free'
  if (f.status !== 'implemented') return 'Coming soon'
  if (plan === 'cottage-kitchen' && feature === 'craftResaleEntryAssist')
    return 'Materials only; review before saving'
  if (feature === 'craftResaleEntryAssist')
    return 'Review before saving; existing barcode matches only'
  if (feature === 'crossTypeReceiptMatching')
    return plan === 'cottage-kitchen'
      ? 'Manual; resale excluded'
      : 'Manual matching'
  return 'Included'
}

export function PricingComparison() {
  return (
    <section
      className="public-width plan-comparison"
      aria-labelledby="plan-comparison-title"
    >
      <div className="plan-comparison-heading">
        <div>
          <p className="public-eyebrow">Room for your next chapter</p>
          <h2 id="plan-comparison-title">Find your place in the pantry.</h2>
        </div>
        <p>
          USD per business, per month. Monthly billing only. Compare intended
          features below; unfinished tools are marked Coming soon.
        </p>
      </div>
      <p className="registration-notice plan-launch-notice">
        You can create your account now. Paid activation is not yet available.
        Your chosen plan is saved; registration collects no payment.
        {!freeRegistrationPolicyReady() &&
          ' Business setup is paused until approved Terms and Privacy are published.'}{' '}
        Free’s proposed limits are not active. Existing customer access is
        preserved.
      </p>
      <div className="plan-comparison-grid">
        {launchPricing.plans.map((plan) => {
          const text = copy[plan.id]
          return (
            <article
              className={`plan-card plan-card-${plan.id}`}
              key={plan.id}
              aria-labelledby={`plan-${plan.id}`}
            >
              <div className="plan-card-top">
                <p className="public-eyebrow">
                  {plan.id === 'free'
                    ? 'A small beginning'
                    : plan.id === 'cottage-mercantile'
                      ? 'Make, stock & sell'
                      : 'A little more room'}
                </p>
                <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
                <p className="plan-price">
                  <strong>${plan.monthlyUsd}</strong>
                  <span>
                    {' '}
                    USD / month
                    <br />
                    per business
                  </span>
                </p>
                <h4>{text.headline}</h4>
                <p className="plan-audience">{text.audience}</p>
              </div>
              <ul className="plan-benefits">
                {text.benefits.map((benefit) => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
              <div className="plan-limits">
                <p>
                  <strong>{planUserLabel(plan.id)}.</strong>
                </p>
                {plan.id === 'free' ? (
                  <p>
                    Proposed: 5 active recipes, 5 active products and 10
                    stock-tracked items. Cost-only records do not count toward
                    the stock limit. Limited-stock batches: Coming soon.
                  </p>
                ) : (
                  <p>
                    Recipes, products and stock items: limits not set. Recipe
                    imports: 20/hour; 100 active drafts per business. Usage
                    safeguards apply.
                  </p>
                )}
                {['cottage-kitchen', 'cottage-mercantile'].includes(
                  plan.id,
                ) && (
                  <p>
                    Handmade designs: up to 100 material lines each. Advanced
                    planning and member administration: Coming soon.
                  </p>
                )}
                {plan.id === 'cottage-kitchen' && (
                  <p className="plan-exclusion">
                    <strong>Excludes resale and consignment.</strong>
                  </p>
                )}
                {plan.id === 'cottage-mercantile' && (
                  <p>
                    New team member setup awaits confirmation of the user limit.
                    Product-import and automatic receipt-reading allowances are
                    undecided; automatic reading is not offered here.
                  </p>
                )}
              </div>
              <footer className="plan-card-footer">
                <p className="plan-status">
                  {plan.id === 'free'
                    ? 'Account registration only'
                    : plan.id === 'cottage-mercantile'
                      ? 'In development — not available for purchase'
                      : 'Not yet available for purchase'}
                </p>
                <a className="public-button" href={signupPlanHref(plan.id)}>
                  {plan.id === 'free'
                    ? 'Get Started Free'
                    : `Choose ${plan.name}`}
                </a>
                <p className="plan-cta-note">
                  {plan.id === 'free'
                    ? 'Create your account and verify your email.'
                    : 'Save your plan choice and create an account; paid access starts only after verified billing.'}
                </p>
              </footer>
            </article>
          )
        })}
      </div>
      <div className="plan-table-heading">
        <h3 id="plan-details-title">A closer look at each plan</h3>
        <p>
          Intended allocation, with today’s availability stated separately.
          Scroll across the comparison on smaller screens.
        </p>
      </div>
      <div
        className="plan-table-scroll"
        role="region"
        aria-labelledby="plan-details-title"
        tabIndex={0}
      >
        <table className="plan-details-table">
          <caption>
            Monthly USD pricing, total business users and intended feature
            access
          </caption>
          <thead>
            <tr>
              <th scope="col">Feature or limit</th>
              {launchPricing.plans.map((plan) => (
                <th scope="col" key={plan.id}>
                  {plan.name}
                  <span>${plan.monthlyUsd} USD/month per business</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Total business users</th>
              {launchPricing.plans.map((p) => (
                <td key={p.id}>{planUserLabel(p.id)}</td>
              ))}
            </tr>
            {(['recipes', 'products', 'stock-tracked items'] as const).map(
              (kind, i) => (
                <tr key={kind}>
                  <th scope="row">Active {kind}</th>
                  {launchPricing.plans.map((p) => (
                    <td key={p.id}>
                      {p.id === 'free'
                        ? `${[5, 5, 10][i]} proposed; not active`
                        : 'No numeric catalog cap set'}
                    </td>
                  ))}
                </tr>
              ),
            )}
            <tr>
              <th scope="row">Recipe imports per business</th>
              {launchPricing.plans.map((p) => (
                <td key={p.id}>
                  {p.id === 'free' ? '—' : '20/hour; 100 active drafts'}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Handmade design size</th>
              {launchPricing.plans.map((p) => (
                <td key={p.id}>
                  {['cottage-kitchen', 'cottage-mercantile'].includes(p.id)
                    ? '1–100 material lines'
                    : '—'}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Individual logins and shared business</th>
              {launchPricing.plans.map((p) => (
                <td key={p.id}>
                  {p.id === 'cottage-kitchen'
                    ? 'Two total users; invitations Coming soon'
                    : p.id === 'cottage-mercantile'
                      ? 'User limit undecided; invitations Coming soon'
                      : 'One user'}
                </td>
              ))}
            </tr>
            {launchFeatures
              .filter((f) => !['security', 'accountEmail'].includes(f.id))
              .map((f) => (
                <tr key={f.id}>
                  <th scope="row">
                    {f.id === 'resaleMerchandise'
                      ? 'Full resale variant management'
                      : f.label}
                  </th>
                  {launchPricing.plans.map((p) => (
                    <td key={p.id}>{scope(p.id, f.id)}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="plan-table-note">
        No unlimited-use offer. Product-import, automatic receipt-reading and
        storage allowances still need review. Resale and consignment are
        excluded from Cottage Kitchen. Full resale variants, purchase orders,
        yarn stock, material lots, stock by location, activity reports and sales
        synchronization are Coming soon. Existing records and exports remain
        available when access changes.
      </p>
    </section>
  )
}
