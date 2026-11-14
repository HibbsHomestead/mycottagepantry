/** Reviewed against the implemented workflows; shared by Help and server retrieval. */
export const supportKnowledge = [
  {
    id: 'login',
    title: 'Login and account access',
    href: '/login',
    terms: 'login log in sign in account password email verify reset recovery',
    text: 'Use Log in with your existing email. Verify the email before opening an oven. Password recovery sends an email link; open the latest link on this site. If you have several ovens, select the intended oven. Never send passwords, recovery links or codes to support. AI cannot inspect account status or reset access. Use Help & contact if you cannot sign in.',
  },
  {
    id: 'inventory',
    title: 'Inventory and units',
    href: '/oven#Inventory',
    terms:
      'inventory stock item ingredient packaging material supply supplies quantity cost conversion unit receive receiving',
    text: 'Inventory offers Cards and Table with filters and sorting. Add Item creates a draft. Review package contents, purchase unit and cost. Applying imported details only fills the draft. Saving a draft without starting stock does not receive stock. Receive Stock posts an explicit quantity; review before confirmation. Cross-category conversions need verified product evidence; never assume one each equals one can or infer density. A Conversion required notice keeps editing available.',
  },
  {
    id: 'imports',
    title: 'Barcode and product imports',
    href: '/oven#Inventory',
    terms:
      'barcode scan scanner import url product page photo allergen ingredients',
    text: 'In Add Item, scan or enter the complete barcode with leading zeros. Lookup checks your records, catalog and food sources, with web search fallback. An exact barcode does not verify community package wording. Choose uncertain candidates, use the product page, then Import details and review the selected fields and photo. Missing ingredients or allergen statements remain unknown. Some retailers block requests; continue with pasted text or manual details. Importing or applying details does not save the item or add stock.',
  },
  {
    id: 'production',
    title: 'Produce and assemble',
    href: '/oven#Production',
    terms:
      'production produce assembly assemble kit batch recipe yield shortage output waste',
    text: 'Start production, choose a product and enter output quantity. Review requirements, verified yield mapping and shortages. Food production uses its linked recipe. Kits consume existing finished components and outer packaging, not those components’ raw ingredients again. Producing missing components is separate. Drafts and scheduling move no stock. Completion posts actual consumption, usable output, costs and waste atomically; completed runs are not edited. Missing recipe, yield or conversion must be corrected explicitly.',
  },
  {
    id: 'labels',
    title: 'Label review and printing',
    href: '/oven#Labels',
    terms: 'label labels print printing printer font nutrition',
    text: 'Open Labels, choose the product/design and review source ingredients and allergens. Use print preview and check paper size, printer scaling and margins. Printing uses the browser. Saved designs and fonts do not certify legal compliance; built-in nutrition analysis is not provided. Verify the printed package against local requirements.',
  },
  {
    id: 'billing',
    title: 'Plans and billing',
    href: '/oven#Settings/Billing',
    terms:
      'bill billing stripe square payment subscription plan tier checkout charge cancel mercantile',
    text: 'The owner reviews billing under Settings. Provider checkout and billing portal availability depend on separate server controls. Stripe test mode is not a live subscription or charge. Internal administrator assignments are separate from paid checkout. Cottage Mercantile allows six total users including the owner and includes implemented resale and consignment features. A suspension still blocks access despite a manual assignment. AI cannot inspect charges, change a plan, cancel subscriptions or remove a suspension. Contact support for account-specific review; never attach payment details.',
  },
  {
    id: 'mobile',
    title: 'Mobile dialogs and errors',
    href: '/help',
    terms:
      'mobile phone tablet popup dialog keyboard scroll screen error crash bug blank help support',
    text: 'Keep the current draft open while checking the issue. Close the keyboard to inspect the dialog controls and use its main scroll area. Back to top returns the active popup to its top. Do not repeatedly save after an uncertain network response; check the saved record before retrying. Attach error details only after reviewing the sanitized preview. Include the page, app version and time; omit item contents, credentials and payment information. AI cannot determine the cause from symptoms alone or claim a fix was deployed.',
  },
] as const
export function supportArticles(message: string) {
  const words = message.toLowerCase().match(/[a-z]+/g) || []
  return supportKnowledge
    .map((article) => ({
      article,
      score: words.filter(
        (w) => w.length > 2 && article.terms.split(' ').includes(w),
      ).length,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((row) => row.article)
}
