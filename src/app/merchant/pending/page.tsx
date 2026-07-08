import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { MERCHANT_STATUSES, ROLES } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LogoutButton } from "@/components/auth/LogoutButton";

/** Reachable by PENDING or REJECTED wholesale merchants. An APPROVED
 * merchant landing here is sent to the real dashboard instead. */
export default async function MerchantPendingPage() {
  const user = await requireRole([ROLES.WHOLESALE_MERCHANT]);

  if (user.merchantStatus === MERCHANT_STATUSES.APPROVED) {
    redirect("/merchant");
  }

  const isRejected = user.merchantStatus === MERCHANT_STATUSES.REJECTED;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <Card className="w-full max-w-md">
        <CardHeader className="flex-col items-center justify-center gap-3">
          <Badge variant={isRejected ? "danger" : "warning"}>
            {isRejected ? "مرفوض" : "قيد المراجعة"}
          </Badge>
          <CardTitle>{isRejected ? "تم رفض طلب انضمامك" : "طلبك قيد المراجعة"}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {isRejected
              ? "للأسف لم تتم الموافقة على طلب انضمامك كتاجر جملة. تواصل معنا لمزيد من التفاصيل."
              : "شكراً لتسجيلك كتاجر جملة. فريقنا يراجع طلبك حالياً وسنُعلمك فور الموافقة."}
          </p>
          <div className="mt-6 flex justify-center">
            <LogoutButton />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
