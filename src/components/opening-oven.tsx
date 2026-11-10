import { useId } from 'react'
import './opening-oven.css'

/** Decorative only: its lifecycle follows the existing pending request. */
export function OpeningOven() {
  const glow = useId()
  return (
    <svg
      className="opening-oven"
      viewBox="0 0 260 240"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={glow}>
          <stop stopColor="#fff" />
          <stop offset=".6" stopColor="#ede7fa" />
          <stop offset="1" stopColor="#b9a7d6" />
        </radialGradient>
      </defs>
      <ellipse cx="130" cy="222" rx="83" ry="6" fill="#635774" opacity=".1" />
      <g
        stroke="#57416f"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M61 185v16q5 6 14 0v-16m110 0v16q5 6 14 0v-16"
          fill="#9ba0ad"
        />
        <path
          d="M51 64q-1-12 12-13l130 1q14 0 15 13l-2 119q0 12-13 13H65q-14-1-14-14Z"
          fill="#80639d"
        />
        <path d="M54 67q73-6 151 0v27H53Z" fill="#d4c5e8" />
        <path
          d="M69 54q15-9 30-1m60 0q15-8 30 1"
          fill="none"
          stroke="#f5f2fc"
          strokeWidth="3"
        />
        <circle cx="73" cy="80" r="6" fill="#fff" />
        <path d="M73 76v4" stroke="#9297a4" strokeWidth="2" />
        <circle cx="187" cy="80" r="6" fill="#fff" />
        <path d="M187 76v4" stroke="#9297a4" strokeWidth="2" />
        <rect x="108" y="73" width="44" height="13" rx="4" fill="#665079" />
        <path d="M120 79h7m7 0h6" stroke="#f4efff" strokeWidth="2" />
        <rect
          x="65"
          y="101"
          width="130"
          height="80"
          rx="9"
          fill={`url(#${glow})`}
        />
        <path d="M76 156h108m-103 7h98" stroke="#a7a3b4" strokeWidth="2" />
        <path
          d="M85 144q2-18 17-18t17 18m5 0q2-18 17-18t17 18m5 0q1-12 12-12"
          fill="#e1d5f1"
          stroke="#ad96c5"
          strokeWidth="2"
        />
        <g className="opening-oven-door">
          <rect x="62" y="99" width="136" height="82" rx="9" fill="#987bb5" />
          <rect x="76" y="119" width="108" height="49" rx="8" fill="#655078" />
          <path d="m87 129 17-1m-17 7 9-1" stroke="#bfb0d3" strokeWidth="2" />
          <path d="M79 109h102" stroke="#e3e5ec" strokeWidth="6" />
          <path d="M79 109h102" stroke="#fff" strokeWidth="2" />
        </g>
      </g>
      <g
        className="opening-oven-steam"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
      >
        <path
          className="oven-steam oven-steam-one"
          d="M102 139c-17-13 16-20 0-36s8-23 3-35"
        />
        <path
          className="oven-steam oven-steam-two"
          d="M132 144c17-15-16-24-1-40s-7-24-1-37"
        />
        <path
          className="oven-steam oven-steam-three"
          d="M160 138c-15-13 16-20 1-35s8-21 3-32"
        />
      </g>
    </svg>
  )
}
