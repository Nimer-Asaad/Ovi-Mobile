import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { RepStockRequestStatusBadge } from "@/components/reps/RepStockRequestStatusBadge";
import { getRequestLineStateLabel, getRequestLineStateBadgeVariant } from "@/lib/rep-stock-request-labels";
import { Badge } from "@/components/ui/Badge";

interface RepStockRequestDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function RepStockRequestDetailPage({ params }: RepStockRequestDetailPageProps) {
  const { id } = await params;
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const request = rep
    ? await prisma.stockRequest.findUnique({
        where: { id },
        select: {
          id: true,
          requestNumber: true,
          salesRepId: true,
          status: true,
          repNote: true,
          adminNote: true,
          createdAt: true,
          reviewedAt: true,
          preparedAt: true,
          completedAt: true,
          rejectedAt: true,
          items: {
            select: {
              id: true,
              requestedQuantity: true,
              approvedQuantity: true,
              product: { select: { sku: true, name: true, nameAr: true } },
            },
          },
        },
      })
    : null;

  // A rep may only ever see their own requests — mismatched salesRepId
  // (including another rep's request id guessed via URL) 404s exactly like
  // a nonexistent request, so no IDOR signal leaks.
  if (!request || request.salesRepId !== rep?.id) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">{request.requestNumber ?? request.id}</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">
            أُنشئ في {new Date(request.createdAt).toLocaleDateString("ar")}
          </p>
        </div>
        <LogoutButton />
      </div>

      <div className="flex items-center gap-2">
        <RepStockRequestStatusBadge status={request.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>المنتجات المطلوبة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col divide-y divide-navy-soft">
            {request.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-bg">{item.product.nameAr ?? item.product.name}</p>
                  <p className="text-xs text-neutral-bg/50">{item.product.sku}</p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-neutral-bg/70">مطلوب: {item.requestedQuantity}</span>
                  <span className="text-neutral-bg">
                    موافق عليه: {item.approvedQuantity ?? "—"}
                  </span>
                  <Badge variant={getRequestLineStateBadgeVariant(item.requestedQuantity, item.approvedQuantity)}>
                    {getRequestLineStateLabel(item.requestedQuantity, item.approvedQuantity)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {(request.repNote || request.adminNote) && (
        <Card>
          <CardHeader>
            <CardTitle>الملاحظات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {request.repNote && (
              <div>
                <p className="text-xs text-neutral-bg/50">ملاحظتي</p>
                <p className="text-sm text-neutral-bg">{request.repNote}</p>
              </div>
            )}
            {request.adminNote && (
              <div>
                <p className="text-xs text-neutral-bg/50">ملاحظة المدير</p>
                <p className="text-sm text-neutral-bg">{request.adminNote}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Link href="/rep/requests" className="text-sm text-gold-champagne hover:underline">
        العودة إلى طلباتي
      </Link>
    </div>
  );
}
