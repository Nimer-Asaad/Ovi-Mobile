import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { SalesReturnForm } from "@/components/reps/SalesReturnForm";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";
import { describeOrderItem, getOrderReturnSummary } from "@/lib/sales-returns";

interface RepSaleReturnPageProps {
  params: Promise<{ orderNumber: string }>;
}

export const dynamic = "force-dynamic";

/** مردود مبيعات — a rep's own return entry for one of THEIR invoices.
 * Ownership is enforced server-side exactly like the invoice page
 * (Order.createdByRepId === effective rep id, else 404); createSalesReturn
 * re-checks it again inside its own transaction. */
export default async function RepSaleReturnPage({ params }: RepSaleReturnPageProps) {
  const effectiveRep = await requireEffectiveRepresentative();
  const { orderNumber } = await params;

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdByRepId: true,
      accountId: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          productNameSnapshot: true,
          colorNameSnapshot: true,
          phoneBrandSnapshot: true,
          phoneModelSnapshot: true,
          product: { select: { name: true, nameAr: true } },
        },
      },
    },
  });
  if (!order || order.createdByRepId !== effectiveRep.repId) notFound();

  const summary = await getOrderReturnSummary(order.id);
  const blocked = isTerminalOrderStatus(order.status) ? "هذه الفاتورة ملغاة أو مرتجعة بالكامل ولا يمكن تسجيل مردود عليها." : !order.accountId ? "هذه الفاتورة غير مرتبطة بحساب تاجر." : summary.remainingUnits <= 0 ? "تم إرجاع كل كميات هذه الفاتورة." : null;

  const lines = order.items.map((item) => {
    const line = summary.lines.get(item.id)!;
    return {
      orderItemId: item.id,
      label: describeOrderItem(item),
      quantity: line.quantity,
      bonusQuantity: line.bonusQuantity,
      returnedQuantity: line.returnedQuantity,
      remainingQuantity: line.remainingQuantity,
      returnedBonusQuantity: line.returnedBonusQuantity,
      remainingBonusQuantity: line.remainingBonusQuantity,
    };
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="مردود مبيعات"
        subtitle={`الفاتورة ${order.orderNumber}`}
        actions={
          <Link href={`/rep/sales/${order.orderNumber}`} className="text-sm text-gold-champagne hover:underline">
            العودة إلى الفاتورة
          </Link>
        }
      />
      <Card>
        <CardContent>
          {blocked ? <p className="py-4 text-sm text-neutral-bg/70">{blocked}</p> : <SalesReturnForm orderNumber={order.orderNumber} lines={lines} />}
        </CardContent>
      </Card>
    </div>
  );
}
