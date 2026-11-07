// Run after adding licensed, static TTF files to the font catalog.
import fs from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { bundledLabelFonts as fonts } from '../src/lib/label-font-catalog.ts'
const metrics = {}
for (const font of fonts)
  for (const weight of font.weights) {
    const key = font.file + (weight === 700 ? '-bold' : '')
    const face = fontkit.create(
      await fs.readFile(`public/label-fonts/${key}.ttf`),
    )
    metrics[key] = Object.fromEntries(
      face.characterSet.map((code) => [
        String(code),
        Number(
          (face.glyphForCodePoint(code).advanceWidth / face.unitsPerEm).toFixed(
            7,
          ),
        ),
      ]),
    )
  }
await fs.writeFile(
  'src/lib/label-font-metrics.ts',
  '// Generated from bundled licensed fonts by scripts/generate-label-font-metrics.mjs.\nexport const labelFontMetrics: Record<string, Record<string, number>> = ' +
    JSON.stringify(metrics) +
    '\n',
)
console.log(`Generated metrics for ${Object.keys(metrics).length} print faces.`)
