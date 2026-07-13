import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { PrintTransferInvoiceButton } from "@/components/reps/PrintTransferInvoiceButton";
import { RepTransferInvoiceView } from "@/components/reps/RepTransferInvoiceView";

interface AdminRepTransferInvoicePageProps {
  params: Promise<{ id: string; movementId: string }>;
}

export default async function AdminRepTransferInvoicePage({ params }: AdminRepTransferInvoicePageProps) {
  const { id, movementId } = await params;

  const movement = await prisma.stockMovement.findUnique({
    where: { id: movementId },
    select: {
      id: true,
      type: true,
      quantity: true,
      previousQuantity: true,
      newQuantity: true,
      note: true,
      createdAt: true,
      product: { select: { sku: true, name: true, nameAr: true } },
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true, salesRepId: true } },
      createdBy: { select: { name: true } },
    },
  });

  // Read-only lookup — a transfer invoice may only be viewed for a
  // REP_ASSIGNMENT movement whose destination is this exact rep's car
  // location, so one rep's URL can never leak another rep's transfer.
  if (!movement || movement.type !== STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT || movement.toLocation?.salesRepId !== id) {
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
          id: movement.id,
          createdAt: movement.createdAt,
          quantity: movement.quantity,
          previousQuantity: movement.previousQuantity,
          newQuantity: movement.newQuantity,
          note: movement.note,
          product: movement.product,
          fromLocationName: movement.fromLocation?.name ?? null,
          toLocationName: movement.toLocation?.name ?? null,
          repName: rep.user.name,
          repEmployeeCode: rep.employeeCode,
          preparedByName: movement.createdBy?.name ?? null,
        }}
      />
    </div>
  );
}
