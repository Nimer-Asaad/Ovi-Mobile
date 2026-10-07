import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { loadRepDispatchNote } from "@/lib/rep-dispatch-note";
import { PrintInventorySheetButton } from "@/components/reps/PrintInventorySheetButton";
import { RepDispatchNoteView } from "@/components/reps/RepDispatchNoteView";

interface AdminRepDispatchNotePageProps {
  params: Promise<{ id: string }>;
}

/** Printable "إرسالية مخزون سيارة المندوب" for one representative — ADMIN-only,
 * the same gate as /admin/reps/[id] and its inventory-sheet (ADMIN_ASSISTANT
 * has no access to that page either, so this is not a widening). Read-only:
 * it shows the rep's CURRENT car stock (the canonical REP_CAR InventoryItem
 * rows, quantity > 0 — see loadRepDispatchNote) and writes nothing: no stock
 * change, no StockMovement, no transfer, no stored dispatch number (the
 * reference printed on the sheet is display-only). */
export default async function AdminRepDispatchNotePage({ params }: AdminRepDispatchNotePageProps) {
  await requireRole([ROLES.ADMIN]);
  const { id } = await params;

  const data = await loadRepDispatchNote(id);
  if (!data) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/reps/${id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى تفاصيل المندوب
        </Link>
        <PrintInventorySheetButton />
      </div>

      <RepDispatchNoteView data={data} />
    </div>
  );
}
