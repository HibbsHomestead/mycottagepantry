import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react'
import { getSessionStatus } from '@/lib/session.functions'
import { useRegistrationPolicy } from '@/lib/registration-policy-client'
import { ProductTour } from './product-tour'
import { PricingComparison } from './pricing-comparison'
import './public-site.css'

export function PublicSite({ children }: { children: ReactNode }) {
  const policies = useRegistrationPolicy()
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let active = true
    // Old Identity emails may return to the homepage. Keep tokens in the fragment only.
    const parameters = new URLSearchParams(window.location.hash.slice(1))
    if (
      [
        'confirmation_token',
        'recovery_token',
        'invite_token',
        'email_change_token',
        'access_token',
        'error',
      ].some((key) => parameters.has(key)) &&
      window.location.pathname !== '/login'
    ) {
      window.location.replace(
        '/login' + window.location.search + window.location.hash,
      )
      return
    }
    if (
      ['/login', '/signup', '/onboarding', '/verify-email', '/oven'].includes(
        window.location.pathname,
      )
    )
      return
    getSessionStatus()
      .then((s) => {
        if (active) setSignedIn(s.signedIn)
      })
      .catch(() => {
        if (active) setSignedIn(null)
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <div className="public-site">
      <a className="public-skip" href="#main">
        Skip to content
      </a>
      <header className="public-header">
        <a href="/" className="public-brand" aria-label="Cottage Pantry home">
          <img
            src="/brand/cottage-pantry-logo.webp"
            alt=""
            width="58"
            height="58"
          />
          <span>
            Cottage Pantry<small>A little order. A lot of possibility.</small>
          </span>
        </a>
        <button
          className="public-menu"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
        <nav className={open ? 'open' : ''} aria-label="Main navigation">
          <a href="/features">Features</a>
          <a href="/pricing">View Plans</a>
          <a href="/help">Help & contact</a>
          <a className="public-login" href={signedIn ? '/oven' : '/login'}>
            {signedIn ? 'Open oven' : 'Log in'} <ArrowUpRight size={16} />
          </a>
          <a className="public-button small" href="/signup">
            Get Started
          </a>
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer className="public-footer">
        <div>
          <a className="footer-wordmark" href="/">
            Cottage Pantry
          </a>
          <p>
            Made for the business behind the baking.
            <br />
            For cottage food makers & small food businesses.
          </p>
        </div>
        <nav aria-label="Footer">
          <a href="/features">Features</a>
          <a href="/pricing">View Plans</a>
          <a href="/help">Help & contact</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
        <p className="public-fine">
          Monthly plans in USD. Paid subscriptions are not yet available for
          purchase.
        </p>
        {!policies.loading && !policies.error && !policies.policy && (
          <p className="public-fine">
            Account creation is open. Creating a business oven currently
            requires publication of approved <a href="/terms">Terms</a> and{' '}
            <a href="/privacy">Privacy</a> documents. Existing-account login
            remains available separately.
          </p>
        )}
      </footer>
    </div>
  )
}
export function CreateAccountLink() {
  return (
    <a className="public-button" href="/signup">
      Get Started <ArrowRight size={18} />
    </a>
  )
}
export function HomePage() {
  return (
    <PublicSite>
      <section className="public-hero public-width">
        <div className="hero-copy">
          <p className="public-eyebrow">
            For your kitchen. And the business it’s becoming.
          </p>
          <h1>
            Know your costs.
            <br />
            Organize your kitchen.
            <br />
            <em>Build your business.</em>
          </h1>
          <p className="public-lead">
            Your recipes are personal. Your numbers shouldn’t be a guessing
            game. Bring ingredients, costing, production, and business records
            together in one thoughtful oven.
          </p>
          <div className="public-actions">
            <CreateAccountLink />
            <a className="public-text-link" href="/pricing">
              View Plans <ArrowRight size={17} />
            </a>
            <a className="public-text-link" href="/features">
              Take a look inside <ArrowRight size={17} />
            </a>
          </div>
          <p className="public-fine">
            Compare the approved monthly prices and current plan availability.
            Paid checkout is not yet available.
          </p>
        </div>
        <div className="hero-product">
          <div className="hero-product-heading">
            <span>
              The kitchen notebook,
              <br />
              <em>with the numbers connected.</em>
            </span>
          </div>
          <figure className="hero-screen">
            <div className="browser-chrome">
              <i />
              <i />
              <i />
              <span>Cottage Pantry / Recipes</span>
            </div>
            <img
              src="/screenshots/recipes.webp"
              alt="Cottage Pantry recipe oven showing recipe cards, costs and yields using demonstration data"
              width="1440"
              height="960"
            />
            <figcaption>Actual oven · demonstration data</figcaption>
          </figure>
          <div className="hero-note">
            From a bag of flour
            <br />
            to a better-informed price.
          </div>
        </div>
      </section>
      <section className="public-workflow">
        <div className="public-width">
          <p className="public-eyebrow">One connected workflow</p>
          <div className="workflow-chain">
            {[
              'Ingredients',
              'Recipes',
              'Products',
              'Production',
              'Business results',
            ].map((label, i) => (
              <span key={label}>
                <small>0{i + 1}</small>
                {label}
                {i < 4 && <ArrowRight aria-hidden="true" />}
              </span>
            ))}
          </div>
          <p>
            Update a cost. See it flow through your recipes and products. Keep
            completed runs and recorded business history intact.
          </p>
        </div>
      </section>
      <section className="public-width public-story">
        <div>
          <p className="public-eyebrow">Less scattered. More considered.</p>
          <h2>
            Make room for
            <br />
            the work you love.
          </h2>
          <p>
            Keep the details that turn good food into a workable business close
            at hand—from package prices to the next batch.
          </p>
          <a className="public-text-link" href="/features">
            Explore the oven <ArrowRight size={18} />
          </a>
        </div>
        <div className="story-items">
          <article>
            <span>01 / Know what goes in</span>
            <h3>Price with your whole recipe in mind.</h3>
            <p>
              Account for ingredients, packaging, labor, overhead, and waste.
              Use explicit, verified conversions instead of guessed densities.
            </p>
          </article>
          <article>
            <span>02 / Keep your kitchen in order</span>
            <h3>Connect the plan to the pantry.</h3>
            <p>
              Record receiving and adjustments, review stock history, and plan
              production with recipe costs in view.
            </p>
          </article>
          <article>
            <span>03 / See the business behind it</span>
            <h3>Give your records a useful home.</h3>
            <p>
              Record sales and expenses, review business and tax reports, and
              export your data when you need it.
            </p>
          </article>
        </div>
      </section>
      <section className="public-width public-cta">
        <div>
          <p className="public-eyebrow">An oven for the next chapter</p>
          <h2>
            Small business.
            <br />
            <em>Thoughtfully organized.</em>
          </h2>
        </div>
        <div>
          <p>
            View plans to compare monthly pricing and proposed features, then
            get started with an account. Paid subscriptions are not yet
            available. Business oven setup requires approved Terms and Privacy.
          </p>
          <CreateAccountLink />
          <a className="public-text-link" href="/pricing">
            View Plans
          </a>
          <a className="public-text-link" href="/login">
            Log in <ArrowRight size={17} />
          </a>
        </div>
      </section>
    </PublicSite>
  )
}
export function FeaturesPage() {
  return (
    <PublicSite>
      <ProductTour />
    </PublicSite>
  )
}
export function PricingPage() {
  return (
    <PublicSite>
      <section className="public-width public-page-intro narrow pricing-page-intro">
        <p className="public-eyebrow">Plans & pricing</p>
        <h1>Your business, in good order.</h1>
        <p className="public-lead">
          A little order for what you make and sell. Compare the tools and room
          each plan brings to your business.
        </p>
        <div className="public-actions">
          <CreateAccountLink />
          <a className="public-text-link" href="/login">
            Log in
          </a>
        </div>
      </section>
      <PlanComparison />
    </PublicSite>
  )
}
/** Approved monthly USD prices. Paid plans are shown for comparison only until the
 * production billing release is approved; nothing here starts a purchase. */
export function PlanComparison() {
  return <PricingComparison />
}

export function HelpPage() {
  return (
    <PublicSite>
      <section className="public-width public-page-intro">
        <p className="public-eyebrow">Help & contact</p>
        <h1>
          A little help
          <br />
          <em>along the way.</em>
        </h1>
        <p className="public-lead">
          Start with the workflow, keep the source, and review before saving.
        </p>
      </section>
      <section className="public-width help-layout">
        <div>
          {[
            [
              'How do recipe imports work?',
              'Paste recipe text, upload a text file, or import a recipe URL. Review the ingredients, optional additions and method before approval. Match existing Pantry items explicitly; importing does not move stock or post financial entries. Automatic PDF and image reading is unavailable; use text or manual review.',
            ],
            [
              'How should I enter package costs?',
              'Record the package quantity, unit, price and preferred vendor. Verify conversions explicitly. A weight-to-volume conversion needs product-specific evidence.',
            ],
            [
              'Can I export my records?',
              'Yes. The oven includes CSV reports and a JSON oven snapshot. Data export is available in the oven. A snapshot is not a full backup and restore service.',
            ],
            [
              'Does Cottage Pantry file taxes?',
              'No. Tax reports and exports help organize recorded sales and tax. The app does not file or submit returns.',
            ],
            [
              'How do I create an account?',
              'Use View Plans to compare monthly pricing and current availability, then Get Started to create an account and verify your email. Registration currently offers the Free setup path only and collects no payment. Business oven setup remains blocked until approved Terms and Privacy are published. Existing account holders can log in separately.',
            ],
            [
              'Can I subscribe to a paid plan now?',
              'Paid checkout is not yet available. Approved prices are monthly in USD; displayed feature and user limits remain proposed scope. Choosing or viewing a paid plan does not activate a subscription. View Plans for current availability.',
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
        <aside className="contact-paper">
          <p className="public-eyebrow">Help & contact</p>
          <h2>
            Let’s get the
            <br />
            foundations right.
          </h2>
          <p>
            Existing account holders can request private help inside Cottage
            Pantry. Support is available inside the oven. Do not include
            passwords, API keys or payment-card details.
          </p>
          <p>
            Cannot sign in? This help route stays public. A separate,
            rate-limited public contact form is proposed; public message
            collection is not active yet. Email notifications are not active
            until sender and recipient setup is approved.
          </p>
          <p>
            A public support contact is not yet configured. The planned support
            site and mailbox are not operational. Existing verified account
            holders can use private in-app support.
          </p>
          <a className="public-button" href="/support">
            Existing account support
          </a>
          <a className="public-text-link" href="/login">
            Existing account? Log in <ArrowRight size={17} />
          </a>
        </aside>
      </section>
    </PublicSite>
  )
}
export function LegalPage({ kind }: { kind: 'Privacy' | 'Terms' }) {
  const { policy, loading, error, retry } = useRegistrationPolicy()
  if (loading || error)
    return (
      <PublicSite>
        <section className="public-width public-page-intro narrow">
          <h1>{kind}</h1>
          {loading ? (
            <p role="status">Loading published policy…</p>
          ) : (
            <>
              <p role="alert">{error}</p>
              <button type="button" className="public-button" onClick={retry}>
                Retry policy check
              </button>
            </>
          )}
        </section>
      </PublicSite>
    )
  if (policy)
    return (
      <PublicSite>
        <section className="public-width public-page-intro narrow">
          <h1>{kind}</h1>
          <p>Revision {policy.revision}</p>
          <p style={{ whiteSpace: 'pre-wrap' }}>
            {kind === 'Terms' ? policy.terms : policy.privacy}
          </p>
        </section>
      </PublicSite>
    )
  return (
    <PublicSite>
      <section className="public-width public-page-intro narrow">
        <p className="public-eyebrow">Policy publication required</p>
        <h1>{kind}</h1>
        <p className="public-lead">
          The {kind.toLowerCase()} content has not been approved for
          publication.
        </p>
        <p>
          This page is a launch-review notice, not a legal policy or agreement.
          The owner still needs to supply and approve the appropriate content.
          This document requirement does not prevent existing-account login.
        </p>
        <p>
          {kind === 'Privacy'
            ? 'The review needs to cover collected data, purposes, processors, retention, exports, deletion, support access, and contact details.'
            : 'The review needs to cover service scope, eligibility, acceptable use, free-service scope and account closure, data ownership, and business responsibilities.'}
        </p>
        <a className="public-text-link" href="/help">
          Help & contact <ArrowRight size={18} />
        </a>
      </section>
    </PublicSite>
  )
}
