import { SubmitButton } from "@/components/ui/SubmitButton";

export function ActiveToggleForm({
  isActive,
  action,
}: {
  isActive: boolean;
  action: () => Promise<void>;
}) {
  return (
    <form action={action}>
      <SubmitButton variant="outline" size="sm">
        {isActive ? "إيقاف" : "تفعيل"}
      </SubmitButton>
    </form>
  );
}
