"use client";

import { useActionState, useMemo, useState, type ChangeEvent } from "react";
import { createRepSale, type RepSaleState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";

export interface SaleProductOption extends PickableProduct {
  /** Rep-car stock for a non-variant product — a phone-variant product's
   * stock lives per-model on `variantOptions[].stock` instead. Color never
   * carries stock either way. */
  repStock: number;
  retailPriceCents: number;
}

export interface SaleCustomerOption {
  name: string;
  phone: string;
  city: string | null;
  address: string | null;
}

interface SaleLine {
  productId: string;
  colorId: string | null;
  variantId: string | null;
  deviceColorVariantId: string | null;
  colorLabel: string | null;
  sku: string;
  label: string;
  quantity: number;
  /** NIS decimal string, e.g. "89.90" — converted to integer cents on submit. */
  unitPrice: string;
  repStock: number;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

interface NewSaleFormProps {
  products: SaleProductOption[];
  customers: SaleCustomerOption[];
}

const initialState: RepSaleState = {};

function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

function lineKey(productId: string, colorId: string | null, variantId: string | null = null, deviceColorVariantId: string | null = null): string {
  if (deviceColorVariantId) return `${productId}:combo:${deviceColorVariantId}`;
  return `${productId}:${variantId ?? `legacy:${colorId ?? ""}`}`;
}

/** Multi-line direct-sale form — same search/thumbnail/detail product
 * picker as the stock-request form (ProductQuickPicker), plus a customer
 * name field that suggests this rep's past customers (by phone) so repeat
 * sales don't re-register the same person under slightly different details. */
export function NewSaleForm({ products, customers }: NewSaleFormProps) {
  const [state, formAction, isPending] = useActionState(createRepSale, initialState);
  const [lines, setLines] = useState<SaleLine[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [customerPicked, setCustomerPicked] = useState(false);

  // Variant and color are independent axes now — a product stays pickable
  // until every combination of its variants × colors already has a line
  // (each defaulting to a single "none" slot when the product has no
  // options on that axis).
  const excludeIds = useMemo(() => {
    const usedKeys = new Set(lines.map((line) => lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId)));
    const ids = new Set<string>();
    for (const product of products) {
      if (product.deviceColorVariantOptions?.length) {
        const allUsed = product.deviceColorVariantOptions.every((combo) => usedKeys.has(lineKey(product.id, null, null, combo.id)));
        if (allUsed) ids.add(product.id);
        continue;
      }
      const variantIds: (string | null)[] = product.variantOptions?.length ? product.variantOptions.map((variant) => variant.id) : [null];
      const colorIds: (string | null)[] = product.colorOptions?.length ? product.colorOptions.map((color) => color.id) : [null];
      const allUsed = variantIds.every((variantId) => colorIds.every((colorId) => usedKeys.has(lineKey(product.id, colorId, variantId))));
      if (allUsed) ids.add(product.id);
    }
    return ids;
  }, [lines, products]);

  function handleAddProduct(product: SaleProductOption, colorId: string | null, variantId: string | null, deviceColorVariantId: string | null) {
    const color = product.colorOptions?.find((option) => option.id === colorId) ?? null;
    const variant = product.variantOptions?.find((option) => option.id === variantId) ?? null;
    const combo = product.deviceColorVariantOptions?.find((option) => option.id === deviceColorVariantId) ?? null;
    const colorLabel = combo
      ? `${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}`
      : [variant?.label, color ? (color.nameAr ?? color.name) : null].filter(Boolean).join(" — ") || null;
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        colorId,
        variantId,
        deviceColorVariantId,
        colorLabel,
        sku: product.sku,
        label: product.nameAr ?? product.name,
        quantity: 1,
        unitPrice: centsToInputValue(product.retailPriceCents),
        repStock: variant ? (variant.stock ?? 0) : combo ? (combo.stock ?? 0) : product.repStock,
        thumbnailUrl: product.thumbnailUrl,
        thumbnailAlt: product.thumbnailAlt,
      },
    ]);
  }

  function handleRemoveLine(productId: string, colorId: string | null, variantId: string | null, deviceColorVariantId: string | null) {
    setLines((prev) => prev.filter((line) => lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId) !== lineKey(productId, colorId, variantId, deviceColorVariantId)));
  }

  function handleQuantityChange(productId: string, colorId: string | null, variantId: string | null, deviceColorVariantId: string | null, value: string) {
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) =>
      prev.map((line) =>
        lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId) === lineKey(productId, colorId, variantId, deviceColorVariantId) ? { ...line, quantity } : line,
      ),
    );
  }

  function handlePriceChange(productId: string, colorId: string | null, variantId: string | null, deviceColorVariantId: string | null, value: string) {
    setLines((prev) =>
      prev.map((line) =>
        lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId) === lineKey(productId, colorId, variantId, deviceColorVariantId) ? { ...line, unitPrice: value } : line,
      ),
    );
  }

  function handleCustomerNameChange(event: ChangeEvent<HTMLInputElement>) {
    setCustomerName(event.target.value);
    setCustomerPicked(false);
  }

  const filteredCustomers = useMemo(() => {
    if (customerPicked) return [];
    const query = customerName.trim().toLowerCase();
    if (!query) return [];
    return customers
      .filter((customer) => customer.name.toLowerCase().includes(query) || customer.phone.includes(query))
      .slice(0, 8);
  }, [customerName, customers, customerPicked]);

  function handlePickCustomer(customer: SaleCustomerOption) {
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone);
    setCity(customer.city ?? "");
    setAddress(customer.address ?? "");
    setCustomerPicked(true);
  }

  const totalCents = lines.reduce(
    (sum, line) => sum + Math.round(Number(line.unitPrice || 0) * 100) * line.quantity,
    0,
  );

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          productId: line.productId,
          colorId: line.colorId,
          variantId: line.variantId,
          deviceColorVariantId: line.deviceColorVariantId,
          quantity: line.quantity,
          unitPriceCents: Math.round(Number(line.unitPrice || 0) * 100),
        })),
      ),
    [lines],
  );

  if (products.length === 0) {
    return <p className="text-sm text-neutral-bg/60">لا يوجد لديك مخزون متاح للبيع حالياً.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="items" value={itemsJson} />

      <Card>
        <CardHeader>
          <CardTitle>إضافة منتجات للبيع</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductQuickPicker products={products} excludeIds={excludeIds} onPick={handleAddProduct} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>المنتجات المضافة</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-bg/50">لم تتم إضافة منتجات بعد</p>
          ) : (
            <div className="flex flex-col divide-y divide-navy-soft">
              {lines.map((line) => (
                <div
                  key={lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId)}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <ProductThumb product={{ ...line, name: line.label }} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-bg">
                      {line.label}
                      {line.colorLabel && <span> — {line.colorLabel}</span>}
                    </p>
                    <p className="text-xs text-neutral-bg/50">{line.sku} — المتوفر لديك: {line.repStock}</p>
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      min={1}
                      max={line.repStock}
                      value={line.quantity}
                      onChange={(event) => handleQuantityChange(line.productId, line.colorId, line.variantId, line.deviceColorVariantId, event.target.value)}
                      aria-label="الكمية"
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={line.unitPrice}
                      onChange={(event) => handlePriceChange(line.productId, line.colorId, line.variantId, line.deviceColorVariantId, event.target.value)}
                      aria-label="سعر البيع"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveLine(line.productId, line.colorId, line.variantId, line.deviceColorVariantId)}
                  >
                    حذف
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3 text-sm font-semibold">
                <span className="text-neutral-bg">الإجمالي</span>
                <span className="text-gold-champagne">{formatCurrencyFromCents(totalCents)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>بيانات العميل</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Input
              name="customerName"
              label="اسم العميل"
              value={customerName}
              onChange={handleCustomerNameChange}
              autoComplete="off"
              required
            />
            {filteredCustomers.length > 0 && (
              <div className="mt-1 max-h-56 overflow-y-auto rounded-card border border-navy-soft">
                <div className="flex flex-col divide-y divide-navy-soft">
                  {filteredCustomers.map((customer) => (
                    <button
                      key={customer.phone}
                      type="button"
                      onClick={() => handlePickCustomer(customer)}
                      className="flex items-center justify-between px-3 py-2 text-start text-sm hover:bg-navy-deep"
                    >
                      <span className="text-neutral-bg">{customer.name}</span>
                      <span className="text-xs text-neutral-bg/50">{customer.phone}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Input
            name="customerPhone"
            label="هاتف العميل"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            required
          />
          <Input
            name="city"
            label="المدينة / المنطقة (اختياري)"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
          <Input
            name="address"
            label="العنوان (اختياري)"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <Textarea
            name="notes"
            label="ملاحظات (اختياري)"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </CardContent>
      </Card>

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending || lines.length === 0} className="w-full sm:w-auto">
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : "إتمام البيع"}
      </Button>
    </form>
  );
}
