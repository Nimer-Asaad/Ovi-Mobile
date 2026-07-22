import type { SVGProps } from "react";

export interface CategoryIconProps extends SVGProps<SVGSVGElement> {
  slug: string;
}

type IconName = "headphones" | "charger" | "cable" | "case" | "screen" | "car" | "watch" | "tablet" | "all" | "generic";

const CATEGORY_ICON_BY_SLUG: Record<string, IconName> = {
  headphones: "headphones",
  earphones: "headphones",
  chargers: "charger",
  cables: "cable",
  "phone-cases": "case",
  cases: "case",
  "screen-protectors": "screen",
  "car-accessories": "car",
  "smart-watches": "watch",
  "watch-accessories": "watch",
  "tablet-cases": "tablet",
  "all-products": "all",
};

/** Static presentation mapping only; unknown database slugs use a generic icon. */
export function CategoryIcon({ slug, ...props }: CategoryIconProps) {
  const icon = CATEGORY_ICON_BY_SLUG[slug] ?? "generic";
  const shared = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...props };

  if (icon === "headphones") return <svg {...shared}><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="7" rx="2"/><rect x="17" y="13" width="4" height="7" rx="2"/></svg>;
  if (icon === "charger") return <svg {...shared}><rect x="6" y="7" width="12" height="13" rx="3"/><path d="M9 7V3m6 4V3m-4 9-2 4h3l-1 3 4-5h-3l2-2"/></svg>;
  if (icon === "cable") return <svg {...shared}><path d="M8 4v5a4 4 0 0 0 8 0V6m-2 0h4m-3-3h2v3h-2zM6 2h4v2H6zm2 2v3"/><path d="M12 13v7"/><circle cx="12" cy="21" r="1"/></svg>;
  if (icon === "case") return <svg {...shared}><rect x="6" y="2" width="12" height="20" rx="3"/><circle cx="12" cy="18" r="1"/><rect x="9" y="5" width="3" height="3" rx="1"/></svg>;
  if (icon === "screen") return <svg {...shared}><rect x="5" y="2" width="14" height="20" rx="3"/><path d="m8 13 2.5 2.5L16 9"/></svg>;
  if (icon === "car") return <svg {...shared}><path d="m4 14 2-6h12l2 6v5H4zM7 8l2-3h6l2 3"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/><path d="M4 14h16"/></svg>;
  if (icon === "watch") return <svg {...shared}><path d="m9 5 1-3h4l1 3m-6 14 1 3h4l1-3"/><rect x="6" y="5" width="12" height="14" rx="4"/><path d="M12 9v3l2 1"/></svg>;
  if (icon === "tablet") return <svg {...shared}><rect x="4" y="2" width="16" height="20" rx="3"/><circle cx="12" cy="18.5" r=".7"/><path d="M8 5h8"/></svg>;
  if (icon === "all") return <svg {...shared}><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>;
  return <svg {...shared}><path d="M3 9 12 4l9 5-9 5z"/><path d="M5 11v6l7 3 7-3v-6M12 14v6"/></svg>;
}
