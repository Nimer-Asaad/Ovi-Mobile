"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

export interface ProductInfoTabsProps {
  description: string | null;
  sku: string;
  categoryName: string | null;
  brandName: string | null;
  inStock: boolean;
}

type TabId = "about" | "specs" | "shipping" | "reviews";

const TABS: { id: TabId; label: string }[] = [
  { id: "about", label: "عن هذا المنتج" },
  { id: "specs", label: "المواصفات" },
  { id: "shipping", label: "الشحن والاستبدال" },
  { id: "reviews", label: "التقييمات والمراجعات" },
];

/** Product detail info tabs — the only Client Component on the page, since
 * tab switching needs local state. Every value shown is a plain prop the
 * page already fetched; no data fetching happens in here. */
export function ProductInfoTabs({ description, sku, categoryName, brandName, inStock }: ProductInfoTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("about");

  return (
    <Card className="animate-fade-in p-0">
      <div className="flex overflow-x-auto border-b border-navy-soft [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "shrink-0 border-b-2 px-5 py-3 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-gold-champagne text-gold-dark"
                : "border-transparent text-neutral-bg/60 hover:text-neutral-bg",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="animate-fade-in p-6 text-sm leading-relaxed text-neutral-bg/80">
        {activeTab === "about" &&
          (description ? <p>{description}</p> : <p className="text-neutral-bg/50">لا يوجد وصف لهذا المنتج بعد.</p>)}

        {activeTab === "specs" && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex justify-between border-b border-navy-soft pb-2 sm:justify-start sm:gap-2">
              <dt className="text-neutral-bg/50">SKU</dt>
              <dd className="font-medium text-neutral-bg">{sku}</dd>
            </div>
            <div className="flex justify-between border-b border-navy-soft pb-2 sm:justify-start sm:gap-2">
              <dt className="text-neutral-bg/50">القسم</dt>
              <dd className="font-medium text-neutral-bg">{categoryName ?? "غير محدد"}</dd>
            </div>
            <div className="flex justify-between border-b border-navy-soft pb-2 sm:justify-start sm:gap-2">
              <dt className="text-neutral-bg/50">العلامة التجارية</dt>
              <dd className="font-medium text-neutral-bg">{brandName ?? "غير محدد"}</dd>
            </div>
            <div className="flex justify-between border-b border-navy-soft pb-2 sm:justify-start sm:gap-2">
              <dt className="text-neutral-bg/50">التوفر</dt>
              <dd className="font-medium text-neutral-bg">{inStock ? "متوفر" : "غير متوفر حالياً"}</dd>
            </div>
          </dl>
        )}

        {activeTab === "shipping" && (
          <p>
            نوفر خدمة التوصيل لعملائنا في مختلف المناطق، مع خيار الدفع عند الاستلام. لأي استفسار حول الاستبدال أو
            الإرجاع، يرجى التواصل مع خدمة العملاء.
          </p>
        )}

        {activeTab === "reviews" && (
          <EmptyState title="لا توجد تقييمات بعد" message="لم يقم أحد بتقييم هذا المنتج حتى الآن." />
        )}
      </div>
    </Card>
  );
}
