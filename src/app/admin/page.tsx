import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

interface StatCard {
  label: string;
  value: string;
  badge: { text: string; variant: "gold" | "success" | "warning" | "neutral" };
}

/**
 * Admin dashboard skeleton. Stat cards are placeholders — real counts wire
 * up once the corresponding modules (catalog, merchants, orders) exist.
 */
const STAT_CARDS: StatCard[] = [
  { label: "إجمالي المنتجات", value: "—", badge: { text: "قريباً", variant: "neutral" } },
  { label: "طلبات انضمام التجار", value: "—", badge: { text: "قريباً", variant: "warning" } },
  { label: "المندوبون النشطون", value: "—", badge: { text: "قريباً", variant: "neutral" } },
  { label: "طلبات اليوم", value: "—", badge: { text: "قريباً", variant: "gold" } },
];

export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">نظرة عامة</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">
          هذه لوحة تحكم أولية — البيانات الحقيقية سيتم ربطها في المراحل القادمة.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARDS.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardTitle>{stat.label}</CardTitle>
              <Badge variant={stat.badge.variant}>{stat.badge.text}</Badge>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-semibold text-neutral-bg">{stat.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>خارطة الطريق</CardTitle>
        </CardHeader>
        <CardContent>
          هذا الهيكل يمثل المرحلة الأولى فقط: الأساس، التصميم، ومخطط قاعدة البيانات.
          تسجيل الدخول، إدارة المنتجات، والطلبات ستُضاف في المراحل التالية.
        </CardContent>
      </Card>
    </div>
  );
}
