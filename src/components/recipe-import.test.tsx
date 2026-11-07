import { it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecipeImport } from './recipe-import'
import { demoData } from '@/lib/demo'
import {
  parseRecipeText,
  parseIngredient,
  recipeDraftSchema,
  reprocessRecipeDraft,
} from '@/lib/recipe-import'
import { bestCrumbleSource } from '../test/fixtures/best-crumble'
afterEach(() => vi.unstubAllGlobals())
it('identifies an invalid optional source URL inline before submitting, without losing the draft', async () => {
  const record = {
    id: 'invalid',
    draft: recipeDraftSchema.parse({ title: 'Invalid source bread' }),
    status: 'needs_review',
    updatedAt: 'v1',
    sourceText: '',
    mime: 'text/plain',
    method: 'Pasted text',
  }
  const post = vi.fn()
  vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) =>
    options?.method ? post() : Response.json({ imports: [record] }),
  )
  render(
    <RecipeImport
      workspace={demoData()}
      canEdit
      close={vi.fn()}
      onWorkspace={vi.fn()}
      openRecipe={vi.fn()}
      onConversion={vi.fn()}
    />,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: /Invalid source bread.*Review/ }),
  )
  await userEvent.type(screen.getByLabelText('Source URL'), 'not-a-url')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save import draft' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No request was sent',
  )
  expect(screen.getByLabelText('Source URL')).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  expect(screen.getByLabelText('Source URL')).toHaveAccessibleDescription(
    'Use a public source URL without credentials.',
  )
  expect(post).not.toHaveBeenCalled()
})
for (const operation of ['save', 'approve'] as const) {
  it(`preserves review edits on a failed ${operation} request and shows the failure next to the action`, async () => {
    const user = userEvent.setup()
    const workspace = demoData()
    workspace.ingredients = [
      {
        id: 'flour',
        name: 'Bread flour',
        unit: 'g',
        cost: 0.01,
        quantity: 1000,
        conversions: [],
      },
    ]
    const draft = parseRecipeText(
      'Failure bread\nYield: 2 loaves\nIngredients:\n8 cups bread flour\nInstructions:\nMix.',
    )
    draft.lines = draft.lines.map((l) => ({
      ...l,
      decision: 'match',
      ingredientId: 'flour',
      confirmed: true,
      cupStandard: 'us',
    }))
    const record = {
      id: 'failure',
      draft,
      updatedAt: 'v1',
      status: 'needs_review',
      sourceText: '',
      mime: 'text/plain',
      method: 'Pasted text',
    }
    const close = vi.fn()
    const requests: any[] = []
    vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) => {
      if (!options?.method) return Response.json({ imports: [record] })
      requests.push(JSON.parse(options.body as string))
      return Response.json(
        {
          error: 'Sign in again to save.',
          code: 'SIGN_IN_REQUIRED',
          stage: 'session_verification',
        },
        { status: 401 },
      )
    })
    render(
      <RecipeImport
        workspace={workspace}
        canEdit
        close={close}
        onWorkspace={vi.fn()}
        openRecipe={vi.fn()}
        onConversion={vi.fn()}
      />,
    )
    await user.click(
      await screen.findByRole('button', { name: /Failure bread.*Review/ }),
    )
    await user.clear(screen.getByLabelText('Recipe title'))
    await user.type(screen.getByLabelText('Recipe title'), 'Preserved title')
    const button = screen.getByRole('button', {
      name:
        operation === 'save' ? 'Save import draft' : 'Approve & create recipe',
    })
    expect(button).toBeEnabled() // A missing conversion is not an approval rule.
    await user.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('401')
    expect(screen.getByRole('alert').closest('footer')).not.toBeNull()
    expect(
      screen.getByRole('link', { name: /Sign in again in a new tab/ }),
    ).toHaveAttribute('target', '_blank')
    expect(screen.getByLabelText('Recipe title')).toHaveValue('Preserved title')
    expect(screen.getByLabelText('Quantity 1')).toHaveValue('8')
    expect(screen.getByLabelText('Pantry choice 1')).toHaveValue('flour')
    const navigation = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(navigation)
    expect(navigation.defaultPrevented).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0].operation).toBe(operation)
    expect(close).not.toHaveBeenCalled()
    expect(screen.queryByText(/Import draft saved/)).not.toBeInTheDocument()
  })
}
it('shows linked approval blockers while keeping incomplete draft saving enabled', async () => {
  const record = {
    id: 'incomplete',
    draft: recipeDraftSchema.parse({
      title: 'Incomplete bread',
      lines: [parseIngredient('8 cups bread flour')],
    }),
    status: 'needs_review',
    updatedAt: 'v1',
    sourceText: '',
    mime: 'text/plain',
    method: 'Pasted text',
  }
  vi.stubGlobal('fetch', async () => Response.json({ imports: [record] }))
  render(
    <RecipeImport
      workspace={demoData()}
      canEdit
      close={vi.fn()}
      onWorkspace={vi.fn()}
      openRecipe={vi.fn()}
      onConversion={vi.fn()}
    />,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: /Incomplete bread.*Review/ }),
  )
  await userEvent.click(screen.getByText(/Approval blocked:/))
  expect(
    screen.getByRole('link', { name: /positive yield and yield unit/ }),
  ).toHaveAttribute('href', '#import-yield')
  expect(
    screen.getByRole('link', { name: /confirm US or metric cups/ }),
  ).toHaveAttribute('href', '#import-line-0')
  expect(
    screen.getByRole('button', { name: 'Save import draft' }),
  ).toBeEnabled()
})
it('does not claim a malformed save response succeeded, and ignores repeated clicks while a save is pending', async () => {
  const record = {
    id: 'pending',
    draft: recipeDraftSchema.parse({ title: 'Pending bread' }),
    status: 'needs_review',
    updatedAt: 'v1',
    sourceText: '',
    mime: 'text/plain',
    method: 'Pasted text',
  }
  let respond: (value: Response) => void = () => {}
  const posts = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve
      }),
  )
  vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) =>
    options?.method ? posts() : Response.json({ imports: [record] }),
  )
  render(
    <RecipeImport
      workspace={demoData()}
      canEdit
      close={vi.fn()}
      onWorkspace={vi.fn()}
      openRecipe={vi.fn()}
      onConversion={vi.fn()}
    />,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: /Pending bread.*Review/ }),
  )
  const button = screen.getByRole('button', { name: 'Save import draft' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(posts).toHaveBeenCalledTimes(1)
  respond(Response.json({}))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'did not confirm this draft',
  )
  expect(screen.getByLabelText('Recipe title')).toHaveValue('Pending bread')
  expect(screen.queryByText(/Import draft saved/)).not.toBeInTheDocument()
})
it('keeps extraction in review, requires Pantry confirmation, preserves fractional edits and saves drafts separately', async () => {
  const user = userEvent.setup(),
    workspace = demoData(),
    source =
      'Imported recipe\nIngredients:\n2 cups bread flour\nInstructions:\nMix.',
    record = {
      id: 'draft',
      draft: parseRecipeText(source),
      status: 'needs_review',
      updatedAt: 'version-1',
      sourceText: source,
      mime: 'text/plain',
      method: 'Pasted text',
    },
    requests: any[] = []
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options?.method) return Response.json({ imports: [] })
    const body = JSON.parse(options.body as string)
    requests.push(body)
    return Response.json(
      body.operation === 'create'
        ? { imports: [record] }
        : { import: { ...record, draft: body.draft, updatedAt: 'version-2' } },
    )
  })
  vi.stubGlobal('fetch', fetcher)
  render(
    <RecipeImport
      workspace={workspace}
      canEdit
      close={vi.fn()}
      onWorkspace={vi.fn()}
      openRecipe={vi.fn()}
      onConversion={vi.fn()}
    />,
  )
  await user.type(screen.getByLabelText('Recipe text'), source)
  await user.click(screen.getByRole('button', { name: 'Extract for review' }))
  await screen.findByText('Match and review ingredients')
  expect(screen.getByRole('dialog')).toHaveAttribute(
    'data-presentation',
    'detail',
  )
  expect(screen.getByLabelText('Yield quantity')).toHaveValue(null)
  expect(
    screen.getByRole('button', { name: 'Approve & create recipe' }),
  ).toBeDisabled()
  await user.clear(screen.getByLabelText('Quantity 1'))
  await user.type(screen.getByLabelText('Quantity 1'), '1 1/2')
  expect(screen.getByLabelText('Quantity 1')).toHaveValue('1 1/2')
  await user.click(screen.getByRole('button', { name: 'Save import draft' }))
  await waitFor(() => expect(requests.at(-1).operation).toBe('save'))
  expect(requests.at(-1).draft.lines[0].quantity).toBe(1.5)
  expect(requests.every((r) => r.operation !== 'approve')).toBe(true)
  expect(screen.getByText(/Import draft saved/)).toBeInTheDocument()
})
it('warns before closing with edits and exposes only supported source methods', async () => {
  const user = userEvent.setup(),
    close = vi.fn()
  vi.stubGlobal('fetch', async () =>
    Response.json({ imports: [], cookbookProviders: [] }),
  )
  render(
    <RecipeImport
      workspace={demoData()}
      canEdit
      close={close}
      onWorkspace={vi.fn()}
      openRecipe={vi.fn()}
      onConversion={vi.fn()}
    />,
  )
  expect(
    screen.queryByRole('button', { name: 'Connect cookbook app' }),
  ).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Recipe text'), 'Unsaved recipe')
  await user.click(screen.getByRole('button', { name: 'Close recipe import' }))
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Keep reviewing' }))
  expect(screen.getByLabelText('Recipe text')).toHaveValue('Unsaved recipe')
  await user.click(
    screen.getByRole('button', { name: 'Import from a recipe link' }),
  )
  expect(screen.getByLabelText('Public recipe/share URL')).toBeInTheDocument()
})
it('offers CookBook shared-text import without claiming an account connection', async () => {
  const source =
    'Test crumble\n½ cup flour\nMethod:\n1. Mix.\nShared from CookBook\nhttps://cookbookmanager.com'
  const { parseCookBook } = await import('@/lib/cookbook')
  const requests: any[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options?.method) return Response.json({ imports: [] })
      const body = JSON.parse(options.body as string)
      requests.push(body)
      return Response.json({
        imports: [
          {
            id: 'cookbook',
            draft: parseCookBook(source).draft,
            status: 'needs_review',
            updatedAt: 'v1',
            sourceText: source,
            mime: 'text/plain',
            method: 'CookBook Manager shared text',
          },
        ],
      })
    }),
  )
  render(
    <RecipeImport
      workspace={demoData()}
      canEdit
      close={vi.fn()}
      onWorkspace={vi.fn()}
      openRecipe={vi.fn()}
      onConversion={vi.fn()}
    />,
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Import from CookBook' }),
  )
  expect(
    screen.getByText(/No account connection or synchronization/),
  ).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Recipe text'), source)
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract for review' }),
  )
  await screen.findByText('Match and review ingredients')
  expect(requests[0]).toMatchObject({
    operation: 'create',
    kind: 'cookbook',
    text: source,
  })
  expect(
    screen.getByRole('button', { name: 'Approve & create recipe' }),
  ).toBeDisabled()
})
it('reviews the actual crumble steps, edits and reorders them, and moves content between ingredients, instructions, optional additions and notes', async () => {
  const draft = parseRecipeText(bestCrumbleSource),
    requests: any[] = []
  const record = {
    id: 'crumble',
    draft,
    status: 'needs_review',
    updatedAt: 'v1',
    sourceText: bestCrumbleSource,
    sourceUrl: draft.sourceUrl,
    mime: 'text/plain',
    method: 'Pasted text',
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options?.method) return Response.json({ imports: [record] })
      const body = JSON.parse(options.body as string)
      requests.push(body)
      return Response.json({
        import: { ...record, draft: body.draft, updatedAt: 'v2' },
      })
    }),
  )
  render(
    <RecipeImport
      workspace={demoData()}
      canEdit
      close={vi.fn()}
      onWorkspace={vi.fn()}
      openRecipe={vi.fn()}
      onConversion={vi.fn()}
    />,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: /Best Crumble Topping/ }),
  )
  expect(screen.getAllByLabelText(/^Pantry choice/)).toHaveLength(6)
  expect(screen.getByLabelText('Method step 1')).toHaveValue(
    'Melt butter, set aside.',
  )
  expect(screen.getByLabelText('Method step 5')).toHaveValue(
    'Bake in the oven according to the recipe you are using.',
  )
  expect(screen.getByLabelText('Instruction section 1')).toHaveValue(
    'Crumble topping:',
  )
  expect(screen.getByLabelText('Optional addition 1')).toHaveValue(
    '1 chopped pecans, walnuts and/or oats 1/2 cup to 1 cup',
  )
  expect(screen.getByLabelText('Source URL')).toHaveValue(draft.sourceUrl)
  expect(screen.getByLabelText('Description')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('Method step 1'), {
    target: { value: 'Melt butter, set aside.\nKeep warm.' },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Move step 1 down' }),
  )
  expect(screen.getByLabelText('Method step 2')).toHaveValue(
    'Melt butter, set aside.\nKeep warm.',
  )
  await userEvent.selectOptions(
    screen.getByLabelText('Classify step 2'),
    'ingredient',
  )
  expect(screen.getAllByLabelText(/^Pantry choice/)).toHaveLength(7)
  expect(screen.getByLabelText('Original line 7')).toHaveValue(
    'Melt butter, set aside.\nKeep warm.',
  )
  await userEvent.selectOptions(
    screen.getByLabelText('Classify line 7'),
    'instruction',
  )
  expect(screen.getAllByLabelText(/^Pantry choice/)).toHaveLength(6)
  expect(screen.getByLabelText('Method step 5')).toHaveValue(
    'Melt butter, set aside.\nKeep warm.',
  )
  await userEvent.selectOptions(
    screen.getByLabelText('Classify optional addition 1'),
    'note',
  )
  expect(screen.getByLabelText('Notes')).toHaveValue(
    'Additions:\n1 chopped pecans, walnuts and/or oats 1/2 cup to 1 cup',
  )
  await userEvent.selectOptions(
    screen.getByLabelText('Classify line 1'),
    'optional',
  )
  expect(screen.getAllByLabelText(/^Pantry choice/)).toHaveLength(5)
  expect(screen.getByLabelText('Optional addition 1')).toHaveValue(
    '½ cup all-purpose flour',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add method step' }))
  fireEvent.change(screen.getByLabelText('Method step 6'), {
    target: { value: 'Review before baking.' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Remove step 6' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Save import draft' }),
  )
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0].operation).toBe('save')
  expect(requests[0].draft.instructions).toHaveLength(5)
  expect(requests[0].draft.instructions[4]).toBe(
    'Melt butter, set aside.\nKeep warm.',
  )
  expect(requests[0].draft.notes).toContain('pecans, walnuts and/or oats')
})
it('shows a prominent empty-method warning and gates reprocessing behind a preview and replacement confirmation', async () => {
  const source = parseRecipeText(bestCrumbleSource)
  const legacy = recipeDraftSchema.parse({
    title: 'Best Crumble Topping',
    lines: [
      ...source.lines,
      ...source.optionalAdditions,
      ...source.instructions.map((step, index) =>
        parseIngredient(`${index + 1}. ${step}`, 'Crumble topping'),
      ),
    ],
  })
  let record = {
    id: 'legacy',
    draft: legacy,
    status: 'needs_review',
    updatedAt: 'v1',
    sourceText: bestCrumbleSource,
    sourceUrl: source.sourceUrl,
    mime: 'text/plain',
    method: 'Pasted text',
  }
  const requests: any[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options?.method) return Response.json({ imports: [record] })
      const body = JSON.parse(options.body as string)
      requests.push(body)
      if (body.operation === 'previewReprocess')
        return Response.json({
          repair: reprocessRecipeDraft(
            body.draft,
            bestCrumbleSource,
            demoData().ingredients,
          ),
        })
      record = { ...record, draft: source, updatedAt: 'v2' }
      return Response.json({ import: record })
    }),
  )
  render(
    <RecipeImport
      workspace={demoData()}
      canEdit
      close={vi.fn()}
      onWorkspace={vi.fn()}
      openRecipe={vi.fn()}
      onConversion={vi.fn()}
    />,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: /Best Crumble Topping/ }),
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'original source contains directions',
  )
  expect(screen.getAllByLabelText(/^Pantry choice/)).toHaveLength(12)
  await userEvent.click(
    screen.getByRole('button', { name: 'Preview reprocess from original' }),
  )
  const preview = await screen.findByRole('region', {
    name: 'Proposed import repair',
  })
  expect(preview).toHaveTextContent('5 misclassified ingredient rows')
  expect(
    within(preview).getByRole('button', { name: 'Apply repair to this draft' }),
  ).toBeDisabled()
  expect(screen.getAllByLabelText(/^Pantry choice/)).toHaveLength(12)
  expect(requests).toHaveLength(1)
  await userEvent.click(within(preview).getByRole('checkbox'))
  await userEvent.click(
    within(preview).getByRole('button', { name: 'Apply repair to this draft' }),
  )
  await waitFor(() =>
    expect(screen.getAllByLabelText(/^Pantry choice/)).toHaveLength(6),
  )
  expect(requests.at(-1)).toMatchObject({
    operation: 'reprocess',
    id: 'legacy',
    confirmReplaceEdits: true,
    expectedUpdatedAt: 'v1',
  })
  expect(screen.getByLabelText('Method step 1')).toHaveValue(
    'Melt butter, set aside.',
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(requests.every((request) => request.operation !== 'approve')).toBe(
    true,
  )
})
