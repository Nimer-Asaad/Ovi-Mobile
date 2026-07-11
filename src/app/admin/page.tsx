import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSection } from "@/components/ui/DashboardSection";
import { formatCurrencyFromCents } from "@/lib/utils";
import { LOW_STOCK_THRESHOLD, ORDER_STATUSES, ORDER_SOURCES, MERCHANT_STATUSES } from "@/lib/constants";
import { getInventoryDashboardStats } from "@/lib/inventory";
import { getRepFleetStats } from "@/lib/reps";

type BadgeVariant = "gold" | "success" | "warning" | "neutral";

interface DashboardStat {
  label: string;
  value: string;
  badge: { text: string; variant: BadgeVariant };
}

async function getLowStockCount(): Promise<number> {
  const activeProducts = await prisma.product.findMany({
    where: { isActive: true },
    select: { inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } } },
  });

  return activeProducts.filter(
    (product) =>
      product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0) < LOW_STOCK_THRESHOLD,
  ).length;
}

export default async function AdminDashboardPage() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    totalProducts,
    activeProducts,
    categoriesCount,
    brandsCount,
    suppliersCount,
    lowStockCount,
    totalOrders,
    todayOrders,
    pendingOrders,
    inProgressOrders,
    deliveredOrders,
    inactiveOrders,
    deliveredSales,
    inventoryStats,
    repFleetStats,
    todayRepSalesCount,
    todayRepSalesAgg,
    totalRepSalesCount,
    totalRepSalesAgg,
    totalMerchants,
    pendingMerchants,
    approvedMerchants,
    rejectedMerchants,
    wholesaleOrdersCount,
    wholesaleOrdersAgg,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { isActive: true } }),
    prisma.category.count(),
    prisma.brand.count(),
    prisma.supplier.count(),
    getLowStockCount(),
    prisma.order.count(),
    prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { status: ORDER_STATUSES.PENDING } }),
    prisma.order.count({ where: { status: { in: [ORDER_STATUSES.CONFIRMED, ORDER_STATUSES.PREPARING] } } }),
    prisma.order.count({ where: { status: ORDER_STATUSES.DELIVERED } }),
    prisma.order.count({ where: { status: { in: [ORDER_STATUSES.CANCELLED, ORDER_STATUSES.RETURNED] } } }),
    prisma.order.aggregate({ where: { status: ORDER_STATUSES.DELIVERED }, _sum: { totalCents: true } }),
    getInventoryDashboardStats(),
    getRepFleetStats(),
    prisma.order.count({ where: { source: ORDER_SOURCES.REP_SALE, createdAt: { gte: startOfToday } } }),
    prisma.order.aggregate({
      where: { source: ORDER_SOURCES.REP_SALE, createdAt: { gte: startOfToday } },
      _sum: { totalCents: true },
    }),
    prisma.order.count({ where: { source: ORDER_SOURCES.REP_SALE } }),
    prisma.order.aggregate({ where: { source: ORDER_SOURCES.REP_SALE }, _sum: { totalCents: true } }),
    prisma.merchant.count(),
    prisma.merchant.count({ where: { status: MERCHANT_STATUSES.PENDING } }),
    prisma.merchant.count({ where: { status: MERCHANT_STATUSES.APPROVED } }),
    prisma.merchant.count({ where: { status: MERCHANT_STATUSES.REJECTED } }),
    prisma.order.count({ where: { source: ORDER_SOURCES.WHOLESALE } }),
    prisma.order.aggregate({ where: { source: ORDER_SOURCES.WHOLESALE }, _sum: { totalCents: true } }),
  ]);

  const catalogStats: DashboardStat[] = [
    { label: "إجمالي المنتجات", value: String(totalProducts), badge: { text: "مباشر", variant: "gold" } },
    { label: "المنتجات المفعّلة", value: String(activeProducts), badge: { text: "مباشر", variant: "success" } },
    { label: "الأقسام", value: String(categoriesCount), badge: { text: "مباشر", variant: "neutral" } },
    { label: "العلامات التجارية", value: String(brandsCount), badge: { text: "مباشر", variant: "neutral" } },
    { label: "الموردون", value: String(suppliersCount), badge: { text: "مباشر", variant: "neutral" } },
    {
      label: "مخزون منخفض",
      value: String(lowStockCount),
      badge: lowStockCount > 0 ? { text: "تنبيه", variant: "warning" } : { text: "جيد", variant: "success" },
    },
  ];

  const inventoryOverviewStats: DashboardStat[] = [
    { label: "إجمالي وحدات المخزون", value: String(inventoryStats.totalStockUnits), badge: { text: "مباشر", variant: "gold" } },
    {
      label: "منتجات بمخزون منخفض",
      value: String(inventoryStats.lowStockProducts),
      badge:
        inventoryStats.lowStockProducts > 0
          ? { text: "تنبيه", variant: "warning" }
          : { text: "جيد", variant: "success" },
    },
    {
      label: "منتجات نفدت من المخزون",
      value: String(inventoryStats.outOfStockProducts),
      badge:
        inventoryStats.outOfStockProducts > 0
          ? { text: "تنبيه", variant: "warning" }
          : { text: "جيد", variant: "success" },
    },
    {
      label: "آخر حركة مخزون",
      value: inventoryStats.latestMovementAt
        ? new Date(inventoryStats.latestMovementAt).toLocaleDateString("ar")
        : "لا يوجد",
      badge: { text: "مباشر", variant: "neutral" },
    },
  ];

  const merchantStats: DashboardStat[] = [
    { label: "إجمالي التجار", value: String(totalMerchants), badge: { text: "مباشر", variant: "gold" } },
    {
      label: "قيد المراجعة",
      value: String(pendingMerchants),
      badge: pendingMerchants > 0 ? { text: "تنبيه", variant: "warning" } : { text: "لا يوجد", variant: "neutral" },
    },
    { label: "معتمدون", value: String(approvedMerchants), badge: { text: "مباشر", variant: "success" } },
    {
      label: "مرفوضون",
      value: String(rejectedMerchants),
      badge: rejectedMerchants > 0 ? { text: "تنبيه", variant: "warning" } : { text: "لا يوجد", variant: "neutral" },
    },
    { label: "طلبات الجملة", value: String(wholesaleOrdersCount), badge: { text: "مباشر", variant: "neutral" } },
    {
      label: "إجمالي قيمة طلبات الجملة",
      value: formatCurrencyFromCents(wholesaleOrdersAgg._sum.totalCents ?? 0),
      badge: { text: "مباشر", variant: "success" },
    },
  ];

  const repStats: DashboardStat[] = [
    { label: "إجمالي المندوبين", value: String(repFleetStats.totalReps), badge: { text: "مباشر", variant: "gold" } },
    {
      label: "مندوبون لديهم مخزون",
      value: String(repFleetStats.repsWithStock),
      badge: { text: "مباشر", variant: "neutral" },
    },
    {
      label: "إجمالي الوحدات المخصصة للمندوبين",
      value: String(repFleetStats.totalUnitsAssigned),
      badge: { text: "مباشر", variant: "gold" },
    },
    {
      label: "مبيعات المندوبين اليوم",
      value: String(todayRepSalesCount),
      badge: { text: "مباشر", variant: "neutral" },
    },
    {
      label: "إجمالي مبيعات المندوبين اليوم",
      value: formatCurrencyFromCents(todayRepSalesAgg._sum.totalCents ?? 0),
      badge: { text: "مباشر", variant: "success" },
    },
    {
      label: "إجمالي عدد مبيعات المندوبين",
      value: String(totalRepSalesCount),
      badge: { text: "مباشر", variant: "neutral" },
    },
    {
      label: "إجمالي قيمة مبيعات المندوبين",
      value: formatCurrencyFromCents(totalRepSalesAgg._sum.totalCents ?? 0),
      badge: { text: "مباشر", variant: "success" },
    },
  ];

  const orderStats: DashboardStat[] = [
    { label: "إجمالي الطلبات", value: String(totalOrders), badge: { text: "مباشر", variant: "gold" } },
    { label: "طلبات اليوم", value: String(todayOrders), badge: { text: "مباشر", variant: "neutral" } },
    {
      label: "قيد الانتظار",
      value: String(pendingOrders),
      badge: pendingOrders > 0 ? { text: "تنبيه", variant: "warning" } : { text: "لا يوجد", variant: "neutral" },
    },
    { label: "مؤكد / قيد التجهيز", value: String(inProgressOrders), badge: { text: "مباشر", variant: "gold" } },
    { label: "تم التوصيل", value: String(deliveredOrders), badge: { text: "مباشر", variant: "success" } },
    {
      label: "ملغي / مرتجع",
      value: String(inactiveOrders),
      badge: inactiveOrders > 0 ? { text: "تنبيه", variant: "warning" } : { text: "لا يوجد", variant: "neutral" },
    },
    {
      label: "إجمالي المبيعات (المسلّمة)",
      value: formatCurrencyFromCents(deliveredSales._sum.totalCents ?? 0),
      badge: { text: "مسلّم فقط", variant: "success" },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h1"
        title="نظرة عامة"
        subtitle="ملخص مباشر لأداء المتجر — الكتالوج، المخزون، الطلبات، التجار والمندوبون"
      />

      <DashboardSection title="نظرة عامة على الكتالوج" subtitle="إحصائيات مباشرة من كتالوج المنتجات">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalogStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="نظرة عامة على المخزون" subtitle="إحصائيات مباشرة من مخزون المستودع الرئيسي">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {inventoryOverviewStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="نظرة عامة على الطلبات" subtitle="إحصائيات مباشرة من طلبات العملاء والتجار">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="نظرة عامة على التجار" subtitle="إحصائيات مباشرة من تجار الجملة وطلباتهم">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {merchantStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="نظرة عامة على المندوبين" subtitle="إحصائيات مباشرة من مخزون المندوبين ومبيعاتهم">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {repStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
          ))}
        </div>
      </DashboardSection>

      <Card>
        <CardHeader>
          <CardTitle>خارطة الطريق</CardTitle>
        </CardHeader>
        <CardContent>
          الأساس، المصادقة، إدارة الكتالوج، سلة التسوق، وإدارة الطلبات من لوحة التحكم مكتملة الآن.
          الدفع الإلكتروني، الفواتير، والمخزون المتقدم ستُضاف في المراحل التالية.
        </CardContent>
      </Card>
    </div>
  );
}
