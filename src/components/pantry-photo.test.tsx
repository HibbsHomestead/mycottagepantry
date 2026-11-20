import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PantryPhoto } from './pantry-photo'
it('falls back after an image error and displays a newly saved replacement', () => {
  const item = {
    id: 'bag',
    name: 'Flour bag',
    usedAs: 'ingredient',
    imageAssetId: 'photo',
  }
  const { rerender } = render(
    <PantryPhoto
      item={item}
      assets={[
        { id: 'photo', name: 'Photo', fileUrl: '/private/original.png' },
      ]}
    />,
  )
  fireEvent.error(screen.getByAltText('Photo of Flour bag'))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(
    screen.getByLabelText('ingredient icon for Flour bag'),
  ).toBeInTheDocument()
  rerender(
    <PantryPhoto
      item={item}
      assets={[
        { id: 'photo', name: 'Photo', fileUrl: '/private/replacement.png' },
      ]}
    />,
  )
  expect(screen.getByAltText('Photo of Flour bag')).toHaveAttribute(
    'src',
    '/private/replacement.png',
  )
})

it('uses existing thumbnail delivery for product and recipe table images', () => {
  const { rerender } = render(<PantryPhoto item={{id:'isolated', name:'Example', imageAssetId:'image'}} kind="product" className="table-thumbnail" assets={[{id:'image', name:'Image', fileUrl:'/api/workspace?asset=image'}]} />)
  expect(screen.getByRole('img')).toHaveAttribute('src', '/api/workspace?asset=image&imageWidth=128')
  rerender(<PantryPhoto item={{id:'isolated', name:'Example', imageAssetId:'image'}} kind="recipe" className="table-thumbnail" assets={[{id:'image', name:'Image', fileUrl:'/api/workspace?asset=image'}]} />)
  expect(screen.getByRole('img')).toHaveAttribute('src', '/api/workspace?asset=image&imageWidth=128')
})
