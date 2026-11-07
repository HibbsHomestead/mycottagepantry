export type PrinterProfile = {
  id: string
  name: string
  method: 'browser' | 'qz'
  width: number
  height: number
  unit: 'in' | 'mm'
  orientation: 'portrait' | 'landscape'
  dpi?: number
  offsetX: number
  offsetY: number
  preferred: boolean
  options: { colorType: 'color' | 'blackwhite' }
}
export const points = (n: number, unit: 'in' | 'mm') =>
  n * (unit === 'mm' ? 72 / 25.4 : 72)
export function validatePrinterProfile(data: any): PrinterProfile {
  if (
    !data ||
    typeof data.name !== 'string' ||
    !data.name.trim() ||
    data.name.length > 200 ||
    !['browser', 'qz'].includes(data.method) ||
    !['in', 'mm'].includes(data.unit) ||
    !['portrait', 'landscape'].includes(data.orientation)
  )
    throw new Error(
      'Choose a printer, connection method, units and orientation.',
    )
  for (const k of ['width', 'height', 'offsetX', 'offsetY'])
    if (typeof data[k] !== 'number' || !Number.isFinite(data[k]))
      throw new Error('Enter valid printer dimensions and calibration offsets.')
  if (
    points(data.width, data.unit) < 36 ||
    points(data.height, data.unit) < 36 ||
    points(data.width, data.unit) > 1008 ||
    points(data.height, data.unit) > 1008 ||
    Math.abs(points(data.offsetX, data.unit)) > 72 ||
    Math.abs(points(data.offsetY, data.unit)) > 72
  )
    throw new Error(
      'Use labels between 0.5 and 14 inches and offsets within 1 inch.',
    )
  if (
    data.dpi !== undefined &&
    (!Number.isFinite(data.dpi) || data.dpi < 72 || data.dpi > 2400)
  )
    throw new Error('Enter a valid resolution or leave it blank.')
  return {
    id: String(data.id || ''),
    name: data.name.trim(),
    method: data.method,
    width: data.width,
    height: data.height,
    unit: data.unit,
    orientation: data.orientation,
    dpi: data.dpi,
    offsetX: data.offsetX,
    offsetY: data.offsetY,
    preferred: data.preferred === true,
    options: {
      colorType:
        data.options?.colorType === 'blackwhite' ? 'blackwhite' : 'color',
    },
  }
}
export function printerSize(p: PrinterProfile) {
  return { width: points(p.width, p.unit), height: points(p.height, p.unit) }
}
export function checkPrinterSize(
  d: { width: number; height: number },
  p: PrinterProfile,
) {
  const s = printerSize(p)
  if (Math.abs(d.width - s.width) > 0.1 || Math.abs(d.height - s.height) > 0.1)
    throw new Error(
      'The label and printer profile sizes differ. Match the label size before printing; artwork is never resized automatically.',
    )
}
// Full QZ 2.2+ options are generated on the server and reused without client overrides.
export function qzPrintOptions(p: PrinterProfile) {
  return {
    bounds: null,
    colorType: p.options.colorType,
    copies: 1,
    density: 0,
    duplex: false,
    fallbackDensity: null,
    interpolation: 'bicubic',
    jobName: 'Cottage Pantry labels',
    legacy: false,
    margins: 0,
    orientation: p.orientation,
    paperThickness: null,
    printerTray: null,
    rasterize: false,
    rotation: 0,
    scaleContent: false,
    size: { width: p.width, height: p.height },
    units: p.unit,
    forceRaw: false,
    encoding: null,
    spool: null,
  }
}
