import { fromBuffer } from 'yauzl'
import { parseCookBook } from '../../src/lib/cookbook'
export async function cookBookArchive(bytes: Buffer) {
  if (bytes.length > 5_000_000)
    throw new Error('CookBook archives must be under 5 MB.')
  const texts: string[] = []
  await new Promise<void>((resolve, reject) => {
    fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip)
          return reject(new Error('This is not a valid ZIP archive.'))
        let count = 0,
          total = 0
        const fail = (e: Error) => {
          zip.close()
          reject(e)
        }
        zip.on('error', fail)
        zip.on('end', resolve)
        zip.on('entry', (entry) => {
          if (
            ++count > 100 ||
            entry.uncompressedSize > 2_000_000 ||
            (total += entry.uncompressedSize) > 10_000_000
          )
            return fail(
              new Error(
                'Archive exceeds 100 entries, 2 MB per file or 10 MB extracted.',
              ),
            )
          if (
            /\\|^\/|^[a-z]:|(^|\/)\.\.(\/|$)/i.test(entry.fileName) ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
            entry.generalPurposeBitFlag & 1
          )
            return fail(
              new Error(
                'Unsafe paths, symbolic links and encrypted entries are unsupported.',
              ),
            )
          if (entry.fileName.endsWith('/')) {
            zip.readEntry()
            return
          }
          if (!/\.txt$/i.test(entry.fileName))
            return fail(
              new Error(
                'Only CookBook shared plain-text (.txt) ZIP collections are supported. Native exports require an inspected sample; use individual PDF upload for PDFs.',
              ),
            )
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream)
              return fail(new Error('Could not read archive entry.'))
            const chunks: Buffer[] = []
            let size = 0
            stream.on('error', fail)
            stream.on('data', (chunk) => {
              size += chunk.length
              if (size > 2_000_000) {
                stream.destroy()
                fail(new Error('Extracted file exceeds limit.'))
                return
              }
              chunks.push(chunk)
            })
            stream.on('end', () => {
              texts.push(Buffer.concat(chunks).toString('utf8'))
              zip.readEntry()
            })
          })
        })
        zip.readEntry()
      },
    )
  })
  if (!texts.length || texts.length > 10)
    throw new Error('Choose an archive containing 1–10 shared-text recipes.')
  return texts.map((text) => ({ ...parseCookBook(text), text }))
}
