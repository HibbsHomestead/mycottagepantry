export function BakeryArt() {
  return (
    <svg viewBox="0 0 320 170" fill="none" aria-hidden="true">
      <g
        stroke="#67765d"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M62 121c-13-11-8-43 10-57 21-16 43-19 62-12 22 9 40 40 33 56-5 14-37 27-60 28-21 1-35-5-45-15Z"
          fill="#ede3c7"
        />
        <path
          d="M61 121c32 12 75 4 106-14M72 66c10 7 21 18 25 29M96 55c13 8 23 19 27 31M121 52c15 8 24 18 27 28"
          strokeWidth="5"
          stroke="#f9f5e9"
        />
        <path
          d="M179 116c-5-10 8-35 24-43 17-9 36-7 48 4 11 10 24 23 24 38-1 13-23 24-47 26-18 2-42-11-49-25Z"
          fill="#dfcfa9"
        />
        <path
          d="m196 88 16 20m2-28 16 19m0-22 16 18"
          stroke="#faf4e3"
          strokeWidth="4"
        />
        <path d="M185 128c27 4 58-1 86-12M94 143c50 15 119 12 165-3M55 141l-19 6m12-13-13 1M279 133l12 6M185 65l19-39m-12 23c-14-2-11-15-11-15 12 2 14 9 11 15Zm5-12c12 2 19-10 19-10-11-4-18 1-19 10ZM159 44l-9-23m6 12c-12 0-15-9-15-9 11-4 15 2 15 9Z" />
        <path d="m244 58 20-28m-10 15c-9-6-7-15-7-15 11 0 13 9 7 15Zm7-11c11 4 20-3 20-3-8-8-17-5-20 3Z" />
      </g>
    </svg>
  )
}
export function FoodThumb({ kind = 'bread' }: { kind?: string }) {
  return (
    <div className={`food-thumb ${kind}`}>
      <svg viewBox="0 0 80 65" aria-hidden="true">
        {kind === 'cookies' ? (
          <>
            <circle cx="31" cy="35" r="21" fill="#c4915c" />
            <circle cx="51" cy="28" r="20" fill="#d7ab72" />
            {[
              [46, 17],
              [56, 33],
              [39, 31],
              [53, 23],
              [27, 28],
              [21, 39],
              [36, 44],
            ].map(([x, y]) => (
              <path
                key={x + ',' + y}
                d={`m${x} ${y} 4 1-1 4-4-1z`}
                fill="#634432"
              />
            ))}
          </>
        ) : kind === 'rolls' ? (
          <>
            <circle cx="28" cy="35" r="21" fill="#c68d54" />
            <circle cx="51" cy="29" r="21" fill="#d4a26a" />
            <path
              d="M53 30c-14 13-22-7-10-12 13-6 26 13 13 24M27 36c-10 9-16-8-7-12 13-5 21 12 9 22"
              fill="none"
              stroke="#f4dfb9"
              strokeWidth="5"
            />
          </>
        ) : (
          <>
            <path
              d="M13 43c-5-18 11-31 30-32 17-1 25 11 25 24v14c-17 10-39 9-55-6Z"
              fill="#c6965e"
            />
            <path
              d="M13 43c16 8 39 6 55-8"
              fill="none"
              stroke="#ac7744"
              strokeWidth="3"
            />
            <path
              d="m29 17 5 20m8-22 5 20m7-16 5 14"
              stroke="#f2ddb0"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </div>
  )
}
