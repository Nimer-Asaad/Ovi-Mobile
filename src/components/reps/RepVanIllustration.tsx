import { cn } from "@/lib/utils";

/** Lightweight sketch-style delivery van — pure SVG, no image assets, no 3D
 * engine. `animate-van-float` (defined in tailwind.config.ts) gives it a
 * subtle idle bob; wheels and body are static to keep the motion minimal. */
export function RepVanIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 140"
      className={cn("animate-van-float", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <ellipse cx="122" cy="120" rx="86" ry="9" fill="#000000" opacity="0.28" />

      {/* cargo box */}
      <rect x="26" y="42" width="118" height="54" rx="8" fill="#18B7D3" />
      <rect x="26" y="42" width="118" height="54" rx="8" stroke="#0F172A" strokeOpacity="0.15" strokeWidth="2" />

      {/* cargo box crate icon */}
      <g stroke="#0B4C58" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55">
        <rect x="52" y="58" width="22" height="20" rx="2" />
        <path d="M52 66h22M63 58v20" />
      </g>

      {/* cab */}
      <path
        d="M144 62 L176 62 Q186 62 192 71 L204 90 L204 96 L144 96 Z"
        fill="#0F2438"
      />
      <path
        d="M144 62 L176 62 Q186 62 192 71 L204 90 L204 96 L144 96 Z"
        stroke="#0F172A"
        strokeOpacity="0.2"
        strokeWidth="2"
      />

      {/* windshield */}
      <path d="M150 68 L174 68 Q180 68 184 74 L190 84 L152 84 Z" fill="#E2E8F0" opacity="0.9" />

      {/* headlight */}
      <circle cx="200" cy="90" r="4" fill="#F5F7FA" />

      {/* bumper line */}
      <path d="M26 96 L204 96" stroke="#0F172A" strokeOpacity="0.15" strokeWidth="2" />

      {/* wheels */}
      <g>
        <circle cx="70" cy="100" r="15" fill="#0F172A" />
        <circle cx="70" cy="100" r="6.5" fill="#E2E8F0" />
      </g>
      <g>
        <circle cx="176" cy="100" r="15" fill="#0F172A" />
        <circle cx="176" cy="100" r="6.5" fill="#E2E8F0" />
      </g>
    </svg>
  );
}
