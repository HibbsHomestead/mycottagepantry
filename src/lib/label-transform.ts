import type { LabelElement } from './label-studio'

// Saved geometry is unchanged: (x, y) is the element's unrotated top-left
// corner and `rotation` (degrees, clockwise) pivots around that corner. The
// canvas, Label Check and PDF export all read this model, so these helpers
// only compute new x/y/width/height/rotation values within it. Rotating about
// the center or resizing from an anchor is expressed by moving (x, y) so the
// visual pivot or anchor stays put.

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const resizeHandles: ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]
export const cornerHandle = (h: ResizeHandle) => h.length === 2

type Point = { x: number; y: number }
type Box = Pick<LabelElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>

const rad = (deg: number) => (deg * Math.PI) / 180
const round = (v: number, places = 2) => {
  const f = 10 ** places
  return Math.round(v * f) / f
}

/** Rotate a local offset into label coordinates. */
export function rotateVector(p: Point, deg: number): Point {
  const c = Math.cos(rad(deg)),
    s = Math.sin(rad(deg))
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** Convert a label-space point into the element's unrotated local frame. */
export function toLocal(e: Box, p: Point): Point {
  return rotateVector({ x: p.x - e.x, y: p.y - e.y }, -e.rotation)
}

export function elementCenter(e: Box): Point {
  const v = rotateVector({ x: e.width / 2, y: e.height / 2 }, e.rotation)
  return { x: e.x + v.x, y: e.y + v.y }
}

/** Keep angles in (-180, 180] so saved values stay readable. */
export function normalizeAngle(deg: number) {
  let a = deg % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return round(a, 1) || 0
}

/** Set a new rotation while keeping the element's visual center fixed. */
export function rotateAboutCenter(
  e: Box,
  rotation: number,
): Pick<LabelElement, 'x' | 'y' | 'rotation'> {
  const c = elementCenter(e),
    next = normalizeAngle(rotation),
    v = rotateVector({ x: e.width / 2, y: e.height / 2 }, next)
  return { x: round(c.x - v.x), y: round(c.y - v.y), rotation: next }
}

/** Angle, in label degrees, of the rotation handle direction for a pointer. */
export function pointerAngle(e: Box, p: Point) {
  const c = elementCenter(e)
  // The handle sits above the element, so "straight up" is 0°.
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90
}

export function snapAngle(deg: number, step = 15) {
  return normalizeAngle(Math.round(deg / step) * step)
}

/** Images, icons and illustrations keep their proportions by default. */
export const keepsAspect = (e: LabelElement) =>
  e.type === 'image' || e.type === 'illustration'

const minimum = (e: LabelElement) => ({
  width: e.type === 'line' ? 2 : 6,
  height: 2,
})

/**
 * Resize from a handle using a pointer position in label coordinates. The
 * opposite corner/edge stays fixed on the page even when the element is
 * rotated, so the element never jumps.
 */
export function resizeElement(
  e: LabelElement,
  handle: ResizeHandle,
  pointer: Point,
  options: { keepAspect?: boolean; snap?: (v: number) => number } = {},
): Partial<LabelElement> {
  const p = toLocal(e, pointer),
    min = minimum(e),
    east = handle.includes('e'),
    west = handle.includes('w'),
    north = handle.includes('n'),
    south = handle.includes('s'),
    corner = cornerHandle(handle),
    // Corner drags of text scale the copy and its box together.
    scaleText = e.type === 'text' && corner,
    proportional = scaleText || !!options.keepAspect
  let width = east ? p.x : west ? e.width - p.x : e.width,
    height = south ? p.y : north ? e.height - p.y : e.height
  if (proportional) {
    let s: number
    if (corner)
      s = (width * e.width + height * e.height) / (e.width ** 2 + e.height ** 2)
    else if (east || west) s = width / e.width
    else s = height / e.height
    s = Math.max(s, min.width / e.width, min.height / e.height)
    width = e.width * s
    height = e.height * s
  } else {
    if (options.snap) {
      if (east || west) width = options.snap(width)
      if (north || south) height = options.snap(height)
    }
    width = Math.max(min.width, width)
    height = Math.max(min.height, height)
  }
  // Local position of the new box: the anchored side stays where it was;
  // proportional edge drags grow evenly along the other axis.
  const left = west
      ? e.width - width
      : !east && proportional
        ? (e.width - width) / 2
        : 0,
    top = north
      ? e.height - height
      : !south && proportional
        ? (e.height - height) / 2
        : 0,
    origin = rotateVector({ x: left, y: top }, e.rotation),
    patch: Partial<LabelElement> = {
      x: round(e.x + origin.x),
      y: round(e.y + origin.y),
      width: round(width),
      height: round(height),
    }
  if (scaleText) {
    const s = width / e.width,
      fontSize = Math.min(300, Math.max(1, round(e.fontSize * s, 1)))
    patch.fontSize = fontSize
    patch.letterSpacing = round(e.letterSpacing * (fontSize / e.fontSize))
  }
  return patch
}

const cursorNames = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize']
const handleAngles: Record<ResizeHandle, number> = {
  n: 0,
  ne: 45,
  e: 90,
  se: 135,
  s: 180,
  sw: 225,
  w: 270,
  nw: 315,
}
/** Resize cursor that follows the element's rotation. */
export function resizeCursor(handle: ResizeHandle, rotation: number) {
  const a = (((handleAngles[handle] + rotation) % 180) + 180) % 180
  return cursorNames[Math.round(a / 45) % 4]
}
/** Local position of each handle on an unrotated width × height box. */
export function handlePosition(
  handle: ResizeHandle,
  width: number,
  height: number,
): Point {
  return {
    x: handle.includes('w') ? 0 : handle.includes('e') ? width : width / 2,
    y: handle.includes('n') ? 0 : handle.includes('s') ? height : height / 2,
  }
}
