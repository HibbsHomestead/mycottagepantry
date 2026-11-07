import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Expand, X } from 'lucide-react'
import { launchFeatures, type FeatureId } from '@/lib/launch-plans'

/** Marketing availability is derived from the same proposal as Pricing. No runtime gate. */
export function tourPlanScope(featureId: FeatureId) {
  const feature = launchFeatures.find((f) => f.id === featureId)!
  return feature.status === 'implemented'
    ? 'Available in the oven'
    : 'Not yet available'
}

const sections = [
  {
    id: 'costing',
    nav: 'Costing',
    title: 'Know what goes into every price.',
    description:
      'Start with what you pay, then see how each ingredient and input contributes to the finished product.',
    capabilities: [
      'Purchase package prices and compatible-unit conversions, with explicit verification across unit categories.',
      'Ingredient, packaging, labor, overhead and waste cost inputs.',
      'Batch and per-yield-unit costs, with missing-conversion warnings.',
      'Product pricing scenarios alongside recorded selling prices.',
    ],
    example: 'Buy by the bag. Measure by the gram. See the cost per loaf.',
    note: 'Weight-to-volume conversions need ingredient-specific evidence. Cottage Pantry does not guess density or guarantee a profit.',
    image: 'costing',
    alt: 'Actual white bread recipe detail with ingredient costs, labor, overhead and per-loaf costing',
    availability: [{ label: 'Costing & pricing', feature: 'recipeCosting' }],
  },
  {
    id: 'inventory',
    nav: 'Inventory',
    title: 'A pantry you can actually keep track of.',
    description:
      'Give ingredients and packaging a home, with the purchase information and stock records you need to keep working.',
    capabilities: [
      'Ingredient and packaging records with preferred vendors and manual source links.',
      'Stock receipts, reasoned adjustments, balances and movement history.',
      'Storage locations, low-stock status and reorder thresholds.',
      'Cost records kept separately from the act of receiving stock.',
    ],
    example:
      'Update the price of your flour without adding a bag to the shelf. Receive the bag when it arrives.',
    note: 'Lot selection and expiration-based stock allocation are not available.',
    image: 'pantry',
    alt: 'Current Inventory ingredient list with demonstration balances, unit costs and reorder status',
    availability: [{ label: 'Pantry & stock', feature: 'inventory' }],
  },
  {
    id: 'recipes',
    nav: 'Recipes',
    title: 'Keep your recipes—and their numbers—together.',
    description:
      'Keep the method beside the quantities, review imports before saving, and connect a recipe to the product you sell.',
    capabilities: [
      'Ingredient quantities, editable methods and recorded yield.',
      'Text and recipe-link imports with separate ingredient and Method review, optional additions and original source.',
      'Explicit Pantry matching and conversion warnings before approval.',
      'Links to new or existing products, with recipe output mapped to selling units.',
    ],
    example:
      'A recipe makes four loaves. Link it to your existing single-loaf product and review the output-to-selling-unit relationship.',
    note: 'Source formats vary. Review every import; some pages need pasted text or manual entry. Automatic PDF and image reading are unavailable.',
    image: 'recipes',
    alt: 'Current Recipes & Designs list showing demonstration white bread and other recipes with batch and per-unit costs',
    availability: [
      { label: 'Recipes & links', feature: 'productPricing' },
      { label: 'Reviewed import', feature: 'recipeImport' },
    ],
  },
  {
    id: 'production',
    nav: 'Production',
    title: 'Turn your recipes into a workable bake plan.',
    description:
      'Plan individual runs, scale the recipe, then record what actually happened when the batch is complete.',
    capabilities: [
      'Individual batch plans with a recipe, date, batch count and expected output.',
      'Scaled ingredient requirements for a selected batch.',
      'Completion review of actual ingredient usage and output.',
      'Recorded stock movements and locked cost snapshots for completed runs.',
    ],
    example:
      'Plan two batches of the four-loaf recipe. Planning leaves stock unchanged; completing the run records actual usage and output.',
    note: 'Review every required item and conversion before completion. Batch workflows mixing tracked and untracked stock are still under review. Advanced multi-batch planning is not available.',
    image: 'production',
    alt: 'Current Production Runs showing demonstration batch history, planned batches and ingredient stock checks',
    availability: [{ label: 'Individual batches', feature: 'production' }],
  },
  {
    id: 'labels',
    nav: 'Labels',
    title: 'Your finishing touches, thoughtfully organized.',
    description:
      'Bring your product information and visual identity into saved label designs you can return to.',
    capabilities: [
      'Preset layouts, a label canvas and bundled or uploaded fonts.',
      'Uploaded logos and graphics, with reusable saved designs.',
      'Recipe ingredient/subingredient information and allergen review indicators.',
      'Browser printing and PDF export options.',
    ],
    example:
      'Use the same white bread product to build a label, add your logo and save the design for the next bake.',
    note: 'Review ingredient order, allergens and applicable labeling requirements yourself. A printed label is not a compliance certification.',
    image: 'labels',
    alt: 'Actual label design oven and a demonstration label for Homestyle White Bread Loaf',
    availability: [
      { label: 'Standard layouts', feature: 'standardLabels' },
      { label: 'Full designer', feature: 'labels' },
    ],
  },
  {
    id: 'finances',
    nav: 'Finances',
    title: 'See the business behind the baking.',
    description:
      'Record sales and expenses, review estimated results, and prepare the records you need for the next conversation.',
    capabilities: [
      'Manual sales and expense entry with recorded costs.',
      'Basic estimated profitability summaries.',
      'Tax Center date filters and existing business reports.',
      'Tax-report CSV exports and data export.',
    ],
    example:
      'Record the loaves sold and the market fee. Review those records and export the relevant tax-period information.',
    note: 'Reports reflect the records entered and their calculation basis; not every report has date filtering. Tax exports do not file returns. Live Square sync and bank synchronization are unavailable.',
    image: 'finances',
    alt: 'Actual Finance Tax Center with demonstration records, date-range selection and CSV report export',
    availability: [
      { label: 'Financial records & reports', feature: 'finance' },
    ],
  },
] as const

