import { parseRecipeText, type RecipeDraft } from './recipe-import'
// Adapter for the actual CookBook shared-text sample; native formats are intentionally not guessed.
export function parseCookBook(text: string): {
  draft: RecipeDraft
  sourceUrl: string
} {
  if (
    !/Shared from CookBook\s*\nhttps:\/\/cookbookmanager\.com\/?\s*$/i.test(
      text.trim(),
    )
  )
    throw new Error(
      'Unsupported CookBook format. Export shared plain text with the “Shared from CookBook” footer, or upload an individual PDF using Upload recipe.',
    )
  const draft = parseRecipeText(text)
  draft.sourceApp = 'CookBook Manager'
  return { draft, sourceUrl: draft.sourceUrl }
}
