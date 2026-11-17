import { describe, expect, it } from 'vitest'
import {
  browseProducts,
  defaultProductCriteria as defaults,
} from './product-browse'
const products = [
  {
    id: 'a',
    name: 'Bread',
    price: 12,
    category: 'Bakery',
    imageAssetId: 'photo',
    recipeId: 'r',
  },
  { id: 'b', name: 'Cookies', price: 2, category: 'Bakery', workflow: 'food' },
  { id: 'c', name: 'Apron', price: '', workflow: 'handmade', quantity: 0 },
  { id: 'd', name: 'Bread', price: 12, category: 'Bakery' },
]
describe('product browsing', () => {
  it('combines criteria without changing source records', () => {
    expect(
      browseProducts(
        products,
        { id: 'settings', name: 'Demo' },
        {
          ...defaults,
          search: 'bread',
          category: 'Bakery',
          min: '10',
          image: 'has',
        },
      ).map((p) => p.id),
    ).toEqual(['a'])
    expect(products.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('compares numeric prices and leaves missing prices last both ways', () => {
    expect(
      browseProducts(
        products,
        { id: 'settings', name: 'Demo' },
        { ...defaults, sort: 'price' },
      ).map((p) => p.id),
    ).toEqual(['b', 'a', 'd', 'c'])
    expect(
      browseProducts(
        products,
        { id: 'settings', name: 'Demo' },
        { ...defaults, sort: 'price', direction: 'desc' },
      ).map((p) => p.id),
    ).toEqual(['a', 'd', 'b', 'c'])
    expect(
      browseProducts(
        products,
        { id: 'settings', name: 'Demo' },
        { ...defaults, max: '1' },
      ),
    ).toEqual([])
  })
  it('keeps default order and stable ties', () => {
    expect(
      browseProducts(products, { id: 'settings', name: 'Demo' }, defaults),
    ).toEqual(products)
    expect(
      browseProducts(
        [...products].reverse(),
        { id: 'settings', name: 'Demo' },
        { ...defaults, sort: 'name' },
      )
        .filter((p) => p.name === 'Bread')
        .map((p) => p.id),
    ).toEqual(['a', 'd'])
  })
  it('excludes made to order and untracked products from out of stock', () => {
    expect(
      browseProducts(
        [
          ...products,
          {
            id: 'e',
            name: 'Untracked',
            workflow: 'resale',
            trackInventory: false,
            quantity: 0,
          },
        ],
        { id: 'settings', name: 'Demo' },
        { ...defaults, stock: 'empty' },
      ).map((p) => p.id),
    ).toEqual(['c'])
  })
  it('sorts dates with missing values last', () => {
    const rows = [
      { id: 'a', name: 'A', updatedAt: '2026-01-01' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C', updatedAt: '2026-02-01' },
    ]
    expect(
      browseProducts(
        rows,
        { id: 'settings', name: 'Demo' },
        { ...defaults, sort: 'updatedAt', direction: 'desc' },
      ).map((p) => p.id),
    ).toEqual(['c', 'a', 'b'])
  })
  it('uses each variant record’s displayed price and actual status', () => {
    const variants = [
      { id:'large', name:'Cookie box', variant:'Large', price:12.5, status:'active' },
      { id:'small', name:'Cookie box', variant:'Small', price:4, status:'active' },
      { id:'old', name:'Cookie box', variant:'Retired', price:3, archived:true },
    ]
    expect(browseProducts(variants, {id:'s',name:'Demo'}, {...defaults,status:'active',sort:'price'}).map(p=>p.id)).toEqual(['small','large'])
    expect(browseProducts(variants, {id:'s',name:'Demo'}, {...defaults,status:'Archived'}).map(p=>p.id)).toEqual(['old'])
  })

})
