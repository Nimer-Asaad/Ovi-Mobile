import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props} />
  );
}

const TRUST_ITEMS = [
  {
    label: "توصيل سريع",
    icon: (props: SVGProps<SVGSVGElement>) => (
      <Icon {...props}>
        <rect x="1" y="7" width="14" height="10" rx="1.5" />
        <path d="M15 10h3.5l3.5 3.5V17h-7z" />
        <circle cx="6" cy="19" r="1.6" />
        <circle cx="17.5" cy="19" r="1.6" />
      </Icon>
    ),
  },
  {
    label: "أسعار الجملة للتجار",
    icon: (props: SVGProps<SVGSVGElement>) => (
      <Icon {...props}>
        <path d="M3 12 12 3l9 9-9 9-9-9Z" />
        <circle cx="9" cy="9" r="1.4" />
        <path d="m8 16 8-8" />
      </Icon>
    ),
  },
  {
    label: "منتجات أصلية",
    icon: (props: SVGProps<SVGSVGElement>) => (
      <Icon {...props}>
        <path d="M12 2 4 5v6c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </Icon>
    ),
  },
  {
    label: "دعم ومتابعة",
    icon: (props: SVGProps<SVGSVGElement>) => (
      <Icon {...props}>
        <path d="M4 13a8 8 0 0 1 16 0" />
        <rect x="2.5" y="13" width="4" height="6" rx="1.5" />
        <rect x="17.5" y="13" width="4" height="6" rx="1.5" />
        <path d="M19.5 19v.5a3 3 0 0 1-3 3H12" />
      </Icon>
    ),
  },
  {
    label: "مخزون محدث",
    icon: (props: SVGProps<SVGSVGElement>) => (
      <Icon {...props}>
        <path d="M3 7 12 3l9 4-9 4-9-4Z" />
        <path d="M3 7v10l9 4 9-4V7" />
        <path d="M12 11v10" />
      </Icon>
    ),
  },
] as const;

/** Static trust/service strip — no data dependency, purely presentational. */
export function TrustStrip() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {TRUST_ITEMS.map((item) => (
        <div
          key={item.label}
          className="flex flex-col items-center gap-2 rounded-card border border-navy-soft bg-navy-surface px-3 py-6 text-center shadow-card"
        >
          <item.icon className="h-7 w-7 text-gold-champagne" />
          <span className="text-sm font-medium text-neutral-bg/80">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
