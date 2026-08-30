import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { getRepTraderContactsForSaleForm } from "@/lib/rep-merchants";
import { getOpenCustomerOrdersForRep } from "@/lib/rep-customer-orders";
import { getRepCarSaleProducts } from "@/lib/rep-sales";
import { RepCarHero } from "@/components/reps/RepCarHero";
import { NewSaleForm } from "@/components/reps/NewSaleForm";
import { createRepSaleForRep } from "../../../actions";

interface AdminRepNewSalePageProps {
  params: Promise<{ id: string }>;
}

// ADMIN-only — recording a sale (pricing, inventory decrement, payment,
// Merchant identity) is more sensitive than loading car stock, so this
// deliberately does NOT extend to ADMIN_ASSISTANT the way assignStockToRep
// does (matches createRepSaleForRep's own requireRole in actions.ts).
export default async function AdminRepNewSalePage({ params }: AdminRepNewSalePageProps) {
  await requireRole([ROLES.ADMIN]);
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: { id: true, user: { select: { name: true } }, carStockLocation: { select: { id: true } } },
  });

  if (!rep) {
    notFound();
  }

  const locationId = rep.carStockLocation?.id ?? null;

  // Same three data sources /rep/sales/new fetches for a rep selling their
  // own car, just scoped to the target rep's id instead of the logged-in
  // session — see getRepCarSaleProducts/getRepTraderContactsForSaleForm/
  // getOpenCustomerOrdersForRep, none of which changed for this feature.
  const [options, customers, customerOrders] = await Promise.all([
    getRepCarSaleProducts(locationId),
    getRepTraderContactsForSaleForm(rep.id),
    getOpenCustomerOrdersForRep(rep.id),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <RepCarHero title="تسجيل بيع للمندوب" subtitle={`تسجيل عملية بيع من مخزون سيارة ${rep.user.name} نيابةً عنه`} />
      <NewSaleForm products={options} customers={customers} customerOrders={customerOrders} action={createRepSaleForRep.bind(null, rep.id)} />
    </div>
  );
}
