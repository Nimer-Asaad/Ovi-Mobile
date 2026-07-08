import { redirect } from "next/navigation";
import { destroySession } from "@/lib/auth/session";
import { Button } from "@/components/ui/Button";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="submit" variant="outline" size="sm">
        تسجيل الخروج
      </Button>
    </form>
  );
}
