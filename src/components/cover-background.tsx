import { useSyncExternalStore } from "react";
import "./cover-background.css";
function subscribeToLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}
function isPreview() {
  return (
    new URLSearchParams(window.location.search).get("cover-preview") === "1"
  );
}

/** Review-only composition. No saved preference or business state is changed. */
export function CoverBackground() {
  const preview = useSyncExternalStore(
    subscribeToLocation,
    isPreview,
    () => false,
  );
  if (!preview) return null;
  return (
    <div className="cover-background" aria-hidden="true">
      <svg
        className="cover-ribbons cover-ribbons-top"
        viewBox="0 0 1600 500"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <linearGradient id="cover-ribbon-light" x2="1" y2="1">
            <stop stopColor="var(--cover-ribbon)" />
            <stop offset="1" stopColor="var(--background)" />
          </linearGradient>
        </defs>
        <path
          fill="var(--cover-underlay)"
          d="M0 0H1600V25C1190-55 1000 90 710 108S200 350 0 300Z"
        />
        <path
          fill="url(#cover-ribbon-light)"
          d="M0 0H1180C810 8 630 70 450 155S170 325 0 270Z"
        />
        <path fill="var(--cover-fold)" d="M0 0H560C360 65 270 200 0 247Z" />
        <path
          fill="none"
          stroke="var(--cover-highlight)"
          strokeWidth="2"
          d="M0 270C170 325 270 240 450 155S810 8 1180 0"
        />
      </svg>
      <svg
        className="cover-thread"
        viewBox="0 0 1100 160"
        fill="none"
        stroke="var(--cover-line)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <path d="M0 103C63 121 93 61 163 78M253 80C358 42 389 112 483 88M570 82C666 58 693 126 790 101M887 96C979 56 1018 106 1100 80" />
        <g transform="translate(177 37)">
          <g className="cover-motif">
            <path d="m0 25 35-18 36 18v43L35 87 0 68Zm0 0 35 19 36-19M35 44v43M17 16l36 18v16" />
          </g>
        </g>
        <g transform="translate(498 34)">
          <g className="cover-motif">
            <path d="m0 0 7 6 7-6 7 6 7-6 7 6 7-6 7 6 7-6v87l-7-6-7 6-7-6-7 6-7-6-7 6-7-6-7 6Z" />
            <path d="M13 25h30M13 40h30M13 55h20" />
          </g>
        </g>
        <g transform="translate(807 37)">
          <g className="cover-motif">
            <rect width="63" height="79" rx="8" />
            <path d="M10 12h43v17H10Z" />
            <path d="M11 42h9v9h-9ZM28 42h9v9h-9ZM45 42h8v9h-8ZM11 60h9v9h-9ZM28 60h9v9h-9ZM45 60h8v9h-8Z" />
          </g>
        </g>
      </svg>
      <svg
        className="cover-ribbons cover-ribbons-bottom"
        viewBox="0 0 1600 500"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path
          fill="var(--cover-underlay)"
          d="M1600 50C1330 280 1120 230 890 350S290 440 0 500H1600Z"
        />
        <path
          fill="url(#cover-ribbon-light)"
          d="M1600 170C1400 330 1260 300 1090 385S670 460 450 500H1600Z"
        />
        <path
          fill="var(--cover-fold)"
          d="M1600 325C1400 420 1240 440 1010 500H1600Z"
        />
        <path
          fill="none"
          stroke="var(--cover-highlight)"
          strokeWidth="2"
          d="M1600 170C1400 330 1260 300 1090 385S670 460 450 500"
        />
      </svg>
    </div>
  );
}
