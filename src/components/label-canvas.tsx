import type { RefObject } from 'react'
import { withLibraryArtwork } from '../lib/artwork-library'
import { effectiveFill } from '../lib/label-colors'
import {
  bakeryGraphics,
  labelBackground,
  elementAssetId,
  elementVisible,
  labelTextLines,
  labelFonts,
  type LabelDocument,
  type LabelElement,
  type LabelData,
} from '../lib/label-studio'
import {
  elementCenter,
  elementAngle,
  rotateVector,
  resizeHandles,
  handlePosition,
  cornerHandle,
  resizeCursor,
} from '../lib/label-transform'
import type { Item } from '../lib/domain'
const rotateCursor = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="#fff" stroke-width="4"/><path d="M20 4v5h-5" stroke="#fff" stroke-width="4"/><path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="#4a2440" stroke-width="2"/><path d="M20 4v5h-5" stroke="#4a2440" stroke-width="2"/></svg>',
)}") 12 12, grab`
/** Editor-only bounding box, resize handles and rotation handle. */
function SelectionOverlay({
  element: e,
  zoom,
  rotating,
}: {
  element: LabelElement
  zoom: number
  rotating: boolean
}) {
  // One screen pixel in label points, so handles stay the same on-screen
  // size at every zoom level.
  const px = 72 / 96 / Math.max(zoom, 0.05),
    handle = 9 * px,
    hit = 18 * px,
    stem = 22 * px,
    stroke = 1.25 * px,
    color = '#8d3d77',
    center = elementCenter(e),
    knob = rotateVector({ x: 0, y: -(e.height / 2 + stem) }, e.rotation)
  return (
    <g
      data-editor-only="true"
      data-element={e.id}
      data-selection-overlay={e.id}
    >
      <g transform={`translate(${e.x} ${e.y}) rotate(${e.rotation})`}>
        {e.type === 'line' ? (
          <line
            x1={0}
            y1={0}
            x2={e.width}
            y2={e.height}
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={e.locked ? `${4 * px} ${3 * px}` : undefined}
            pointerEvents="none"
          />
        ) : (
          <rect
            width={e.width}
            height={e.height}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={e.locked ? `${4 * px} ${3 * px}` : undefined}
            pointerEvents="none"
          />
        )}
        {!e.locked && (
          <>
            <line
              x1={e.width / 2}
              y1={e.type === 'line' ? e.height / 2 : 0}
              x2={e.width / 2}
              y2={-stem}
              stroke={color}
              strokeWidth={stroke}
              pointerEvents="none"
            />
            <g
              data-handle="rotate"
              aria-label="Rotate"
              style={{ cursor: rotating ? 'grabbing' : rotateCursor }}
            >
              <circle
                cx={e.width / 2}
                cy={-stem}
                r={hit / 2}
                fill="transparent"
              />
              <circle
                cx={e.width / 2}
                cy={-stem}
                r={handle / 2 + px}
                fill="#fff"
                stroke={color}
                strokeWidth={stroke}
              />
            </g>
            {resizeHandles
              .filter((h) => e.type !== 'line' || h === 'nw' || h === 'se')
              .map((h) => {
                const at = handlePosition(h, e.width, e.height),
                  corner = cornerHandle(h)
                return (
                  <g
                    key={h}
                    data-handle={h}
                    style={{ cursor: resizeCursor(h, e.rotation) }}
                  >
                    <rect
                      x={at.x - hit / 2}
                      y={at.y - hit / 2}
                      width={hit}
                      height={hit}
                      fill="transparent"
                    />
                    <rect
                      x={at.x - handle / 2}
                      y={at.y - (corner ? handle : handle * 0.7) / 2}
                      width={handle}
                      height={corner ? handle : handle * 0.7}
                      rx={corner ? 0 : handle * 0.3}
                      transform={
                        h === 'e' || h === 'w'
                          ? `rotate(90 ${at.x} ${at.y})`
                          : undefined
                      }
                      fill="#fff"
                      stroke={color}
                      strokeWidth={stroke}
                    />
                  </g>
                )
              })}
          </>
        )}
      </g>
      {rotating && (
        <g
          pointerEvents="none"
          transform={`translate(${center.x + knob.x * 1.6} ${center.y + knob.y * 1.6 - 16 * px})`}
        >
          <rect
            x={-24 * px}
            y={-10 * px}
            width={48 * px}
            height={20 * px}
            rx={4 * px}
            fill="#4a2440"
          />
          <text
            y={4.5 * px}
            textAnchor="middle"
            fontSize={12 * px}
            fontFamily="DM Sans, sans-serif"
            fill="#fff"
            data-rotation-readout="true"
          >
            {Math.round(elementAngle(e) * 10) / 10}°
          </text>
        </g>
      )}
    </g>
  )
}
export function LabelCanvas({
  document: d,
  data,
  assets = [],
  selected,
  select,
  svgRef,
  editor = false,
  safe = false,
  grid = false,
  zoom = 1,
  rotating = false,
}: {
  document: LabelDocument
  data: LabelData
  assets?: Item[]
  selected?: string
  select?: (id: string) => void
  svgRef?: RefObject<SVGSVGElement | null>
  editor?: boolean
  safe?: boolean
  grid?: boolean
  zoom?: number
  rotating?: boolean
}) {
  assets = [
    ...assets,
    ...withLibraryArtwork(assets).filter(
      (a) => !assets.some((existing) => existing.id === a.id),
    ),
  ]
  const selectedElement = selected
    ? d.elements.find((e) => e.id === selected)
    : undefined
  const clipId =
    'label-' + d.id.replace(/[^a-z0-9]/gi, '') + (editor ? 'editor' : 'preview')
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${d.width} ${d.height}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={d.name}
      className="studio-label-svg"
    >
      <defs>
        <clipPath id={clipId}>
          <rect
            width={d.width}
            height={d.height}
            rx={d.round ? d.width / 2 : 0}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect
          width={d.width}
          height={d.height}
          rx={d.round ? d.width / 2 : 0}
          fill={labelBackground(d).background}
          fillOpacity={labelBackground(d).backgroundOpacity}
        />
        {grid && (
          <g data-editor-only="true" opacity=".15">
            {Array.from({ length: Math.floor(d.width / 9) }, (_, i) => (
              <path
                key={'x' + i}
                d={`M${(i + 1) * 9} 0V${d.height}`}
                stroke="#555"
                strokeWidth=".3"
              />
            ))}
            {Array.from({ length: Math.floor(d.height / 9) }, (_, i) => (
              <path
                key={'y' + i}
                d={`M0 ${(i + 1) * 9}H${d.width}`}
                stroke="#555"
                strokeWidth=".3"
              />
            ))}
          </g>
        )}
        {d.elements
          .filter((e) => elementVisible(e, data))
          .map((e) => {
            const lines = labelTextLines(e, data),
              total = lines.length * e.fontSize * e.lineHeight,
              offset =
                e.vertical === 'middle'
                  ? (e.height - total) / 2
                  : e.vertical === 'bottom'
                    ? e.height - total
                    : 0
            return (
              <g
                key={e.id}
                data-element={e.id}
                transform={`translate(${e.x} ${e.y}) rotate(${e.rotation})`}
                opacity={e.opacity}
                onClick={() => select?.(e.id)}
                style={{
                  cursor: editor ? (e.locked ? 'default' : 'move') : undefined,
                }}
              >
                {editor && (
                  <rect
                    data-editor-only="true"
                    width={e.width}
                    height={e.height}
                    fill="transparent"
                  />
                )}
                {e.type === 'text' && (
                  <>
                    {e.fill !== 'transparent' && (
                      <rect
                        width={e.width}
                        height={e.height}
                        fill={e.fill}
                        fillOpacity={e.fillOpacity ?? 1}
                      />
                    )}
                    <text
                      fill={e.color}
                      fillOpacity={e.colorOpacity ?? 1}
                      fontFamily={JSON.stringify(e.font)}
                      style={{
                        fontKerning: 'none',
                        fontVariantLigatures: 'none',
                      }}
                      fontSize={e.fontSize}
                      fontWeight={
                        e.binding === 'recipe.ingredients'
                          ? 400
                          : e.bold
                            ? 700
                            : 400
                      }
                      xmlSpace={
                        e.binding === 'recipe.ingredients'
                          ? 'preserve'
                          : undefined
                      }
                      fontStyle={e.italic ? 'italic' : 'normal'}
                      textDecoration={e.underline ? 'underline' : undefined}
                      letterSpacing={e.letterSpacing}
                      textAnchor={
                        e.align === 'center'
                          ? 'middle'
                          : e.align === 'right'
                            ? 'end'
                            : 'start'
                      }
                    >
                      {lines.map((line, i) => (
                        <tspan
                          key={i}
                          x={
                            e.align === 'center'
                              ? e.width / 2
                              : e.align === 'right'
                                ? e.width
                                : 0
                          }
                          y={
                            offset + e.fontSize + i * e.fontSize * e.lineHeight
                          }
                        >
                          {line.map((run, index) => (
                            <tspan
                              key={index}
                              fontFamily={JSON.stringify(run.font)}
                              fontWeight={
                                run.bold === undefined
                                  ? undefined
                                  : run.bold
                                    ? 700
                                    : 400
                              }
                              // A selected single-weight font keeps its family. Use the
                              // same small outline in SVG/PNG/PDF instead of relying on
                              // renderer-specific synthetic bold support.
                              stroke={
                                run.bold &&
                                !labelFonts
                                  .find((f) => f.name === run.font)
                                  ?.weights.includes(700)
                                  ? e.color
                                  : undefined
                              }
                              strokeWidth={
                                run.bold &&
                                !labelFonts
                                  .find((f) => f.name === run.font)
                                  ?.weights.includes(700)
                                  ? e.fontSize * 0.02
                                  : undefined
                              }
                              strokeOpacity={e.colorOpacity ?? 1}
                              style={
                                run.bold === undefined
                                  ? undefined
                                  : { fontSynthesisWeight: 'none' }
                              }
                            >
                              {run.text}
                            </tspan>
                          ))}
                        </tspan>
                      ))}
                    </text>
                  </>
                )}
                {(e.type === 'shape' || e.type === 'border') && (
                  <rect
                    width={e.width}
                    height={e.height}
                    fill={e.type === 'border' ? 'none' : effectiveFill(e)}
                    fillOpacity={e.fillOpacity ?? 1}
                    stroke={e.color}
                    strokeOpacity={e.colorOpacity ?? 1}
                    strokeWidth="1"
                  />
                )}
                {e.type === 'line' && (
                  <line
                    x1="0"
                    y1="0"
                    x2={e.width}
                    y2={e.height}
                    stroke={e.color}
                    strokeOpacity={e.colorOpacity ?? 1}
                  />
                )}
                {e.type === 'illustration' && (
                  <svg width={e.width} height={e.height} viewBox="0 0 100 100">
                    <path
                      d={
                        bakeryGraphics[e.graphic || 'bread'] ||
                        bakeryGraphics.bread
                      }
                      fill="none"
                      stroke={e.color}
                      strokeOpacity={e.colorOpacity ?? 1}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                {e.type === 'image' &&
                  (assets.find((a) => a.id === elementAssetId(e, data)) ? (
                    <svg width={e.width} height={e.height} overflow="hidden">
                      <image
                        href={
                          assets.find((a) => a.id === elementAssetId(e, data))
                            ?.fileUrl
                        }
                        width={e.width}
                        height={e.height}
                        preserveAspectRatio={
                          e.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
                        }
                      />
                    </svg>
                  ) : editor ? (
                    <g data-editor-only="true">
                      <rect
                        width={e.width}
                        height={e.height}
                        fill="#f1edf2"
                        stroke="#806777"
                        strokeDasharray="4 3"
                      />
                      <text x="6" y="16" fontSize="10" fill="#5d4857">
                        Select / upload artwork
                      </text>
                    </g>
                  ) : null)}
              </g>
            )
          })}
        {editor && selected && (
          <g data-editor-only="true" pointerEvents="none" opacity=".5">
            <line
              x1={d.width / 2}
              y1="0"
              x2={d.width / 2}
              y2={d.height}
              stroke="#8d3d77"
              strokeWidth=".5"
              strokeDasharray="3 4"
            />
            <line
              x1="0"
              y1={d.height / 2}
              x2={d.width}
              y2={d.height / 2}
              stroke="#8d3d77"
              strokeWidth=".5"
              strokeDasharray="3 4"
            />
          </g>
        )}
        {safe && (
          <rect
            data-editor-only="true"
            x="9"
            y="9"
            width={d.width - 18}
            height={d.height - 18}
            rx={d.round ? (d.width - 18) / 2 : 0}
            fill="none"
            stroke="#925a94"
            strokeWidth=".7"
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}
      </g>
      {editor && selectedElement && elementVisible(selectedElement, data) && (
        <SelectionOverlay
          element={selectedElement}
          zoom={zoom}
          rotating={rotating}
        />
      )}
    </svg>
  )
}
