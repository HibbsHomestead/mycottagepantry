import {
  checkPrinterSize,
  printerDesign,
  printPlacement,
  type PrinterProfile,
} from './label-printers'

export function calibrationMarkup(profile: PrinterProfile) {
  const design = printerDesign(profile)
  checkPrinterSize(design, profile)
  const { media, matrix } = printPlacement(design, profile)
  const { width, height } = design
  const guide = width >= 92 ? 72 : 18
  const start = (width - guide) / 2
  const middle = height / 2
  const fontSize = Math.min(9, height / 5)
  const feedX = media.width - 6
  const feedEnd = Math.min(47, media.height - 7)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${media.width}" height="${media.height}" viewBox="0 0 ${media.width} ${media.height}">
    <rect width="100%" height="100%" fill="white"/>
    <g transform="matrix(${matrix.join(' ')})" fill="#20231b">
      <rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="#20231b"/>
      <path d="M4 4h8L4 12Z"/>
      <path d="M${start} ${middle}h${guide}m-${guide} -3v6m${guide} -6v6" fill="none" stroke="#20231b"/>
      <g font-family="DM Sans, sans-serif" font-size="${fontSize}" text-anchor="middle">
        <text x="${width / 2}" y="${fontSize + 3}">TOP</text>
        <text x="${width / 2}" y="${height - 5}">BOTTOM</text>
        <text x="${width / 2}" y="${middle + fontSize + 1}">${guide === 72 ? '1 inch' : '¼ inch'}</text>
      </g>
    </g>
    <path d="M${feedX} 6V${feedEnd}m-2 -4l2 4 2 -4" fill="none" stroke="#20231b"/>
  </svg>`
}
