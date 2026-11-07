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
