import { SupplierForm } from "../SupplierForm";

export default function NewSupplierPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">إضافة مورد</h2>
      <SupplierForm />
    </div>
  );
}
