// @vitest-environment node
import { expect, it } from 'vitest'
import { parseCookBook } from './cookbook'
import { cookBookArchive } from '../../netlify/lib/cookbook'
import { deflateRawSync } from 'node:zlib'
import { bestCrumbleSource as sample } from '../test/fixtures/best-crumble'
it('parses the supplied shared-text format, groups, fractions, ordered instructions, unknown yield and original lines', () => {
  const { draft, sourceUrl } = parseCookBook(sample)
  expect(draft.title).toBe('Best Crumble Topping')
  expect(draft.sourceApp).toBe('CookBook Manager')
  expect(sourceUrl).toContain('best-crumble-topping-recipe')
  expect(draft.lines).toHaveLength(6)
  expect(draft.lines[0]).toMatchObject({
    quantity: 0.5,
    unit: 'cup',
    original: '½ cup all-purpose flour',
  })
  expect(draft.optionalAdditions).toHaveLength(1)
  expect(draft.optionalAdditions[0].group).toBe('Additions')
  expect(draft.optionalAdditions[0].quantity).toBeNull()
  expect(draft.optionalAdditions[0].original).toContain(
    'pecans, walnuts and/or oats',
  )
  expect(draft.instructionGroups).toEqual(Array(5).fill('Crumble topping:'))
  expect(draft.instructions).toHaveLength(5)
  expect(draft.instructions[0]).toBe('Melt butter, set aside.')
  expect(draft.yieldQuantity).toBeNull()
  expect(draft.prepMinutes).toBeNull()
  expect(draft.cookMinutes).toBeNull()
})
it('does not guess undocumented native structures or accept invalid archives', async () => {
  expect(() => parseCookBook('{"recipes":[]}')).toThrow(/Unsupported CookBook/)
  await expect(cookBookArchive(Buffer.from('not zip'))).rejects.toThrow(
    /valid ZIP/,
  )
  await expect(cookBookArchive(Buffer.alloc(5_000_001))).rejects.toThrow(/5 MB/)
})
// Minimal ZIP fixture using ZIP's standard CRC32 and deflate; contents are the supplied text.
function zip(name: string, text: string, claimed?: number) {
  const content = Buffer.from(text),
    packed = deflateRawSync(content),
    filename = Buffer.from(name)
  let crc = 0xffffffff
  for (const b of content) {
    crc ^= b
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  crc = (crc ^ 0xffffffff) >>> 0
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(packed.length, 18)
  local.writeUInt32LE(claimed ?? content.length, 22)
  local.writeUInt16LE(filename.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(packed.length, 20)
  central.writeUInt32LE(claimed ?? content.length, 24)
  central.writeUInt16LE(filename.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + filename.length, 12)
  end.writeUInt32LE(local.length + filename.length + packed.length, 16)
  return Buffer.concat([local, filename, packed, central, filename, end])
}
it('detects actual shared-text archive contents and rejects unsafe, oversized or unsupported entries', async () => {
  expect(
    (await cookBookArchive(zip('recipes/crumble.txt', sample)))[0].draft.lines,
  ).toHaveLength(6)
  await expect(cookBookArchive(zip('../crumble.txt', sample))).rejects.toThrow()
  await expect(cookBookArchive(zip('native.json', sample))).rejects.toThrow(
    /Only CookBook/,
  )
  await expect(
    cookBookArchive(zip('large.txt', sample, 3_000_000)),
  ).rejects.toThrow(/exceeds/)
})
