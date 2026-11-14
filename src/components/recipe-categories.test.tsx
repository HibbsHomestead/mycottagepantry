import { expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  RecipeCategorySelect,
  RecipeCategoryManager,
} from './recipe-categories'
import { PantryPhoto } from './pantry-photo'
import { demoData } from '@/lib/demo'
import { recipeCategories } from '@/lib/recipe-categories'
afterEach(() => vi.unstubAllGlobals())

it('updates the fallback and tone with category changes, preserves photos and uses a neutral uncategorized icon', () => {
  const categories = recipeCategories(demoData())
  const item = {
    id: 'test',
    name: 'My recipe',
    category: 'Cookies',
    imageAssetId: 'photo',
  }
  const { container, rerender } = render(
    <PantryPhoto item={item} kind="recipe" recipeCategories={categories} />,
  )
  expect(container.querySelector('[data-recipe-icon="cookie"]')).toHaveClass(
    'tone-terracotta',
  )
  rerender(
    <PantryPhoto
      item={{ ...item, category: 'Beverages' }}
      kind="recipe"
      recipeCategories={categories}
    />,
  )
  expect(container.querySelector('[data-recipe-icon="drink"]')).toHaveClass(
    'tone-blue',
  )
  rerender(
    <PantryPhoto
      item={item}
      assets={[{ id: 'photo', name: 'Photo', fileUrl: '/private/photo.png' }]}
      kind="recipe"
      recipeCategories={categories}
    />,
  )
  expect(screen.getByAltText('Photo of My recipe')).toHaveAttribute(
    'src',
    '/private/photo.png',
  )
  rerender(
    <PantryPhoto
      item={{ ...item, category: 'Beverages' }}
      assets={[{ id: 'photo', name: 'Photo', fileUrl: '/private/photo.png' }]}
      kind="recipe"
      recipeCategories={categories}
    />,
  )
  expect(screen.getByAltText('Photo of My recipe')).toHaveAttribute(
    'src',
    '/private/photo.png',
  )
  fireEvent.error(screen.getByAltText('Photo of My recipe'))
  expect(
    container.querySelector('[data-recipe-icon="drink"]'),
  ).toBeInTheDocument()
  rerender(
    <PantryPhoto
      item={{ ...item, category: '' }}
      kind="recipe"
      recipeCategories={categories}
    />,
  )
  expect(container.querySelector('[data-recipe-icon="other"]')).toHaveClass(
    'tone-neutral',
  )
})

it('shows the current archived category but excludes other archives from assignments', () => {
  const categories = recipeCategories(demoData()).map((c) => ({
    ...c,
    active: c.name !== 'Cookies' && c.name !== 'Cakes',
  }))
  const change = vi.fn()
  render(
    <RecipeCategorySelect
      recipe={{ id: 'saved', name: 'Recipe', category: 'Cookies' }}
      categories={categories}
      onChange={change}
    />,
  )
  expect(
    screen.getByRole('option', { name: 'Cookies (archived)' }),
  ).toBeDisabled()
  expect(
    screen.queryByRole('option', { name: 'Cakes (archived)' }),
  ).not.toBeInTheDocument()
  const beverage = categories.find((c) => c.name === 'Beverages')!
  fireEvent.change(screen.getByLabelText('Recipe category'), {
    target: { value: beverage.id },
  })
  expect(change).toHaveBeenCalledWith(beverage)
})

it('keeps failed custom category edits, supports the compact icon picker, and saves the chosen icon', async () => {
  const w = demoData(),
    onSettings = vi.fn()
  const api = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: 'Please retry' }, { status: 503 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        categories: [
          ...recipeCategories(w),
          {
            id: 'custom',
            name: 'Market drinks',
            icon: 'drink',
            active: true,
            previousNames: [],
          },
        ],
        revision: 1,
      }),
    )
  vi.stubGlobal('fetch', api)
  render(
    <RecipeCategoryManager
      workspace={w}
      onSettings={onSettings}
      close={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('New category name'), {
    target: { value: 'Market drinks' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Other icon' }))
  fireEvent.click(screen.getByRole('button', { name: 'Beverage' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry')
  expect(screen.getByLabelText('New category name')).toHaveValue(
    'Market drinks',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
  await waitFor(() => expect(onSettings).toHaveBeenCalled())
  expect(JSON.parse(api.mock.calls[1][1].body)).toMatchObject({
    expectedRevision: 0,
    category: { name: 'Market drinks', icon: 'drink' },
  })
  expect(screen.getByText('Market drinks')).toBeInTheDocument()
})