function ExpandableScreenshot({
  image,
  alt,
  title,
}: {
  image: string
  alt: string
  title: string
}) {
  return (
    <Dialog.Root>
      <figure className="tour-screen">
        <Dialog.Trigger
          className="tour-expand"
          aria-label={`Expand ${title} screenshot`}
        >
          <FeatureScreenshot image={image} alt={alt} lazy />
          <span>
            <Expand size={15} aria-hidden="true" /> Take a closer look
          </span>
        </Dialog.Trigger>
        <figcaption>Actual app screen · demonstration data</figcaption>
      </figure>
      <Dialog.Portal>
        <Dialog.Overlay className="tour-lightbox-overlay" />
        <Dialog.Content
          className="tour-lightbox"
          aria-describedby={`screen-${image}-description`}
        >
          <div className="tour-lightbox-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description id={`screen-${image}-description`}>
                Actual Cottage Pantry screen using demonstration data. Scroll to
                inspect the full image.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close screenshot">
              <X size={24} />
            </Dialog.Close>
          </div>
          <div
            className="tour-lightbox-image"
            tabIndex={0}
            role="region"
            aria-label={`${title} full-size screenshot`}
          >
            <FeatureScreenshot image={image} alt={alt} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Each source is a capture of the implemented app at that screen size. */
function FeatureScreenshot({
  image,
  alt,
  lazy = false,
}: {
  image: string
  alt: string
  lazy?: boolean
}) {
  return (
    <picture>
      <source
        media="(max-width: 780px)"
        srcSet={`/screenshots/features-${image}-mobile.webp`}
        width="390"
        height="693"
      />
      <img
        src={`/screenshots/features-${image}.webp`}
        width="1000"
        height="750"
        alt={alt}
        loading={lazy ? 'lazy' : 'eager'}
      />
    </picture>
  )
}

const questions = [
  [
    'Is Cottage Pantry a storefront?',
    'No. It is a back-office oven for recipes, costs, stock, production and business records. It does not provide a customer storefront or online checkout.',
  ],
  [
    'Can I import existing recipes?',
    'You can import pasted text, text files and supported recipe links, then edit ingredients, optional additions, notes and Method before approval. Review source quantities and Pantry matches. Some source formats need manual entry; automatic PDF and image reading are unavailable.',
  ],
  [
    'Can I link a recipe to a product I already have?',
    'Yes. The recipe workflow supports connecting an existing product as well as creating a new one. Review how the recipe output relates to the selling unit so the cost is meaningful.',
  ],
  [
    'What happens when a conversion is missing?',
    'The app shows a warning instead of guessing. Add an explicit, verified conversion or use compatible units before relying on the cost or completing a batch. Weight and volume are not interchangeable without ingredient-specific evidence.',
  ],
  [
    'Does planning a batch change stock?',
    'No. Planning records the intended run. Completing it records actual usage, output and stock movements. Review required quantities and conversions before completion; safe mixed tracked/untracked coverage needs further refinement.',
  ],
  [
    'Does Cottage Pantry file taxes?',
    'No. Existing tax reports and CSV exports help organize entered records. You or your tax professional must review them and file outside Cottage Pantry.',
  ],
  ['Can I export my data?', 'Yes. CSV exports are available in the oven.'],
  [
    'Can more than one person use my oven?',
    'Invitations and membership administration are not available yet. Existing oven memberships remain in place.',
  ],
] as const

export function ProductTour() {
  return (
    <>
      <section className="public-width public-page-intro tour-intro">
        <p className="public-eyebrow">A look inside Cottage Pantry</p>
        <h1>
          Your recipes. Your pantry. Your business.
          <br />
          <em>Finally, working together.</em>
        </h1>
        <p className="public-lead">
          From the price of a bag of flour to the cost of a finished batch,
          Cottage Pantry helps you bring the details into focus—without piecing
          together another spreadsheet.
        </p>
        <div className="public-actions">
          <a href="#costing" className="public-button">
            Take a look inside <ArrowRight size={17} />
          </a>
          <a href="/pricing" className="public-text-link">
            View Plans <ArrowRight size={17} />
          </a>
        </div>
        <p className="public-fine">
          All sample business information below is demonstration data.
        </p>
      </section>
      <nav
        className="tour-navigation public-width"
        aria-label="Product tour sections"
      >
        {sections.map((s, index) => (
          <a href={`#${s.id}`} key={s.id}>
            <small aria-hidden="true">0{index + 1}</small>
            {s.nav}
          </a>
        ))}
      </nav>
      <div className="public-width tour-sections">
        {sections.map((s, index) => (
          <section
            id={s.id}
            className={`tour-section ${index % 2 ? 'tour-reverse' : ''}`}
            key={s.id}
            aria-labelledby={`${s.id}-heading`}
          >
            <div className="tour-copy">
              <p className="public-eyebrow">
                0{index + 1} / {s.nav}
              </p>
              <h2 id={`${s.id}-heading`}>{s.title}</h2>
              <p>{s.description}</p>
              <ul>
                {s.capabilities.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              <p className="tour-example">{s.example}</p>
              <p className="tour-note">{s.note}</p>
              <div
                className="tour-availability"
                aria-label={`${s.nav} feature availability`}
              >
                {s.availability.map((a) => (
                  <p key={a.feature}>
                    <strong>{a.label}</strong>
                    <span>{tourPlanScope(a.feature)}</span>
                  </p>
                ))}
                <a href="/signup">
                  Get Started <ArrowRight size={13} />
                </a>
              </div>
            </div>
            <ExpandableScreenshot image={s.image} alt={s.alt} title={s.nav} />
          </section>
        ))}
      </div>
      <section className="tour-connected">
        <div className="public-width">
          <p className="public-eyebrow">One recipe. Connected records.</p>
          <h2>Follow one loaf from pantry to product.</h2>
          <p>
            Homestyle White Bread is our demonstration example. Each step stays
            an explicit action you can review.
          </p>
          <ol>
            {[
              [
                'Purchase information',
                'Record flour’s package price and unit. Receive stock separately when the bag arrives.',
              ],
              [
                'Recipe',
                'Record the ingredients and Method. This demonstration recipe yields four loaves.',
              ],
              [
                'Cost',
                'Review ingredient, labor and overhead inputs to see batch and per-loaf costs.',
              ],
              [
                'Product link',
                'Connect the recipe to Homestyle White Bread Loaf and review its selling-unit relationship.',
              ],
              [
                'Batch',
                'Plan a run. Review actual usage and output before completing it and recording stock movements.',
              ],
              [
                'Records',
                'Enter the sale and any expenses explicitly. Review the resulting records and exports.',
              ],
            ].map(([title, text], index) => (
              <li key={title}>
                <span aria-hidden="true">0{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="public-fine">
            Demonstration data only. Planning, completion and recording a sale
            are separate actions; a recipe link does not create a sale.
          </p>
        </div>
      </section>
      <section className="public-width tour-faq">
        <p className="public-eyebrow">Before you begin</p>
        <h2>A few practical questions.</h2>
        <div>
          {questions.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="public-width public-cta tour-final">
        <h2>
          A little more order.
          <br />
          <em>A clearer view of your business.</em>
        </h2>
        <div>
          <a className="public-button" href="/signup">
            Get Started <ArrowRight size={17} />
          </a>
          <a className="public-text-link" href="/login">
            Log in <ArrowRight size={17} />
          </a>
        </div>
      </section>
    </>
  )
}
