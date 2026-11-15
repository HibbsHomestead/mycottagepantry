import { Fragment } from 'react'
import {
  useStripePurchaseAvailability,
  purchaseStatus,
} from '@/lib/stripe-availability'
import { usePricingBilling } from '@/lib/billing-client'
import {
  launchFeatures,
  launchPricing,
  planUserLabel,
  planIncludes,
} from '@/lib/launch-plans'
import {
  publicPlans,
  planAudience,
  planCardFeatures,
  featurePresentation,
  featureGroups,
  teamAvailabilityNotice,
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
        <p>
          Monthly USD pricing per business. Compare what works today, with
          Partial and Coming soon capabilities clearly marked.
        </p>
      </div>
      <p className="registration-notice plan-launch-notice">
        {business ? `Billing for ${business.workspace.name}. ` : ''}Free setup
        requires email verification and valid business details, with no payment
        method. Paid access starts only after verified billing. Proposed record
        limits are not active.
      </p>
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
                ? 'Get Started Free'
                : `Choose ${plan.name}`
          return (
            <article
              className={`plan-card plan-card-${plan.id}${isCurrent ? ' plan-card-current' : ''}`}
              key={plan.id}
              aria-labelledby={`plan-${plan.id}`}
            >
              <div className="plan-card-top">
                <p className="public-eyebrow">
                  {isCurrent
                    ? 'Your current plan'
                    : plan.id === 'cottage-mercantile'
                      ? 'Make, stock & sell'
                      : 'A place for your business'}
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
              <div className="plan-limits">
                <p>
                  <strong>{planUserLabel(plan.id)}.</strong>
                </p>
                {plan.users > 1 && <p>{teamAvailabilityNotice}</p>}
                {plan.id === 'cottage-kitchen' && (
                  <p className="plan-exclusion">
                    Excludes resale and consignment.
                  </p>
                )}
                {plan.id === 'bakers-bench' && (
                  <p>
                    Advanced planning is Partial; reporting-period comparisons
                    are Coming soon.
                  </p>
                )}
              </div>
              <footer className="plan-card-footer">
                <p className="plan-status" role="status">
                  {isCurrent
                    ? 'Current plan'
                    : actionBlockedReason
                      ? actionBlockedReason
                      : business?.hasSubscription && !available
                        ? changeAvailability?.reason ||
                          'This change is currently unavailable.'
                        : purchaseStatus(availability, plan.id)}
                </p>
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
                <p className="plan-cta-note">
                  {business?.hasSubscription
                    ? 'Review timing, access and any provider-previewed charge before confirmation.'
                    : plan.id === 'free'
                      ? 'Create your account and verify your email.'
                      : 'Keep your plan choice through signup, then complete secure Stripe checkout after business setup.'}
                </p>
              </footer>
            </article>
          )
        })}
      </div>
      <div className="plan-table-heading">
        <h3 id="plan-details-title">A closer look at each plan</h3>
        <p>
          Included means implemented and within the plan’s scope. Partial tools
          have limitations; Coming soon tools are unfinished. Scroll across on
          smaller screens.
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
            Monthly prices, total users including the owner, and complete
            feature comparison
          </caption>
          <thead>
            <tr>
              <th scope="col">Feature or limit</th>
              {publicPlans.map((p) => (
                <th scope="col" key={p.id}>
                  {p.name}
                  <span>${p.monthlyUsd} USD/month per business</span>
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
              <th scope="row">Total users, including the owner</th>
              {publicPlans.map((p) => (
                <td key={p.id}>{p.users}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">New team member setup</th>
              {publicPlans.map((p) => (
                <td key={p.id}>
                  {p.users > 1
                    ? 'Coming soon · invitations and member administration'
                    : 'Owner only'}
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
                    <span aria-label="Not included">—</span>
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
                    <span aria-label="Not included">—</span>
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
                              <span aria-label="Not included">—</span>
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
        access changes. Shared-user allowances include the owner; invitations
        and member administration remain unfinished. No proposed record limits
        are activated by choosing a plan.
      </p>
    </section>
  )
}
