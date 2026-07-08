import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { getPostLoginRedirect } from "@/lib/auth/redirects";
import { ROLES } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { LogoutButton } from "@/components/auth/LogoutButton";

/** Universal post-login landing spot. Non-customer roles are bounced to
 * their real area; retail customers see a placeholder here since there is
 * no dedicated customer area yet. */
export default async function DashboardPage() {
  const user = await requireUser();

  if (user.role !== ROLES.RETAIL_CUSTOMER) {
    redirect(getPostLoginRedirect(user));
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="flex-col items-center justify-center gap-1">
          <CardTitle>مرحباً، {user.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>هذه لوحة تحكم العميل — سيتم إضافة الطلبات والمفضلة في مرحلة قادمة.</p>
          <div className="mt-6 flex justify-center">
            <LogoutButton />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
