import { Fragment } from 'react'
import { useStripePurchaseAvailability } from '@/lib/stripe-availability'
import { usePricingBilling } from '@/lib/billing-client'
import { launchFeatures, launchPricing, planIncludes } from '@/lib/launch-plans'
import {
  publicPlans,
  planAudience,
  planCardFeatures,
  featurePresentation,
  featureGroups,
} from '@/lib/plan-presentation'
import { signupPlanHref } from '@/lib/signup-plan'

export function PricingComparison() {
  const availability = useStripePurchaseAvailability()
  const owner = usePricingBilling()
  const business = owner.data
  const current = business?.hasSubscription
    ? business.billing?.plan
    : business?.access?.plan === 'free'
      ? 'free'
      : null
  const currentPrice =
    launchPricing.plans.find((p) => p.id === current)?.monthlyUsd ?? 0
  const actionBlockedReason = business?.hasSubscription
    ? business.changeBlockedReason ||
      (business.changes?.some((c: { status: string }) =>
        ['applying', 'pending', 'scheduled', 'releasing'].includes(c.status),
      )
        ? 'A subscription change is pending. Open Billing & Subscription to review or cancel it before choosing another plan.'
        : '')
    : business?.checkoutBlockedReason
  return (
    <section
      className="public-width plan-comparison"
      aria-labelledby="plan-comparison-title"
    >
      <div className="plan-comparison-heading">
        <div>
          <p className="public-eyebrow">Plans &amp; pricing</p>
          <h1 id="plan-comparison-title">Find your place in the pantry.</h1>
        </div>
        <p>Choose a plan for your food, handmade, or homestead business.</p>
      </div>
      <p>USD, per business · billed monthly</p>
      {business && <p>Billing for {business.workspace.name}.</p>}
      {!business?.hasSubscription &&
        !availability.loading &&
        publicPlans.some(
          (p) => p.monthlyUsd > 0 && !availability.plans.includes(p.id),
        ) && (
          <p className="registration-notice" role="status">
            {availability.error
              ? 'Purchase availability could not be checked. Refresh to try again.'
              : 'Some paid plans are currently unavailable for checkout here.'}{' '}
            <a href="https://mycottagepantry.com/pricing">
              Check purchase options on our main site
            </a>
            .
          </p>
        )}
      {actionBlockedReason && (
        <p className="registration-notice">
          Open <a href="/oven/billing">Billing &amp; Subscription</a> to review
          your account before changing plans.
        </p>
      )}
      {owner.member && (
        <p className="registration-notice">
          The business owner manages billing. Ask the owner to choose or change
          the subscription for your business.
        </p>
      )}
      {owner.error && (
        <p role="alert">
          Your current subscription could not be checked.{' '}
          <a href="/oven/billing">Open verified billing</a> before selecting a
          plan.
        </p>
      )}
      <div className="plan-comparison-grid">
        {publicPlans.map((plan) => {
          const isCurrent = current === plan.id
          const changeAvailability = business?.changePlans?.find(
            (p: { id: string }) => p.id === plan.id,
          )
          const available =
            plan.id === 'free' ||
            (business?.hasSubscription
              ? changeAvailability?.purchasable
              : availability.plans.includes(plan.id))
          const waiting =
            owner.loading ||
            (!business?.hasSubscription &&
              plan.id !== 'free' &&
              availability.loading)
          const canAct =
            !waiting &&
            !owner.member &&
            !owner.error &&
            available &&
            !isCurrent &&
            !actionBlockedReason
          const href = business
            ? `/oven/billing?plan=${encodeURIComponent(plan.id)}`
            : `${signupPlanHref(plan.id)}&returnTo=%2Foven%2Fbilling`
          const label = isCurrent
            ? 'Current plan'
            : business?.hasSubscription
              ? `${plan.monthlyUsd > currentPrice ? 'Upgrade' : 'Downgrade'} to ${plan.name}`
              : plan.id === 'free'
                ? 'Get started free'
                : `Choose ${plan.name}`
          return (
            <article
              className={`plan-card plan-card-${plan.id}${isCurrent ? ' plan-card-current' : ''}`}
              key={plan.id}
              aria-labelledby={`plan-${plan.id}`}
            >
              <div className="plan-card-top">
                <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
                <p className="plan-price">
                  <strong>${plan.monthlyUsd}</strong>
                  <span>/month</span>
                </p>
                <p className="plan-audience">{planAudience[plan.id]}</p>
              </div>
              <ul className="plan-benefits">
                {planCardFeatures(plan.id).map((f) => (
                  <li key={f.id}>
                    {f.label}
                    {f.text !== 'Included' && <strong> · {f.text}</strong>}
                  </li>
                ))}
              </ul>
              <footer className="plan-card-footer">
                {canAct ? (
                  <a className="public-button" href={href}>
                    {label}
                  </a>
                ) : (
                  <button className="public-button" disabled>
                    {isCurrent
                      ? 'Current plan'
                      : waiting
                        ? 'Checking availability…'
                        : owner.member
                          ? 'Owner manages billing'
                          : 'Currently unavailable'}
                  </button>
                )}
              </footer>
            </article>
          )
        })}
      </div>
      <a
        className="public-text-link plan-compare-link"
        href="#plan-details-title"
      >
        Compare all features
      </a>
      <div className="plan-table-heading">
        <h3 id="plan-details-title">A closer look at each plan</h3>
        <p>
          Included means implemented and within the plan’s scope. Partial tools
          have limitations; Coming soon tools are unfinished. Scroll across on
          smaller screens. Cottage Kitchen excludes resale and consignment.
        </p>
      </div>
      <div
        className="plan-table-scroll"
        role="region"
        aria-labelledby="plan-details-title"
        tabIndex={0}
      >
        <table className="plan-details-table">
          <caption>Monthly prices and complete feature comparison</caption>
          <thead>
            <tr>
              <th scope="col">Feature or limit</th>
              {publicPlans.map((p) => (
                <th scope="col" key={p.id}>
                  {p.name}
                  <span>${p.monthlyUsd}/month</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="plan-group">
              <th scope="rowgroup" colSpan={publicPlans.length + 1}>
                <span>Pricing &amp; current allowances</span>
              </th>
            </tr>
            <tr>
              <th scope="row">Monthly price per business</th>
              {publicPlans.map((p) => (
                <td key={p.id}>${p.monthlyUsd} USD/month</td>
              ))}
            </tr>
            <tr>
              <th scope="row">New team member setup</th>
              {publicPlans.map((p) => (
                <td key={p.id}>
                  Coming soon · invitations and member administration
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Recipe, product &amp; stock record counts</th>
              {publicPlans.map((p) => (
                <td key={p.id}>
                  No active record-count cap
                  <small>
                    Usage safeguards apply; proposed limits are not active.
                  </small>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Recipe import safeguards</th>
              {publicPlans.map((p) => (
                <td key={p.id}>
                  {planIncludes(p.id, 'recipeImport') ? (
                    '20/hour; 100 active drafts per business'
                  ) : (
                    <span aria-label="Not included">Not included</span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Handmade design size</th>
              {publicPlans.map((p) => (
                <td key={p.id}>
                  {planIncludes(p.id, 'handmadeDesigns') ? (
                    '1–100 material lines'
                  ) : (
                    <span aria-label="Not included">Not included</span>
                  )}
                </td>
              ))}
            </tr>
            {featureGroups.map((group) => (
              <Fragment key={group.name}>
                <tr className="plan-group">
                  <th scope="rowgroup" colSpan={publicPlans.length + 1}>
                    <span>{group.name}</span>
                  </th>
                </tr>
                {group.features.map((id) => {
                  const feature = launchFeatures.find((f) => f.id === id)!
                  return (
                    <tr key={id}>
                      <th scope="row">{feature.label}</th>
                      {publicPlans.map((p) => {
                        const cell = featurePresentation(p.id, id)
                        return (
                          <td key={p.id}>
                            {cell.status === 'excluded' ? (
                              <span aria-label="Not included">
                                Not included
                              </span>
                            ) : (
                              <>
                                <span
                                  className={`feature-state feature-state-${cell.status}`}
                                >
                                  {cell.status === 'implemented' && (
                                    <span aria-hidden="true">✓ </span>
                                  )}
                                  {cell.text}
                                </span>
                                {cell.note && <small>{cell.note}</small>}
                              </>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="plan-table-note">
        Every business retains its existing records, history and exports when
        access changes. Invitations and member administration remain unfinished.
        No proposed record limits are activated by choosing a plan.
      </p>
    </section>
  )
}
