import { BrandForm } from "../BrandForm";

export default function NewBrandPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">إضافة علامة تجارية</h2>
      <BrandForm />
    </div>
  );
}
