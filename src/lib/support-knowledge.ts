/** Reviewed against the implemented workflows; shared by Help and server retrieval. */
export const supportKnowledge = [
  {
    id: 'login',
    title: 'Login and account access',
    href: '/login',
    terms: 'login log in sign in account password email verify reset recovery',
    text: 'Use Log in with your existing email. Verify the email before opening an oven. Password recovery sends an email link; open the latest link on this site. If you have several ovens, select the intended oven. Never send passwords, recovery links or codes to support. With your consent, the AI can check your verified sign-in and current active business membership. Password resets use the existing recovery flow; AI cannot change permissions. Use Help & contact if you cannot sign in.',
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
    id: 'item-types',
    title: 'Item Type: ingredients and craft materials',
    href: '/oven#Inventory',
    terms:
      'change changing convert conversion ingredient ingredients craft material materials type item existing wrong switch reclassify recreate delete history linked recipe',
    text: 'An existing saved item cannot change Item Type, even if no stock is recorded. The server rejects changes with “Item Type is fixed for an existing item. Create a separate item instead of converting stock or history.” Category editing does not convert Item Type. Supported alternative: Inventory → Add Item → Item Type → Craft Material; review material details, package units and costs, then save. Keep the original ingredient: its ID, linked food recipes, stock ledger, costs and completed production history stay attached to the original record. The new material gets a separate ID and does not inherit stock, recipe links or history. Do not delete/recreate the original, duplicate its on-hand balance as opening stock, or imply automatic stock transfer. There is no supported in-place conversion or automated ingredient-to-material stock migration. Craft materials are used in handmade designs and are rejected in food recipes. If stock was recorded against the wrong type, review the original ledger and use the existing explicit stock adjustment/count workflows only after reviewing the physical quantities and reason; escalate if unsure. Before a NEW unsaved Add Item draft is saved, Item Type can be switched in that dialog; shared draft details are preserved. This does not convert any saved item.',
  },
  {
    id: 'recipes',
    title: 'Recipes, categories and base recipes',
    href: '/oven#Recipes',
    terms:
      'recipe recipes category categories custom rename archive icon base compound yield costing photo',
    text: 'Add or edit a recipe in Recipes. Select its category; category graphics are used only when there is no uploaded photo. Manage categories lets the business add, rename, archive or restore custom categories and choose an icon. Archived categories stay on existing recipes and are excluded from new assignments. Imported categories are retained for review. Base recipes must be explicitly linked; matching names do not establish a base. Review yield and verified unit mapping before production. Compound recipes cannot contain cycles. Editing a recipe does not rewrite completed production usage or costs.',
  },
  {
    id: 'counts',
    title: 'Stock counts and corrections',
    href: '/oven#Inventory',
    terms:
      'count counts counted opening adjustment adjust correct correction balance ledger stock wrong duplicate',
    text: 'Use Inventory stock count controls for physical counts, or the item’s stock adjustment workflow with a reason. Review item, unit and quantity before posting. A saved opening balance is idempotent and cannot be silently entered again with changed details. Receipts, counts and adjustments create ledger records; editing reference/package prices does not receive stock. Do not repeat a post after a timeout until checking the saved ledger. No automatic transfer between ingredient and craft material records exists.',
  },
  {
    id: 'receipts',
    title: 'Receipts and purchase review',
    href: '/oven#Purchasing/Purchases%20%26%20Receipts',
    terms:
      'receipt receipts purchase purchasing expense expenses pdf extraction vendor invoice duplicate finance',
    text: 'Review receipt extraction and match each line to the intended existing item or an explicitly chosen new Item Type. Check quantities, units, totals and tax before posting. Extraction is a draft, not proof of a correct match or stock receipt. Blocked retailer/PDF extraction can be reviewed manually. Posting purchase/stock operations follows the explicit review controls; avoid duplicate posting after uncertain network responses. Tax collected is separate from revenue. The helper sees only sanitized attempt statuses, never receipt files or purchase lines.',
  },
  {
    id: 'products',
    title: 'Products, handmade designs and kits',
    href: '/oven#Products',
    terms:
      'product products pricing price kit kits handmade design designs resale consignment link unlink recipe component',
    text: 'Products can be linked to a recipe or kept unlinked for review. Use recipe connection controls to review an existing link before changing it. Handmade designs use craft materials; food recipes reject craft materials. Kits assemble existing finished components with their outer packaging; their raw ingredients are not consumed again. Correct missing recipe/yield/unit mappings before production. Historical completed runs retain their recorded costs. Resale and consignment require the corresponding enabled plan features.',
  },
  {
    id: 'label-recovery',
    title: 'Recovering label edits',
    href: '/oven#Labels',
    terms:
      'label recovery recover draft save conflict changed elsewhere checkpoint lost edits export copy',
    text: 'If a label changed elsewhere, keep the current edits open. Export a recovery file or save a copy; reopen the newer saved label before updating it. Recovery drafts belong to the signed-in person and business. A recovery checkpoint is evidence of unsaved work, not a successful final save. The AI can check the count of your unresolved recovery checkpoints with consent, but cannot read artwork or overwrite the saved label.',
  },
  {
    id: 'support',
    title: 'Support, privacy and escalation',
    href: '/support',
    terms:
      'support ticket escalate escalation person human diagnostics diagnostic account inspect status troubleshooting permissions',
    text: 'AI support uses current application guides and explicitly permitted, business-scoped status tools. Opt in to status checks to share only the displayed sanitized account/business metadata with the provider; no private inventory, payment details, credentials or files. It cannot edit stock, item types, plans, permissions or subscriptions. For a person, select Contact support, review the prefilled issue summary and diagnostic preview, then Create support request. The existing conversation is attached; no retyping is needed. Continue replies and check status in Your tickets. Only authorized platform staff can see private internal notes; customers never receive them. Unsupported actions remain unavailable, and a recorded status check does not prove a repair.',
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
    href: '/oven/billing',
    terms:
      'bill billing stripe square payment subscription plan tier checkout charge cancel mercantile',
    text: 'The owner reviews billing under Settings. Provider checkout and billing portal availability depend on separate server controls. Stripe test mode is not a live subscription or charge. Internal administrator assignments are separate from paid checkout. Cottage Mercantile allows six total users including the owner and includes implemented resale and consignment features. A suspension still blocks access despite a manual assignment. With your consent, the AI can inspect recorded plan and integration status when your business role permits it. Recorded status is not live payment verification. AI cannot charge, change a plan, cancel subscriptions or remove a suspension. Contact support for account-specific review; never attach payment details.',
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
export function supportArticles(message: string, previous = '') {
  const tokens = (value: string) =>
    [...new Set(value.toLowerCase().match(/[a-z]+/g) || [])].filter(
      (w) =>
        w.length > 2 &&
        ![
          'the',
          'how',
          'can',
          'and',
          'for',
          'this',
          'that',
          'with',
          'does',
          'what',
        ].includes(w),
    )
  const current = tokens(message),
    history = tokens(previous)
  return supportKnowledge
    .map((article) => {
      const terms = new Set(article.terms.split(' '))
      return {
        article,
        score:
          current.filter((w) => terms.has(w)).length * 4 +
          history.filter((w) => terms.has(w)).length,
      }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((row) => row.article)
}
