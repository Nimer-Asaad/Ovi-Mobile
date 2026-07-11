import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardSection } from "@/components/ui/DashboardSection";
import { ChartCard } from "@/components/admin/dashboard/ChartCard";
import { DashboardLineChart } from "@/components/admin/dashboard/DashboardLineChart";
import { DashboardBarChart } from "@/components/admin/dashboard/DashboardBarChart";
import { DashboardDonutChart } from "@/components/admin/dashboard/DashboardDonutChart";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ORDER_STATUSES, ORDER_SOURCES, MERCHANT_STATUSES } from "@/lib/constants";
import { getInventoryDashboardStats } from "@/lib/inventory";
import { getRepFleetStats } from "@/lib/reps";
import {
  getOrdersSalesTrend,
  getOrdersByStatusBreakdown,
  getTopStockProducts,
  getMerchantStatusBreakdown,
  getRepSalesByRep,
} from "@/lib/admin-dashboard";
import type { BadgeVariant } from "@/components/ui/Badge";

interface DashboardStat {
  label: string;
  value: string;
  badge: { text: string; variant: BadgeVariant };
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
    totalOrders,
    todayOrders,
    pendingOrders,
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
    ordersSalesTrend,
    ordersByStatus,
    topStockProducts,
    merchantStatusBreakdown,
    repSalesByRep,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { isActive: true } }),
    prisma.category.count(),
    prisma.brand.count(),
    prisma.supplier.count(),
    prisma.order.count(),
    prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { status: ORDER_STATUSES.PENDING } }),
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
    getOrdersSalesTrend(),
    getOrdersByStatusBreakdown(),
    getTopStockProducts(6),
    getMerchantStatusBreakdown(),
    getRepSalesByRep(8),
  ]);

  const summaryStats: DashboardStat[] = [
    { label: "إجمالي المنتجات", value: String(totalProducts), badge: { text: "مباشر", variant: "gold" } },
    { label: "إجمالي الطلبات", value: String(totalOrders), badge: { text: "مباشر", variant: "gold" } },
    {
      label: "طلبات قيد الانتظار",
      value: String(pendingOrders),
      badge: pendingOrders > 0 ? { text: "تنبيه", variant: "warning" } : { text: "لا يوجد", variant: "neutral" },
    },
    { label: "إجمالي وحدات المخزون", value: String(inventoryStats.totalStockUnits), badge: { text: "مباشر", variant: "gold" } },
    { label: "إجمالي التجار", value: String(totalMerchants), badge: { text: "مباشر", variant: "neutral" } },
    { label: "إجمالي المندوبين", value: String(repFleetStats.totalReps), badge: { text: "مباشر", variant: "neutral" } },
  ];

  const catalogStats: DashboardStat[] = [
    { label: "المنتجات المفعّلة", value: String(activeProducts), badge: { text: "مباشر", variant: "success" } },
    { label: "الأقسام", value: String(categoriesCount), badge: { text: "مباشر", variant: "neutral" } },
    { label: "العلامات التجارية", value: String(brandsCount), badge: { text: "مباشر", variant: "neutral" } },
    { label: "الموردون", value: String(suppliersCount), badge: { text: "مباشر", variant: "neutral" } },
    {
      label: "مخزون منخفض",
      value: String(inventoryStats.lowStockProducts),
      badge: inventoryStats.lowStockProducts > 0 ? { text: "تنبيه", variant: "warning" } : { text: "جيد", variant: "success" },
    },
  ];

  const inventoryOverviewStats: DashboardStat[] = [
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

  const merchantExtraStats: DashboardStat[] = [
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
    {
      label: "إجمالي قيمة طلبات الجملة",
      value: formatCurrencyFromCents(wholesaleOrdersAgg._sum.totalCents ?? 0),
      badge: { text: `${wholesaleOrdersCount} طلب`, variant: "gold" },
    },
  ];

  const repExtraStats: DashboardStat[] = [
    { label: "مندوبون لديهم مخزون", value: String(repFleetStats.repsWithStock), badge: { text: "مباشر", variant: "neutral" } },
    {
      label: "إجمالي الوحدات المخصصة للمندوبين",
      value: String(repFleetStats.totalUnitsAssigned),
      badge: { text: "مباشر", variant: "gold" },
    },
    {
      label: "إجمالي مبيعات المندوبين اليوم",
      value: formatCurrencyFromCents(todayRepSalesAgg._sum.totalCents ?? 0),
      badge: { text: `${todayRepSalesCount} عملية`, variant: "success" },
    },
    {
      label: "إجمالي قيمة مبيعات المندوبين",
      value: formatCurrencyFromCents(totalRepSalesAgg._sum.totalCents ?? 0),
      badge: { text: `${totalRepSalesCount} عملية`, variant: "neutral" },
    },
  ];

  const isTrendEmpty = ordersSalesTrend.every((day) => day.orders === 0);
  const isSalesTrendEmpty = ordersSalesTrend.every((day) => day.salesCents === 0);
  const isOrdersByStatusEmpty = ordersByStatus.every((slice) => slice.value === 0);
  const isMerchantStatusEmpty = merchantStatusBreakdown.every((slice) => slice.value === 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h1"
        title="نظرة عامة"
        subtitle="ملخص مباشر لأداء المتجر — الكتالوج، المخزون، الطلبات، التجار والمندوبون"
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {summaryStats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
        ))}
      </div>

      <DashboardSection title="نظرة عامة على الكتالوج" subtitle="إحصائيات مباشرة من كتالوج المنتجات">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalogStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="تحليلات المبيعات والطلبات" subtitle="اتجاه الطلبات والمبيعات خلال آخر 7 أيام">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="الطلبات خلال آخر 7 أيام" isEmpty={isTrendEmpty} emptyMessage="لا توجد طلبات في آخر 7 أيام">
            <DashboardLineChart data={ordersSalesTrend} xKey="label" yKey="orders" color="#18B7D3" />
          </ChartCard>
          <ChartCard title="المبيعات خلال آخر 7 أيام" isEmpty={isSalesTrendEmpty} emptyMessage="لا توجد مبيعات في آخر 7 أيام">
            <DashboardBarChart data={ordersSalesTrend} xKey="label" yKey="salesCents" color="#0F96AE" valueFormat="currency" />
          </ChartCard>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ChartCard title="الطلبات حسب الحالة" isEmpty={isOrdersByStatusEmpty} emptyMessage="لا توجد طلبات بعد">
            <DashboardDonutChart data={ordersByStatus} />
          </ChartCard>
          <StatCard label="طلبات اليوم" value={String(todayOrders)} badge={{ text: "مباشر", variant: "gold" }} />
          <StatCard
            label="إجمالي المبيعات (المسلّمة)"
            value={formatCurrencyFromCents(deliveredSales._sum.totalCents ?? 0)}
            badge={{ text: "مسلّم فقط", variant: "success" }}
          />
        </div>
      </DashboardSection>

      <DashboardSection title="تحليلات المخزون" subtitle="إحصائيات مباشرة من مخزون المستودع الرئيسي">
        <ChartCard
          title="الأكثر مخزوناً"
          subtitle="أعلى المنتجات كمية في المستودع الرئيسي"
          isEmpty={topStockProducts.length === 0}
          emptyMessage="لا يوجد مخزون في المستودع الرئيسي بعد"
        >
          <DashboardBarChart data={topStockProducts} xKey="label" yKey="value" color="#18B7D3" horizontal />
        </ChartCard>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {inventoryOverviewStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="تحليلات التجار" subtitle="إحصائيات مباشرة من تجار الجملة وطلباتهم">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="التجار حسب الحالة" isEmpty={isMerchantStatusEmpty} emptyMessage="لا يوجد تجار بعد">
            <DashboardDonutChart data={merchantStatusBreakdown} />
          </ChartCard>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {merchantExtraStats.map((stat) => (
              <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
            ))}
          </div>
        </div>
      </DashboardSection>

      <DashboardSection title="تحليلات المندوبين" subtitle="إحصائيات مباشرة من مخزون المندوبين ومبيعاتهم">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {repExtraStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} badge={stat.badge} />
          ))}
        </div>

        <div className="mt-4">
          <ChartCard
            title="مبيعات المندوبين"
            subtitle="إجمالي قيمة المبيعات المباشرة لكل مندوب"
            isEmpty={repSalesByRep.length === 0}
            emptyMessage="لا توجد مبيعات مندوبين مسجلة بعد"
          >
            <DashboardBarChart data={repSalesByRep} xKey="label" yKey="value" color="#0F96AE" horizontal valueFormat="currency" />
          </ChartCard>
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
