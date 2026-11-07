// Refresh the allowlisted Google Fonts catalog; no API key is required.
import { writeFile } from 'node:fs/promises'
const response = await fetch('https://fonts.google.com/metadata/fonts', {
  signal: AbortSignal.timeout(30000),
})
if (!response.ok) throw new Error('Google Fonts catalog is unavailable')
const text = await response.text()
const data = JSON.parse(text.slice(text.indexOf('{')))
const entries = data.familyMetadataList
  .filter((f) => f.isOpenSource)
  .map((f) => [f.family, f.category, Object.keys(f.fonts)])
await writeFile(
  'src/lib/google-font-catalog.ts',
  '// Google Fonts open-source catalog snapshot. Refresh with scripts/refresh-google-font-catalog.mjs.\nexport const googleFontCatalog: [string,string,string[]][] = ' +
    JSON.stringify(entries) +
    '\n',
)
console.log(`Updated ${entries.length} open-source Google Fonts families.`)
