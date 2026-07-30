import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { RepStockRequestStatusBadge } from "@/components/reps/RepStockRequestStatusBadge";

export default async function RepStockRequestsPage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const requests = rep
    ? await prisma.stockRequest.findMany({
        where: { salesRepId: rep.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          requestNumber: true,
          status: true,
          createdAt: true,
          items: { select: { requestedQuantity: true, approvedQuantity: true } },
        },
      })
    : [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="طلباتي"
        subtitle="طلبات تزويد مخزون السيارة التي أرسلتها"
        actions={
          <Link href="/rep/requests/new">
            <Button>طلب تزويد جديد</Button>
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>الطلبات</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-bg/50">لا توجد طلبات بعد</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {requests.map((request) => {
                const totalRequested = request.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
                return (
                  <Link
                    key={request.id}
                    href={`/rep/requests/${request.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:opacity-80"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-bg">{request.requestNumber ?? request.id}</p>
                      <p className="text-xs text-neutral-bg/50">
                        {new Date(request.createdAt).toLocaleDateString("ar")} — {request.items.length} منتج، إجمالي{" "}
                        {totalRequested} قطعة
                      </p>
                    </div>
                    <RepStockRequestStatusBadge status={request.status} />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
