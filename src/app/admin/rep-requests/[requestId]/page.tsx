import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { getMainWarehouse } from "@/lib/inventory";
import { STOCK_REQUEST_STATUSES } from "@/lib/constants";
import { RepStockRequestStatusBadge } from "@/components/reps/RepStockRequestStatusBadge";
import { RepStockRequestReviewForm } from "@/components/reps/RepStockRequestReviewForm";
import { RepStockRequestActionButtons } from "@/components/reps/RepStockRequestActionButtons";
import { getRequestLineStateLabel, getRequestLineStateBadgeVariant } from "@/lib/rep-stock-request-labels";

interface AdminRepRequestDetailPageProps {
  params: Promise<{ requestId: string }>;
}

export default async function AdminRepRequestDetailPage({ params }: AdminRepRequestDetailPageProps) {
  const { requestId } = await params;

  // `request` and `warehouse` don't depend on each other — fetch both in
  // parallel instead of two sequential round-trips.
  const [request, warehouse] = await Promise.all([
    prisma.stockRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        repNote: true,
        adminNote: true,
        createdAt: true,
        reviewedAt: true,
        preparedAt: true,
        completedAt: true,
        rejectedAt: true,
        salesRep: { select: { id: true, user: { select: { name: true, email: true } } } },
        items: {
          select: {
            id: true,
            requestedQuantity: true,
            approvedQuantity: true,
            product: { select: { id: true, sku: true, name: true, nameAr: true } },
          },
        },
      },
    }),
    getMainWarehouse(),
  ]);

  if (!request) {
    notFound();
  }

  const productIds = request.items.map((item) => item.product.id);

  const [warehouseItems, repLocation] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { productId: { in: productIds }, locationId: warehouse.id },
      select: { productId: true, quantity: true },
    }),
    prisma.stockLocation.findUnique({ where: { salesRepId: request.salesRep.id } }),
  ]);
  const warehouseQtyByProduct = new Map(warehouseItems.map((item) => [item.productId, item.quantity]));

  const repItems = repLocation
    ? await prisma.inventoryItem.findMany({
        where: { productId: { in: productIds }, locationId: repLocation.id },
        select: { productId: true, quantity: true },
      })
    : [];
  const repQtyByProduct = new Map(repItems.map((item) => [item.productId, item.quantity]));

  const isEditable =
    request.status === STOCK_REQUEST_STATUSES.PENDING || request.status === STOCK_REQUEST_STATUSES.REVIEWED;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={request.requestNumber ?? request.id}
        subtitle={`المندوب: ${request.salesRep.user.name}`}
        actions={
          <>
            <RepStockRequestStatusBadge status={request.status} />
            <Link href={`/admin/rep-requests/${request.id}/print`}>
              <Button variant="outline">طباعة إذن التجهيز</Button>
            </Link>
          </>
        }
      />

      {isEditable ? (
        <Card>
          <CardHeader>
            <CardTitle>مراجعة الطلب</CardTitle>
          </CardHeader>
          <CardContent>
            <RepStockRequestReviewForm
              requestId={request.id}
              initialAdminNote={request.adminNote ?? ""}
              items={request.items.map((item) => ({
                itemId: item.id,
                productLabel: item.product.nameAr ?? item.product.name,
                sku: item.product.sku,
                requestedQuantity: item.requestedQuantity,
                approvedQuantity: item.approvedQuantity,
                warehouseAvailable: warehouseQtyByProduct.get(item.product.id) ?? 0,
                carQuantity: repQtyByProduct.get(item.product.id) ?? 0,
              }))}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>عناصر الطلب</CardTitle>
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
                    <span className="text-neutral-bg">موافق عليه: {item.approvedQuantity ?? "—"}</span>
                    <Badge variant={getRequestLineStateBadgeVariant(item.requestedQuantity, item.approvedQuantity)}>
                      {getRequestLineStateLabel(item.requestedQuantity, item.approvedQuantity)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <RepStockRequestActionButtons requestId={request.id} status={request.status} />

      {(request.repNote || request.adminNote) && (
        <Card>
          <CardHeader>
            <CardTitle>الملاحظات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {request.repNote && (
              <div>
                <p className="text-xs text-neutral-bg/50">ملاحظة المندوب</p>
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

      <Card>
        <CardHeader>
          <CardTitle>التسلسل الزمني</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-bg/50">تاريخ الإنشاء</dt>
              <dd className="text-neutral-bg">{new Date(request.createdAt).toLocaleString("ar")}</dd>
            </div>
            {request.reviewedAt && (
              <div>
                <dt className="text-neutral-bg/50">تاريخ المراجعة</dt>
                <dd className="text-neutral-bg">{new Date(request.reviewedAt).toLocaleString("ar")}</dd>
              </div>
            )}
            {request.preparedAt && (
              <div>
                <dt className="text-neutral-bg/50">تاريخ التجهيز</dt>
                <dd className="text-neutral-bg">{new Date(request.preparedAt).toLocaleString("ar")}</dd>
              </div>
            )}
            {request.completedAt && (
              <div>
                <dt className="text-neutral-bg/50">تاريخ الاستلام</dt>
                <dd className="text-neutral-bg">{new Date(request.completedAt).toLocaleString("ar")}</dd>
              </div>
            )}
            {request.rejectedAt && (
              <div>
                <dt className="text-neutral-bg/50">تاريخ الرفض</dt>
                <dd className="text-neutral-bg">{new Date(request.rejectedAt).toLocaleString("ar")}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
