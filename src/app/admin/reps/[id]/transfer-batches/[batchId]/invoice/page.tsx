import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { STOCK_MOVEMENT_TYPES, REP_LOAD_TYPES, ROLES } from "@/lib/constants";
import { requireRole } from "@/lib/auth/guards";
import { PrintTransferInvoiceButton } from "@/components/reps/PrintTransferInvoiceButton";
import { RepTransferInvoiceView } from "@/components/reps/RepTransferInvoiceView";

interface AdminRepTransferBatchInvoicePageProps {
  params: Promise<{ id: string; batchId: string }>;
}

/** Combined invoice for every product moved by one multi-product admin
 * quick-transfer submission (assignStockToRep/returnStockFromRep) — see
 * RepStockTransferBatch. Legacy single-movement transfers that predate
 * batching keep using the older transfers/[movementId]/invoice route.
 *
 * ADMIN_ASSISTANT may view this page — assignStockToRep (the only
 * rep-mutation it can trigger) redirects here on success, so it must be able
 * to see/print the result. Least privilege: an assistant may only view a
 * batch it created itself (batch.createdById === its own user id), not any
 * REP_ASSIGNMENT batch for the rep — otherwise it could view another
 * assistant's or an admin's assign-stock invoice just by knowing/guessing a
 * batchId. ADMIN keeps unrestricted access to any valid batch, as before.
 * The data selected below is already just the transfer's own contents
 * (items, quantities, locations, who prepared it) — nothing rep-management-
 * sensitive — so nothing needs to be hidden per role beyond that ownership
 * check; only the "back" link target changes (assistant has no access to
 * /admin/reps/[id]). */
export default async function AdminRepTransferBatchInvoicePage({ params }: AdminRepTransferBatchInvoicePageProps) {
  const user = await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  const { id, batchId } = await params;

  const batch = await prisma.repStockTransferBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      type: true,
      salesRepId: true,
      loadType: true,
      customerOrder: { select: { customerName: true } },
      note: true,
      createdAt: true,
      createdById: true,
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
  // ADMIN_ASSISTANT may only view a batch it created itself: must be the
  // REP_ASSIGNMENT type (the only kind assignStockToRep produces, blocking
  // any REP_RETURN batch even for the same rep) AND createdById must match
  // the signed-in assistant's own id (blocking another assistant's or an
  // admin's assign-stock invoice for the same rep). ADMIN is exempt from
  // both checks, same as before.
  if (user.role === ROLES.ADMIN_ASSISTANT && (batch.type !== STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT || batch.createdById !== user.id)) {
    notFound();
  }

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: { employeeCode: true, user: { select: { name: true } } },
  });

  if (!rep) {
    notFound();
  }

  const typeLabel =
    batch.type === STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT
      ? batch.loadType === REP_LOAD_TYPES.CUSTOMER_ORDER && batch.customerOrder
        ? `تخصيص مخزون لمندوب — طلبية زبون: ${batch.customerOrder.customerName}`
        : "تخصيص مخزون لمندوب — مخزون سيارة"
      : "إرجاع مخزون من مندوب";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {user.role === ROLES.ADMIN_ASSISTANT ? (
          <Link href="/admin/reps" className="text-sm text-gold-champagne hover:underline">
            العودة إلى قائمة المندوبين
          </Link>
        ) : (
          <Link href={`/admin/reps/${id}`} className="text-sm text-gold-champagne hover:underline">
            العودة إلى تفاصيل المندوب
          </Link>
        )}
        <PrintTransferInvoiceButton />
      </div>

      <RepTransferInvoiceView
        movement={{
          id: batch.id,
          createdAt: batch.createdAt,
          typeLabel,
          balanceContext: batch.type === STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT ? "car" : "warehouse",
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
