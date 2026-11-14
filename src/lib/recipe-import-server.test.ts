// @vitest-environment node
import { it, expect, vi, afterEach, beforeEach } from 'vitest'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import {
  publicAddress,
  validateRecipeUrl,
  recipesFromHtml,
  recipeUpload,
  extractRecipeDocument,
  cookbookAdapters,
} from '../../netlify/lib/recipe-import'
const provider = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: provider.generate }
  },
}))
afterEach(() => vi.restoreAllMocks())
it('blocks private, loopback, reserved and mapped addresses and unsafe protocols', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.2.3.4',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
  ])
    expect(publicAddress(ip)).toBe(false)
  expect(publicAddress('8.8.8.8')).toBe(true)
  for (const url of [
    'http://example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://user:pass@example.com',
    'https://example.com:8080',
  ])
    await expect(validateRecipeUrl(url)).rejects.toThrow()
})
it('extracts real Schema.org Recipe data and ordered steps without executing markup', () => {
  const source = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Recipe',
        name: 'Test bread',
        recipeCategory: ['Family breads', 'Breakfast'],
        recipeIngredient: ['2 cups bread flour', '1 tsp salt'],
        recipeYield: '2 loaves',
        prepTime: 'PT20M',
        cookTime: 'PT1H',
        recipeInstructions: [
          {
            '@type': 'HowToSection',
            itemListElement: [{ text: 'Mix.' }, { text: 'Bake.' }],
          },
        ],
        author: { name: 'Test author' },
      },
    ],
  }
  const parsed = recipesFromHtml(
    '<main><h1>Test bread</h1><p>Visible content</p></main><script type="application/ld+json">' +
      JSON.stringify(source) +
      '</script><script>throw new Error("never execute")</script>',
  )
  expect(parsed.recipes[0]).toMatchObject({
    title: 'Test bread',
    importedCategory: 'Family breads; Breakfast',
    recipeCategoryId: '',
    yieldQuantity: 2,
    yieldUnit: 'loaves',
    prepMinutes: 20,
    cookMinutes: 60,
    instructions: ['Mix.', 'Bake.'],
    author: 'Test author',
  })
  expect(parsed.recipes[0].lines[0].quantity).toBe(2)
  expect(parsed.text).not.toContain('never execute')
  expect(() => recipesFromHtml('<input type="password">')).toThrow(/sign-in/)
  expect(() =>
    recipesFromHtml(
      '<script type="application/ld+json">{"@type":"Recipe","isAccessibleForFree":false}</script>',
    ),
  ).toThrow(/access restrictions/)
})
it('validates actual uploaded PDF/photo/text bytes, rejects unsupported exports, and calls a schema-validated provider', async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage()
  const bytes = await pdf.save()
  const file = await recipeUpload(
    new File([new Uint8Array(bytes)], 'recipe.pdf', {
      type: 'application/pdf',
    }),
  )
  expect(file.mime).toBe('application/pdf')
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer()
  const jpg = await sharp(image).jpeg().toBuffer()
  expect(
    (
      await recipeUpload(
        new File([new Uint8Array(jpg)], 'recipe.jpg', { type: 'image/jpeg' }),
      )
    ).mime,
  ).toBe('image/jpeg')
  expect(
    (await recipeUpload(new File([image], 'recipe.png', { type: 'image/png' })))
      .mime,
  ).toBe('image/png')
  expect(
    (
      await recipeUpload(
        new File(['Recipe\nIngredients:\n1 lb flour'], 'recipe.txt', {
          type: 'text/plain',
        }),
      )
    ).text,
  ).toContain('1 lb flour')
  await expect(
    recipeUpload(new File(['{}'], 'recipe.paprikarecipes')),
  ).rejects.toThrow(/Cookbook exports/)
  await expect(
    recipeUpload(
      new File(['<html>login</html>'], 'recipe.png', { type: 'image/png' }),
    ),
  ).rejects.toThrow(/Supported recipe files/)
  provider.generate.mockResolvedValue({
    text: JSON.stringify({
      recipes: [
        {
          title: 'Document bread',
          lines: [
            { original: '1 lb flour', name: 'flour', quantity: 1, unit: 'lb' },
          ],
        },
      ],
    }),
  })
  expect((await extractRecipeDocument(file.bytes, file.mime))[0].title).toBe(
    'Document bread',
  )
  expect(
    provider.generate.mock.calls.at(-1)![0].contents[0].parts[0].inlineData
      .data,
  ).toBe(file.bytes.toString('base64'))
  provider.generate.mockResolvedValue({ text: '{"recipes":[]}' })
  await expect(extractRecipeDocument(file.bytes, file.mime)).rejects.toThrow(
    /No readable recipe/,
  )
  provider.generate.mockResolvedValue({
    text: '{"recipes":[{"yieldQuantity":"invented"}]}',
  })
  await expect(extractRecipeDocument(file.bytes, file.mime)).rejects.toThrow()
  expect(cookbookAdapters).toEqual([])
})
it('classifies malformed structured ingredient content before quantities and preserves HowToSection headings', () => {
  const parsed = recipesFromHtml(
    '<script type="application/ld+json">' +
      JSON.stringify({
        '@type': 'Recipe',
        name: 'Crumble',
        recipeIngredient: [
          '100 g butter, melted',
          'Additions:',
          '20 g nuts, optional',
          'Crumble topping:',
          '1. Melt butter, set aside.',
          '2. Stir in 2 cups flour.',
        ],
        recipeInstructions: [
          {
            '@type': 'HowToSection',
            name: 'Bake the crumble',
            itemListElement: [{ text: 'Bake for 20 minutes.' }],
          },
        ],
        recipeYield: '4 to 6 servings',
      }) +
      '</script>',
  )
  const draft = parsed.recipes[0]
  expect(draft.lines).toHaveLength(1)
  expect(draft.lines[0].quantity).toBe(100)
  expect(draft.optionalAdditions).toHaveLength(1)
  expect(draft.instructions).toEqual([
    'Melt butter, set aside.',
    'Stir in 2 cups flour.',
    'Bake for 20 minutes.',
  ])
  expect(draft.instructionGroups).toEqual([
    'Crumble topping:',
    'Crumble topping:',
    'Bake the crumble',
  ])
  expect(draft.yieldQuantity).toBeNull()
  expect(draft.unclassified).toContain('Yield: 4 to 6 servings')
})
it('removes OCR method prose from ingredient matching and retains grouped method and optional content', async () => {
  provider.generate.mockResolvedValue({
    text: JSON.stringify({
      recipes: [
        {
          title: 'Document crumble',
          lines: [
            {
              original: '100 g butter, melted',
              name: 'butter',
              quantity: 100,
              unit: 'g',
            },
            {
              original: '1. Melt butter, set aside.',
              group: 'Topping:',
              quantity: 1,
              name: 'Melt butter',
            },
            {
              original: '20 g nuts, optional',
              name: 'nuts',
              quantity: 20,
              unit: 'g',
            },
          ],
          instructions: ['Bake until golden.'],
          instructionGroups: ['Baking:'],
        },
      ],
    }),
  })
  const [draft] = await extractRecipeDocument(
    Buffer.from('mock document'),
    'application/pdf',
  )
  expect(draft.lines).toHaveLength(1)
  expect(draft.instructions).toEqual([
    'Melt butter, set aside.',
    'Bake until golden.',
  ])
  expect(draft.instructionGroups).toEqual(['Topping:', 'Baking:'])
  expect(draft.optionalAdditions).toHaveLength(1)
})

beforeEach(() =>
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) => (name === 'AI_ENABLED' ? 'true' : undefined),
    },
  }),
)
