import { z } from 'zod'
import { catalogFieldKeys } from './catalog'
export const photoSides = ['front', 'back', 'closeup1', 'closeup2'] as const
export const photoLabels = {
  front: 'Front photo',
  back: 'Back / label photo',
  closeup1: 'Close-up 1',
  closeup2: 'Close-up 2',
}
export const photoEvidenceSchema = z
  .object({
    fields: z
      .array(
        z
          .object({
            field: z.enum(catalogFieldKeys),
            value: z.union([
              z.string().min(1).max(30000),
              z.number().finite().positive(),
            ]),
            photoId: z.enum(photoSides),
            quote: z.string().min(1).max(30000),
            uncertain: z.boolean(),
            region: z
              .tuple([
                z.number().min(0).max(1),
                z.number().min(0).max(1),
                z.number().min(0).max(1),
                z.number().min(0).max(1),
              ])
              .nullable()
              .optional(),
          })
          .strict(),
      )
      .max(50),
    warnings: z.array(z.string().max(1000)).max(20),
  })
  .strict()
export type PhotoEvidence = z.infer<typeof photoEvidenceSchema>
/** Decode with browser EXIF orientation and strip metadata on encoding. */
export async function preparePackagePhoto(
  file: File,
  turns = 0,
): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error(
      'Choose JPEG, PNG or WebP. Export HEIC/HEIF as JPEG or retake the photo.',
    )
  if (file.size > 20 * 1024 * 1024)
    throw new Error('Choose a photo under 20 MiB.')
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  })
  try {
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height)),
      w = Math.round(bitmap.width * scale),
      h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas'),
      odd = turns % 2 !== 0
    canvas.width = odd ? h : w
    canvas.height = odd ? w : h
    const ctx = canvas.getContext('2d')!
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((turns * Math.PI) / 2)
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error('This photo could not be prepared. Try JPEG.')),
        'image/jpeg',
        0.85,
      ),
    )
    if (blob.size > 1024 * 1024)
      throw new Error(
        'This photo is too large after preparation. Crop closer to the label and retry.',
      )
    return blob
  } finally {
    bitmap.close()
  }
}
