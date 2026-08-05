import { ColorForm } from "../ColorForm";

export default function NewColorPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">إضافة لون</h2>
      <ColorForm />
    </div>
  );
}
