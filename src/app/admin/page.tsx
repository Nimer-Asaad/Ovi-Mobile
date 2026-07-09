import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { LOW_STOCK_THRESHOLD, ORDER_STATUSES } from "@/lib/constants";

type BadgeVariant = "gold" | "success" | "warning" | "neutral";

async function getLowStockCount(): Promise<number> {
  const activeProducts = await prisma.product.findMany({
    where: { isActive: true },
    select: { inventoryItems: { select: { quantity: true } } },
  });

  return activeProducts.filter(
    (product) =>
      product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0) < LOW_STOCK_THRESHOLD,
  ).length;
}

export default async function AdminDashboardPage() {
  const [
    totalProducts,
    activeProducts,
    categoriesCount,
    brandsCount,
    suppliersCount,
    lowStockCount,
    pendingOrdersCount,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { isActive: true } }),
    prisma.category.count(),
    prisma.brand.count(),
    prisma.supplier.count(),
    getLowStockCount(),
    prisma.order.count({ where: { status: ORDER_STATUSES.PENDING } }),
  ]);

  const statCards: { label: string; value: number; badge: { text: string; variant: BadgeVariant } }[] = [
    { label: "إجمالي المنتجات", value: totalProducts, badge: { text: "مباشر", variant: "gold" } },
    { label: "المنتجات المفعّلة", value: activeProducts, badge: { text: "مباشر", variant: "success" } },
    { label: "الأقسام", value: categoriesCount, badge: { text: "مباشر", variant: "neutral" } },
    { label: "العلامات التجارية", value: brandsCount, badge: { text: "مباشر", variant: "neutral" } },
    { label: "الموردون", value: suppliersCount, badge: { text: "مباشر", variant: "neutral" } },
    {
      label: "مخزون منخفض",
      value: lowStockCount,
      badge: lowStockCount > 0 ? { text: "تنبيه", variant: "warning" } : { text: "جيد", variant: "success" },
    },
    {
      label: "طلبات قيد الانتظار",
      value: pendingOrdersCount,
      badge:
        pendingOrdersCount > 0 ? { text: "تنبيه", variant: "warning" } : { text: "لا يوجد", variant: "neutral" },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">نظرة عامة</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">إحصائيات مباشرة من كتالوج المنتجات.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((stat) => (
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
          الأساس، المصادقة، إدارة الكتالوج، وسلة التسوق الأساسية (بدون دفع إلكتروني) مكتملة الآن.
          إدارة الطلبات من لوحة التحكم، الدفع الإلكتروني، والمخزون المتقدم ستُضاف في المراحل التالية.
        </CardContent>
      </Card>
    </div>
  );
}
