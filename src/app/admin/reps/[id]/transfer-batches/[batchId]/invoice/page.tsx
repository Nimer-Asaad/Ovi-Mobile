import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { PrintTransferInvoiceButton } from "@/components/reps/PrintTransferInvoiceButton";
import { RepTransferInvoiceView } from "@/components/reps/RepTransferInvoiceView";

interface AdminRepTransferBatchInvoicePageProps {
  params: Promise<{ id: string; batchId: string }>;
}

/** Combined invoice for every product moved by one multi-product admin
 * quick-transfer submission (assignStockToRep/returnStockFromRep) — see
 * RepStockTransferBatch. Legacy single-movement transfers that predate
 * batching keep using the older transfers/[movementId]/invoice route. */
export default async function AdminRepTransferBatchInvoicePage({ params }: AdminRepTransferBatchInvoicePageProps) {
  const { id, batchId } = await params;

  const batch = await prisma.repStockTransferBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      type: true,
      salesRepId: true,
      note: true,
      createdAt: true,
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      createdBy: { select: { name: true } },
      stockMovements: {
        orderBy: { createdAt: "asc" },
        select: {
          quantity: true,
          previousQuantity: true,
          newQuantity: true,
          product: { select: { sku: true, name: true, nameAr: true } },
          variant: { select: { phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
          deviceColorVariant: { select: { phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } }, color: { select: { name: true, nameAr: true } } } },
        },
      },
    },
  });

  // Read-only lookup — a batch invoice may only be viewed for this exact
  // rep, so one rep's URL can never leak another rep's transfer.
  if (!batch || batch.salesRepId !== id) {
    notFound();
  }

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: { employeeCode: true, user: { select: { name: true } } },
  });

  if (!rep) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/reps/${id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى تفاصيل المندوب
        </Link>
        <PrintTransferInvoiceButton />
      </div>

      <RepTransferInvoiceView
        movement={{
          id: batch.id,
          createdAt: batch.createdAt,
          typeLabel: batch.type === STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT ? "تخصيص مخزون لمندوب" : "إرجاع مخزون من مندوب",
          note: batch.note,
          items: batch.stockMovements.map((movement) => ({
            product: movement.product,
            optionLabel: movement.variant
              ? `${movement.variant.phoneModel.phoneBrand.nameAr ?? movement.variant.phoneModel.phoneBrand.name} / ${movement.variant.phoneModel.nameAr ?? movement.variant.phoneModel.name}`
              : movement.deviceColorVariant
                ? `${movement.deviceColorVariant.phoneModel.phoneBrand.nameAr ?? movement.deviceColorVariant.phoneModel.phoneBrand.name} / ${movement.deviceColorVariant.phoneModel.nameAr ?? movement.deviceColorVariant.phoneModel.name} / ${movement.deviceColorVariant.color.nameAr ?? movement.deviceColorVariant.color.name}`
                : null,
            quantity: movement.quantity,
            previousQuantity: movement.previousQuantity,
            newQuantity: movement.newQuantity,
          })),
          fromLocationName: batch.fromLocation.name,
          toLocationName: batch.toLocation.name,
          repName: rep.user.name,
          repEmployeeCode: rep.employeeCode,
          preparedByName: batch.createdBy?.name ?? null,
        }}
      />
    </div>
  );
}
