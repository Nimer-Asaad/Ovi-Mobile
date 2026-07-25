import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AccountStatementView } from "@/components/admin/accounts/AccountStatementView";
import { PrintStatementButton } from "@/components/admin/accounts/PrintStatementButton";

interface AdminAccountStatementPageProps {
  params: Promise<{ id: string }>;
}

/** Admin-only — inherited from src/app/admin/layout.tsx's requireRole
 * guard, which every route under /admin passes through. */
export default async function AdminAccountStatementPage({ params }: AdminAccountStatementPageProps) {
  const { id } = await params;

  const account = await prisma.customerAccount.findUnique({
    where: { id },
    select: {
      displayName: true,
      phone: true,
      merchant: { select: { businessName: true } },
      customer: { select: { name: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        select: { orderNumber: true, createdAt: true, status: true, totalCents: true },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        select: { id: true, amountCents: true, method: true, createdAt: true, note: true },
      },
    },
  });

  if (!account) {
    notFound();
  }

  const kindLabel = account.merchant ? "تاجر جملة" : account.customer ? "عميل مسجّل" : "عميل مباشر";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/accounts/${id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى تفاصيل الحساب
        </Link>
        <PrintStatementButton />
      </div>

      <AccountStatementView account={{ ...account, kindLabel }} />
    </div>
  );
}
