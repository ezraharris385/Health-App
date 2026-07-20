/**
 * PoseAnimation: a small, generic, looping line-figure animation that hints at
 * a mobility pose's movement. It is intentionally schematic (a clean stick /
 * line figure), not an exact depiction. Rendered tiny in the stretch-bank table
 * and large on the detail + Follow views.
 *
 * Implemented with CSS keyframes on SVG groups (transform-box: view-box, so
 * transform-origin is in viewBox coordinates). The global
 * `@media (prefers-reduced-motion: reduce)` rule in theme.css sets
 * `animation: none !important`, which freezes every figure at its resting 0%
 * pose — so reduced-motion users see a static, sensible silhouette for free.
 *
 * Theme-colored via `currentColor` (limbs) + var(--muted) (ground); the caller
 * sets the color by wrapping in an element with `color: var(--accent)` etc.
 */
import { useMemo } from "react";
import type { MobilityAnimKind } from "@shared/types";
import { ANIM_KINDS } from "@shared/data/stores/mobility";

export const ANIM_KIND_LABELS: Record<MobilityAnimKind, string> = {
  none: "Neutral / standing",
  reach_up: "Reach up",
  forward_fold: "Forward fold",
  twist: "Twist",
  lunge: "Lunge",
  hold: "Static hold",
  side_bend: "Side bend",
  cat_cow: "Cat–cow",
  neck_roll: "Neck roll",
};

export const ANIM_KIND_OPTIONS: { value: MobilityAnimKind; label: string }[] = ANIM_KINDS.map(
  (value) => ({ value, label: ANIM_KIND_LABELS[value] }),
);

// One shared <style> block for every figure on the page. Injected once so the
// stretch-bank table can render dozens of tiny figures without repeating rules.
const STYLE_ID = "pose-animation-keyframes";
const KEYFRAMES = `
@keyframes pa-armL-up { 0%,100% { transform: rotate(0deg); } 45%,75% { transform: rotate(-112deg); } }
@keyframes pa-armR-up { 0%,100% { transform: rotate(0deg); } 45%,75% { transform: rotate(112deg); } }
@keyframes pa-fold { 0%,100% { transform: rotate(0deg); } 45%,60% { transform: rotate(74deg); } }
@keyframes pa-twist { 0%,100% { transform: rotate(-15deg) skewX(7deg); } 50% { transform: rotate(15deg) skewX(-7deg); } }
@keyframes pa-legL-lunge { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(26deg); } }
@keyframes pa-legR-lunge { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(-24deg); } }
@keyframes pa-bob { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(8px); } }
@keyframes pa-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.045); } }
@keyframes pa-sidebend { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(21deg); } 75% { transform: rotate(-21deg); } }
@keyframes pa-catcow { 0%,100% { transform: rotate(-9deg); } 50% { transform: rotate(15deg); } }
@keyframes pa-neck { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(22deg); } 75% { transform: rotate(-22deg); } }

.pa-svg .pa-upper,
.pa-svg .pa-armL,
.pa-svg .pa-armR,
.pa-svg .pa-legL,
.pa-svg .pa-legR,
.pa-svg .pa-head,
.pa-svg .pa-fig { transform-box: view-box; }
.pa-svg .pa-upper { transform-origin: 50px 82px; }
.pa-svg .pa-armL,
.pa-svg .pa-armR { transform-origin: 50px 41px; }
.pa-svg .pa-legL,
.pa-svg .pa-legR { transform-origin: 50px 82px; }
.pa-svg .pa-head { transform-origin: 50px 33px; }
.pa-svg .pa-fig { transform-origin: 50px 72px; }

.pa-svg[data-kind="reach_up"] .pa-armL { animation: pa-armL-up 2.6s ease-in-out infinite; }
.pa-svg[data-kind="reach_up"] .pa-armR { animation: pa-armR-up 2.6s ease-in-out infinite; }
.pa-svg[data-kind="forward_fold"] .pa-upper { animation: pa-fold 3.2s ease-in-out infinite; }
.pa-svg[data-kind="twist"] .pa-upper { animation: pa-twist 3s ease-in-out infinite; }
.pa-svg[data-kind="lunge"] .pa-legL { animation: pa-legL-lunge 2.2s ease-in-out infinite; }
.pa-svg[data-kind="lunge"] .pa-legR { animation: pa-legR-lunge 2.2s ease-in-out infinite; }
.pa-svg[data-kind="lunge"] .pa-fig { animation: pa-bob 2.2s ease-in-out infinite; }
.pa-svg[data-kind="hold"] .pa-upper { animation: pa-breathe 3.6s ease-in-out infinite; }
.pa-svg[data-kind="side_bend"] .pa-upper { animation: pa-sidebend 3.4s ease-in-out infinite; }
.pa-svg[data-kind="cat_cow"] .pa-upper { animation: pa-catcow 2.8s ease-in-out infinite; }
.pa-svg[data-kind="neck_roll"] .pa-head { animation: pa-neck 3.6s ease-in-out infinite; }
`;

function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

export function PoseAnimation(props: {
  kind: MobilityAnimKind;
  /** Rendered height in px (width follows the 5:7 viewBox). Default 44 (table size). */
  size?: number;
  /** Line thickness; auto-scales with size when omitted. */
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const size = props.size ?? 44;
  const width = Math.round(size * (100 / 140));
  const sw = props.strokeWidth ?? Math.max(2.5, size / 14);
  ensureStyles();

  const label = useMemo(() => `${ANIM_KIND_LABELS[props.kind]} animation`, [props.kind]);

  return (
    <svg
      className={`pa-svg${props.className ? ` ${props.className}` : ""}`}
      data-kind={props.kind}
      viewBox="0 0 100 140"
      width={width}
      height={size}
      role="img"
      aria-label={label}
      style={{ display: "block", color: "var(--accent)", overflow: "visible", ...props.style }}
    >
      <g
        className="pa-fig"
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* ground line */}
        <line x1="20" y1="126" x2="80" y2="126" stroke="var(--muted)" strokeWidth={sw * 0.7} opacity={0.5} />
        {/* legs (siblings of upper so upper-body poses don't drag them) */}
        <g className="pa-legL">
          <line x1="50" y1="82" x2="38" y2="122" />
        </g>
        <g className="pa-legR">
          <line x1="50" y1="82" x2="62" y2="122" />
        </g>
        {/* upper body: head + torso + arms, pivots at the hip */}
        <g className="pa-upper">
          <line x1="50" y1="41" x2="50" y2="82" />
          <g className="pa-head">
            <circle cx="50" cy="24" r="9" fill="var(--accent-soft)" />
          </g>
          <g className="pa-armL">
            <line x1="50" y1="41" x2="34" y2="66" />
          </g>
          <g className="pa-armR">
            <line x1="50" y1="41" x2="66" y2="66" />
          </g>
        </g>
      </g>
    </svg>
  );
}
