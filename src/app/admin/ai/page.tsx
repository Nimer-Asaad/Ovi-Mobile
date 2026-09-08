import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/PageHeader";
import { OviAiChat } from "@/components/admin/ai/OviAiChat";

/** Ovi AI — the internal conversational assistant. ADMIN and ADMIN_ASSISTANT
 * only (server-enforced here, not just hidden from the nav — see the outer
 * /admin layout's own coarse ADMIN|ADMIN_ASSISTANT gate; this page needs no
 * narrower nested layout since both roles are meant to use it, matching
 * /admin/reports/orders' existing pattern). V1 is entirely read-only and
 * company-wide — see src/lib/ai/** for the full architecture. */
export default async function OviAiPage() {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col gap-4">
      <PageHeader title="Ovi AI" subtitle="مساعد الشركة الذكي" />
      <OviAiChat />
    </div>
  );
}
