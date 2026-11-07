import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { demoData } from '@/lib/demo'
import { money, productCosting, profitability } from '@/lib/domain'
import { ProductCards } from './product-cards'

it('uses saved product photos and selling units with the existing cost and tax calculations', () => {
  const workspace = demoData()
  Object.assign(workspace.products[0], {
    imageAssetId: 'photo',
    sellingUnit: 'loaf',
    category: 'Breads',
    status: 'active',
  })
  workspace.products[1].sellingUnit = 'half-dozen box'
  workspace.graphic_assets = [
    { id: 'photo', name: 'Product photo', fileUrl: '/product.png' },
  ]
  render(
    <ProductCards
      products={workspace.products}
      workspace={workspace}
      open={vi.fn()}
    />,
  )
  const card = within(
    screen.getByRole('article', { name: workspace.products[0].name }),
  )
  expect(
    card.getByAltText(`Photo of ${workspace.products[0].name}`),
  ).toHaveAttribute('src', '/product.png')
  expect(card.getByText('$8.00 / loaf')).toBeInTheDocument()
  expect(card.getByText('Breads · active')).toBeInTheDocument()
  const cost = productCosting(workspace.products[0], workspace).perPackage
  const pricing = profitability(
    workspace.products[0],
    cost,
    workspace.settings[0],
  )
  expect(card.getByText(money(cost))).toBeInTheDocument()
  expect(card.getByText(money(pricing.profit))).toBeInTheDocument()
  expect(card.getByText(`${pricing.margin.toFixed(1)}%`)).toBeInTheDocument()
  expect(screen.getByText('$12.00 / half-dozen box')).toBeInTheDocument()
  expect(screen.getByText('$12.00 / package')).toBeInTheDocument()
})

it.each([
  'ingredient flag',
  'missing price',
  'blank price',
  'packaging flag',
  'unlinked recipe',
  'missing conversion',
])('shows incomplete costs without invented profit for %s', (scenario) => {
  const workspace = demoData(),
    product = workspace.products[0]
  const flour = workspace.ingredients.find((i) => i.id === 'flour')!
  if (scenario === 'ingredient flag') flour.needsCostSetup = true
  if (scenario === 'missing price') {
    delete flour.cost
    delete flour.currentCost
  }
  if (scenario === 'blank price') flour.currentCost = ' '
  if (scenario === 'packaging flag')
    workspace.ingredients.find((i) => i.id === 'bags')!.needsCostSetup = true
  if (scenario === 'unlinked recipe') product.recipeId = null
  if (scenario === 'missing conversion')
    workspace.recipes.find((r) => r.id === product.recipeId)!.lines[0].unit =
      'cup'
  render(
    <ProductCards products={[product]} workspace={workspace} open={vi.fn()} />,
  )
  expect(screen.getByText('Cost incomplete')).toBeInTheDocument()
  expect(screen.getByText('Incomplete')).toBeInTheDocument()
  expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  expect(screen.queryByText(/\d+\.\d%/)).not.toBeInTheDocument()
})

it('keeps explicit free costs valid but does not treat a missing selling price as free', () => {
  const workspace = demoData(),
    product = workspace.products[0]
  for (const item of workspace.ingredients) {
    item.cost = 0
    item.currentCost = 0
  }
  const recipe = workspace.recipes.find((r) => r.id === product.recipeId)!
  Object.assign(recipe, {
    laborMinutes: 0,
    overhead: 0,
    wastePercent: 0,
    packagingCost: 0,
  })
  delete product.price
  render(
    <ProductCards products={[product]} workspace={workspace} open={vi.fn()} />,
  )
  expect(screen.getByText('$0.00')).toBeInTheDocument()
  expect(screen.getByText('Price not set / package')).toBeInTheDocument()
  expect(screen.getByText('Pricing incomplete')).toBeInTheDocument()
  expect(screen.getAllByText('Unavailable')).toHaveLength(2)
})

it('uses a product placeholder for missing/broken images and displays saved replacements', () => {
  const workspace = demoData(),
    product = workspace.products[0]
  // Ingredient and label artwork must never become an implicit product photo.
  workspace.ingredients[0].imageAssetId = 'ingredient'
  product.graphicAssetId = 'ingredient'
  workspace.graphic_assets = [
    { id: 'ingredient', name: 'Ingredient photo', fileUrl: '/ingredient.png' },
  ]
  const { rerender } = render(
    <ProductCards products={[product]} workspace={workspace} open={vi.fn()} />,
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(
    screen.getByLabelText(`product icon for ${product.name}`),
  ).toBeInTheDocument()
  product.imageAssetId = 'photo'
  workspace.graphic_assets.push({
    id: 'photo',
    name: 'Product photo',
    fileUrl: '/original.png',
  })
  rerender(
    <ProductCards products={[product]} workspace={workspace} open={vi.fn()} />,
  )
  fireEvent.error(screen.getByAltText(`Photo of ${product.name}`))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  workspace.graphic_assets[1].fileUrl = '/replacement.png'
  product.price = 9.25
  rerender(
    <ProductCards products={[product]} workspace={workspace} open={vi.fn()} />,
  )
  expect(screen.getByAltText(`Photo of ${product.name}`)).toHaveAttribute(
    'src',
    '/replacement.png',
  )
  expect(screen.getByText('$9.25 / package')).toBeInTheDocument()
})

it('opens existing detail and product editing flows from the photo, title, footer, and keyboard menu', async () => {
  const workspace = demoData(),
    product = workspace.products[0],
    open = vi.fn(),
    user = userEvent.setup()
  render(
    <ProductCards products={[product]} workspace={workspace} open={open} />,
  )
  for (const name of [
    `View photo and details for ${product.name}`,
    product.name,
    'View details',
  ]) {
    await user.click(screen.getByRole('button', { name }))
    expect(open).toHaveBeenLastCalledWith('product-detail', product)
  }
  await user.click(screen.getByRole('button', { name: 'Edit Product' }))
  expect(open).toHaveBeenLastCalledWith('product', product)
  open.mockClear()
  await user.click(
    screen.getByRole('button', { name: `Actions for ${product.name}` }),
  )
  await user.keyboard('{ArrowDown}{End}{Enter}')
  expect(open).toHaveBeenCalledOnce()
  expect(open).toHaveBeenLastCalledWith('product', product)
})

it('preserves the supplied filtered record order and offers a readable empty state', () => {
  const workspace = demoData(),
    products = [...workspace.products].reverse()
  const { rerender } = render(
    <ProductCards products={products} workspace={workspace} open={vi.fn()} />,
  )
  expect(
    screen.getAllByRole('article').map((el) => el.getAttribute('aria-label')),
  ).toEqual(products.map((p) => p.name))
  rerender(<ProductCards products={[]} workspace={workspace} open={vi.fn()} />)
  expect(screen.queryAllByRole('article')).toHaveLength(0)
  expect(screen.getByText('No products match this view.')).toBeInTheDocument()
})
