import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ORDER_STATUSES, ORDER_SOURCES, PAYMENT_STATUSES } from "@/lib/constants";
import {
  getOrderStatusLabel,
  getOrderStatusBadgeVariant,
  getPaymentStatusLabel,
  getPaymentStatusBadgeVariant,
  getPaymentMethodLabel,
  getOrderSourceLabel,
} from "@/lib/order-labels";

interface AdminOrdersPageProps {
  searchParams: Promise<{
    q?: string;
    status?: string;
    paymentStatus?: string;
    customerType?: string;
  }>;
}

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const { q, status, paymentStatus, customerType } = await searchParams;
  const trimmedQuery = q?.trim();

  // Show all orders by default — every filter below is additive (only
  // narrows results when the admin explicitly picks one), so no order
  // source is ever hidden unless asked for.
  const orders = await prisma.order.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(customerType ? { source: customerType } : {}),
      ...(trimmedQuery
        ? {
            OR: [
              { orderNumber: { contains: trimmedQuery } },
              { contactName: { contains: trimmedQuery } },
              { contactPhone: { contains: trimmedQuery } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      source: true,
      totalCents: true,
      contactName: true,
      contactPhone: true,
      city: true,
      createdAt: true,
      merchant: { select: { businessName: true } },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">الطلبات</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">إدارة طلبات العملاء والتجار</p>
      </div>

      <form
        method="GET"
        className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="lg:col-span-2">
          <Input name="q" label="بحث برقم الطلب أو الاسم أو الهاتف" defaultValue={trimmedQuery ?? ""} />
        </div>

        <Select name="status" label="حالة الطلب" defaultValue={status ?? ""}>
          <option value="">كل الحالات</option>
          {Object.values(ORDER_STATUSES).map((value) => (
            <option key={value} value={value}>
              {getOrderStatusLabel(value)}
            </option>
          ))}
        </Select>

        <Select name="paymentStatus" label="حالة الدفع" defaultValue={paymentStatus ?? ""}>
          <option value="">كل حالات الدفع</option>
          {Object.values(PAYMENT_STATUSES).map((value) => (
            <option key={value} value={value}>
              {getPaymentStatusLabel(value)}
            </option>
          ))}
        </Select>

        <Select name="customerType" label="نوع العميل" defaultValue={customerType ?? ""}>
          <option value="">الكل</option>
          <option value={ORDER_SOURCES.RETAIL}>عملاء التجزئة</option>
          <option value={ORDER_SOURCES.WHOLESALE}>تجار الجملة</option>
        </Select>

        <div className="flex items-end lg:col-span-5">
          <Button type="submit">تصفية</Button>
        </div>
      </form>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">رقم الطلب</th>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">النوع</th>
          <th className="px-4 py-3 text-start">الهاتف</th>
          <th className="px-4 py-3 text-start">المدينة</th>
          <th className="px-4 py-3 text-start">الإجمالي</th>
          <th className="px-4 py-3 text-start">حالة الطلب</th>
          <th className="px-4 py-3 text-start">الدفع</th>
          <th className="px-4 py-3 text-start">طريقة الدفع</th>
          <th className="px-4 py-3 text-start">التاريخ</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {orders.map((order) => (
            <tr key={order.orderNumber}>
              <td className="px-4 py-3 text-neutral-bg/70">{order.orderNumber}</td>
              <td className="px-4 py-3 text-neutral-bg">
                {order.contactName ?? order.merchant?.businessName ?? "—"}
              </td>
              <td className="px-4 py-3">
                <Badge variant={order.source === ORDER_SOURCES.WHOLESALE ? "gold" : "neutral"}>
                  {getOrderSourceLabel(order.source)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">{order.contactPhone ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{order.city ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{formatCurrencyFromCents(order.totalCents)}</td>
              <td className="px-4 py-3">
                <Badge variant={getOrderStatusBadgeVariant(order.status)}>
                  {getOrderStatusLabel(order.status)}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge variant={getPaymentStatusBadgeVariant(order.paymentStatus)}>
                  {getPaymentStatusLabel(order.paymentStatus)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">{getPaymentMethodLabel(order.paymentMethod)}</td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {new Date(order.createdAt).toLocaleDateString("ar")}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/orders/${order.orderNumber}`}
                  className="text-sm text-gold-champagne hover:underline"
                >
                  التفاصيل
                </Link>
              </td>
            </tr>
          ))}
          {orders.length === 0 && <AdminEmptyRow colSpan={11} message="لا توجد طلبات مطابقة" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
