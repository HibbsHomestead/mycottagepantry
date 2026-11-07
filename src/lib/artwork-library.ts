import type { Item } from './domain'

const subjects = [
  ['bananas', 'Bananas', 'banana bread fruit'],
  ['carrots', 'Carrots', 'carrot cake vegetable'],
  ['coffee', 'Coffee', 'beans cup espresso mocha'],
  ['jamaican-rum', 'Jamaican rum', 'unbranded bottle sugarcane'],
  ['cinnamon-roll', 'Cinnamon rolls', 'bun swirl pastry'],
  ['strawberry', 'Strawberry', 'berries fruit'],
  ['spiced-orange', 'Spiced orange', 'cinnamon clove citrus'],
  ['orange', 'Orange', 'citrus fruit'],
  ['gingerbread', 'Gingerbread', 'ginger cookie holiday'],
  ['pumpkin', 'Pumpkin', 'autumn squash'],
  ['cranberry-orange', 'Cranberry orange', 'cranberries citrus berry'],
  ['chocolate', 'Chocolate', 'cocoa bar pieces'],
  ['brownie', 'Brownie', 'brownies fudge chocolate'],
  [
    'cookie-butter',
    'Spiced biscuit / cookie butter',
    'biscoff cookie spread speculoos',
  ],
] as const

/** Immutable allowlist: no customer-provided URLs or SVG markup enter this pipeline. */
export const artworkLibrary: Item[] = subjects.map(([slug, name, aliases]) => ({
  id: `pantry-art-v1:${slug}`,
  name,
  aliases,
  category: 'Original label artwork',
  fileUrl: `/artwork/${slug}.svg`,
  printUrl: `/artwork/${slug}.png`,
  widthPx: 1200,
  heightPx: 960,
  source: 'Original Cottage Pantry artwork',
  license: 'CC0-1.0',
  licenseUrl: '/artwork/LICENSE.md',
}))
export const libraryArtwork = (id: string) =>
  artworkLibrary.find((a) => a.id === id)
export function withLibraryArtwork(assets: Item[] = []) {
  return [...assets.filter((a) => !libraryArtwork(a.id)), ...artworkLibrary]
}
