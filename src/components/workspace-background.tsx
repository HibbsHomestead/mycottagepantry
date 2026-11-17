import './cover-background.css'
import './workspace-background.css'

/** Static, theme-colored vector frame. No business state or pointer targets. */
function PantrySprig({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 160 360"
      fill="none"
      focusable="false"
    >
      <g
        stroke="var(--inventory-art-line)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M75 360C60 281 101 190 79 36M75 331C32 292 28 238 20 212M79 288C119 254 127 218 143 181M84 231C48 204 44 175 39 146M86 177C116 149 120 121 126 93M83 119C58 97 58 65 60 49" />
        {Array.from({ length: 9 }, (_, i) => (
          <g
            key={i}
            transform={`translate(${80 + Math.sin(i * 0.65) * 5} ${48 + i * 29}) rotate(${i % 2 ? 22 : -12})`}
          >
            <path d="M0 17C-21 11-25-3-24-11C-11-7-2 3 0 17ZM0 8C17 1 23-12 21-21C9-14 2-4 0 8Z" />
          </g>
        ))}
        <path d="M42 277C22 280 15 266 12 256C26 255 37 263 42 277ZM32 253C41 238 40 228 35 218C26 230 27 241 32 253ZM110 254C109 236 117 225 128 221C130 236 121 248 110 254ZM122 230C139 229 147 217 149 206C135 207 126 217 122 230ZM49 181C31 181 24 168 24 158C38 161 46 169 49 181ZM115 133C106 120 109 108 115 101C123 112 122 123 115 133Z" />
      </g>
    </svg>
  )
}
export function WorkspaceBackground() {
  return (
    <div className="cover-background workspace-background" aria-hidden="true">
      <svg
        className="inventory-flow"
        viewBox="0 0 1440 1000"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <path
          fill="var(--inventory-art-soft)"
          d="M0 0H1440V80C1180 210 1240 454 1000 537S480 443 0 760V645C410 339 759 525 1010 350S1135 80 1440 0Z"
        />
        <path
          fill="var(--inventory-art-fold)"
          d="M1440 126C1232 296 1312 456 1106 604S760 723 534 1000H1440V893C1174 1068 1041 910 833 935C1056 714 1232 778 1440 522Z"
        />
        <path
          fill="var(--inventory-art-soft)"
          d="M0 964C250 740 475 873 717 925S1126 1090 1440 793V1000H0Z"
        />
        <path
          fill="none"
          stroke="var(--inventory-art-highlight)"
          strokeWidth="2"
          d="M0 645C410 339 759 525 1010 350S1135 80 1440 0M0 964C250 740 475 873 717 925S1126 1090 1440 793"
        />
      </svg>
      <PantrySprig className="inventory-sprig inventory-sprig-right" />
      <PantrySprig className="inventory-sprig inventory-sprig-left" />
      <PantrySprig className="inventory-sprig inventory-sprig-bottom" />
    </div>
  )
}
