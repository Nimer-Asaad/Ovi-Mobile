import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/Card";

const QUICK_ACTIONS = [
  { href: "/products", title: "المنتجات", description: "تصفح كتالوج المنتجات" },
  { href: "/cart", title: "السلة", description: "مراجعة سلة التسوق" },
  { href: "/orders", title: "طلباتي", description: "عرض سجل طلباتك" },
  { href: "/products", title: "متابعة التسوق", description: "اكتشف المزيد من المنتجات" },
] as const;

/** Customer dashboard quick-action grid — every destination is an existing
 * route, no new pages involved. */
export function CustomerQuickActions() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {QUICK_ACTIONS.map((action, index) => (
        <Link key={`${action.href}-${index}`} href={action.href}>
          <Card className="flex h-full flex-col items-center gap-1 py-6 text-center transition-all hover:-translate-y-0.5 hover:border-gold-champagne/50 hover:shadow-lg">
            <CardTitle>{action.title}</CardTitle>
            <p className="text-xs text-neutral-bg/60">{action.description}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
