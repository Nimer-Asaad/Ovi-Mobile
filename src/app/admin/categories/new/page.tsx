import { CategoryForm } from "../CategoryForm";

export default function NewCategoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">إضافة قسم</h2>
      <CategoryForm />
    </div>
  );
}
