import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth/session";
import { SubmitButton } from "@/components/ui/SubmitButton";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export interface LogoutButtonProps {
  /** Override styling — e.g. for placement on the dark navy Header/AdminTopbar
   * instead of the default light-theme outline button look. */
  className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {
  return (
    <form action={logout}>
      <SubmitButton variant="outline" size="sm" pendingText="جارٍ الخروج..." className={className}>
        تسجيل الخروج
      </SubmitButton>
    </form>
  );
}
