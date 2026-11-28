export const printRotations = [0, 90, 180, 270] as const
export type PrintRotation = (typeof printRotations)[number]
type Size = { width: number; height: number }

export type PrinterProfile = {
  id: string
  name: string
  method: 'browser' | 'qz'
  width: number
  height: number
  unit: 'in' | 'mm'
  orientation: 'portrait' | 'landscape'
  designWidth?: number
  designHeight?: number
  rotation?: PrintRotation
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
      throw new Error(
        'Enter valid printer dimensions and calibration offsets.',
      )
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
  const scoped =
    data.designWidth !== undefined ||
    data.designHeight !== undefined ||
    data.rotation !== undefined
  if (
    scoped &&
    (!printRotations.includes(data.rotation) ||
      ![data.designWidth, data.designHeight].every(
        (size) => Number.isFinite(size) && size >= 36 && size <= 1008,
      ))
  )
    throw new Error('Choose a valid design size and output rotation.')
  if (scoped)
    checkPrinterSize(
      { width: data.designWidth, height: data.designHeight },
      data,
    )
  return {
    id: String(data.id || ''),
    name: data.name.trim(),
    method: data.method,
    width: data.width,
    height: data.height,
    unit: data.unit,
    orientation: data.orientation,
    ...(scoped && {
      designWidth: data.designWidth,
      designHeight: data.designHeight,
      rotation: data.rotation,
    }),
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
  return {
    width: points(p.width, p.unit),
    height: points(p.height, p.unit),
  }
}
export function printerDesign(p: PrinterProfile): Size {
  return p.designWidth !== undefined && p.designHeight !== undefined
    ? { width: p.designWidth, height: p.designHeight }
    : printerSize(p)
}

export const samePrintSize = (first: Size, second: Size) =>
  Math.abs(first.width - second.width) <= 0.1 &&
  Math.abs(first.height - second.height) <= 0.1

export function printPlacement(design: Size, profile?: PrinterProfile, rotation: PrintRotation = profile?.rotation ?? 0) {
  const { width, height } = design
  const rotated = rotation === 90 || rotation === 270
  const matrix: [number, number, number, number, number, number] =
    rotation === 90
      ? [0, 1, -1, 0, height, 0]
      : rotation === 180
        ? [-1, 0, 0, -1, width, height]
        : rotation === 270
          ? [0, -1, 1, 0, 0, width]
          : [1, 0, 0, 1, 0, 0]
  if (profile) {
    matrix[4] += points(profile.offsetX, profile.unit)
    matrix[5] += points(profile.offsetY, profile.unit)
  }
  const size = rotated ? { width: height, height: width } : design
  return { media: profile ? printerSize(profile) : size, matrix, size }
}

export function checkPrinterSize(d: Size, p: PrinterProfile) {
  const { size, media } = printPlacement(d, p)
  if (!samePrintSize(d, printerDesign(p)) || !samePrintSize(size, media))
    throw new Error(
      'The design, rotation and loaded media sizes differ. Select or save a matching print profile; artwork is never resized automatically.',
    )
}

export function pdfPrintMatrix(design: Size, profile: PrinterProfile) {
  const {
    media,
    matrix: [scaleX, skewY, skewX, scaleY, shiftX, shiftY],
  } = printPlacement(design, profile)
  return [
    scaleX,
    -skewY,
    -skewX,
    scaleY,
    shiftX + skewX * design.height,
    media.height - scaleY * design.height - shiftY,
  ] as const
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
    orientation: 'portrait',
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
