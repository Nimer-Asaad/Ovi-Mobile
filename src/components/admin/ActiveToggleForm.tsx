import { Button } from "@/components/ui/Button";

export function ActiveToggleForm({
  isActive,
  action,
}: {
  isActive: boolean;
  action: () => Promise<void>;
}) {
  return (
    <form action={action}>
      <Button type="submit" variant="outline" size="sm">
        {isActive ? "إيقاف" : "تفعيل"}
      </Button>
    </form>
  );
}
