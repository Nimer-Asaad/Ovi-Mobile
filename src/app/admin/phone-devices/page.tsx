import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ActiveToggleForm } from "@/components/admin/ActiveToggleForm";
import { PhoneBrandForm, PhoneModelForm, PhoneBrandEditRow, PhoneModelEditRow } from "./PhoneDeviceForms";
import { togglePhoneBrand, togglePhoneModel } from "./actions";

export default async function PhoneDevicesPage() {
  const brands = await prisma.phoneBrand.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { models: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } });
  const brandOptions = brands.map(({ id, name, nameAr }) => ({ id, name, nameAr }));
  return <div className="flex flex-col gap-6">
    <PageHeader
      title="ماركات وموديلات الهواتف"
      subtitle="قائمة توافق مستقلة عن العلامة التجارية للمنتج — تُستخدم لتوافق الكفرات ولمخزون الجهاز واللون"
      actions={<Link href="/admin/colors" className="text-sm text-gold-champagne hover:underline">إدارة الألوان ←</Link>}
    />
    <div className="grid gap-5 lg:grid-cols-2"><PhoneBrandForm /><PhoneModelForm brands={brandOptions} /></div>
    <div className="space-y-4">{brands.map((brand) => <section key={brand.id} className="rounded-card border border-navy-soft bg-navy-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><h3 className="font-semibold text-neutral-bg">{brand.nameAr ?? brand.name}</h3><AdminStatusBadge isActive={brand.isActive} /></div>
        <div className="flex items-center gap-3"><PhoneBrandEditRow brand={brand} /><ActiveToggleForm isActive={brand.isActive} action={togglePhoneBrand.bind(null, brand.id)} /></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{brand.models.map((model) => <div key={model.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-navy-soft px-3 py-2">
        <span className="text-sm text-neutral-bg">{model.nameAr ?? model.name}</span>
        <div className="flex items-center gap-2"><AdminStatusBadge isActive={model.isActive} /><PhoneModelEditRow model={model} brands={brandOptions} /><ActiveToggleForm isActive={model.isActive} action={togglePhoneModel.bind(null, model.id)} /></div>
      </div>)}{brand.models.length === 0 && <p className="text-sm text-neutral-bg/50">لا توجد موديلات بعد.</p>}</div>
    </section>)}{brands.length === 0 && <p className="text-neutral-bg/60">أضف أول ماركة هاتف للبدء.</p>}</div>
  </div>;
}
