"use client";

import { useActionState, useMemo, useState, type ChangeEvent } from "react";
import { createRepSale, type RepSaleState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { cn, formatCurrencyFromCents } from "@/lib/utils";
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";
import type { RepCustomerOrderOption } from "@/lib/rep-customer-orders";

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
  /** This rep's active (OPEN) customer-order car-load templates — see the
   * "طلبات الزبائن" panel below. Never another rep's orders (already scoped
   * server-side by getOpenCustomerOrdersForRep). */
  customerOrders: RepCustomerOrderOption[];
}

const initialState: RepSaleState = {};

function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

function lineKey(productId: string, colorId: string | null, variantId: string | null = null, deviceColorVariantId: string | null = null): string {
  if (deviceColorVariantId) return `${productId}:combo:${deviceColorVariantId}`;
  return `${productId}:${variantId ?? `legacy:${colorId ?? ""}`}`;
}

/** Resolves one customer-order line against this rep's *current* stock
 * (never the order's stale snapshot) — the order is only ever a starting
 * template (see the RepCustomerOrder schema doc comment). Returns null with
 * a human-readable note when the product/option no longer has any car stock
 * at all, and clamps (with a note) when current stock is less than the
 * originally intended quantity — either way the rep sees exactly why a line
 * came in short or missing instead of it silently vanishing. */
function buildLineFromOrderItem(
  item: RepCustomerOrderOption["items"][number],
  products: SaleProductOption[],
): { line: SaleLine | null; note: string | null } {
  const product = products.find((candidate) => candidate.id === item.productId);
  if (!product) {
    return { line: null, note: `منتج غير متوفر حالياً في سيارتك (${item.quantity} قطعة مطلوبة)` };
  }

  const variant = item.variantId ? (product.variantOptions?.find((option) => option.id === item.variantId) ?? null) : null;
  const combo = item.deviceColorVariantId ? (product.deviceColorVariantOptions?.find((option) => option.id === item.deviceColorVariantId) ?? null) : null;
  const currentStock = variant ? (variant.stock ?? 0) : combo ? (combo.stock ?? 0) : product.repStock;
  const colorLabel = combo ? `${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}` : (variant?.label ?? null);
  const displayName = `${product.nameAr ?? product.name}${colorLabel ? ` — ${colorLabel}` : ""}`;

  if (currentStock <= 0) {
    return { line: null, note: `${displayName} — غير متوفر حالياً في سيارتك` };
  }

  const quantity = Math.min(item.quantity, currentStock);
  return {
    line: {
      productId: product.id,
      colorId: null,
      variantId: item.variantId,
      deviceColorVariantId: item.deviceColorVariantId,
      colorLabel,
      sku: product.sku,
      label: product.nameAr ?? product.name,
      quantity,
      unitPrice: centsToInputValue(product.retailPriceCents),
      repStock: currentStock,
      thumbnailUrl: product.thumbnailUrl,
      thumbnailAlt: product.thumbnailAlt,
    },
    note: quantity < item.quantity ? `${displayName} — الكمية المتاحة الآن (${currentStock}) أقل من طلبية الزبون الأصلية (${item.quantity})` : null,
  };
}

/** Multi-line direct-sale form — same search/thumbnail/detail product
 * picker as the stock-request form (ProductQuickPicker), plus a customer
 * name field that suggests this rep's past customers (by phone) so repeat
 * sales don't re-register the same person under slightly different details.
 *
 * Also offers a shortcut: this rep's OPEN customer-order car-load templates
 * (right panel, "طلبات الزبائن" — see RepCustomerOrder) can be clicked to
 * prefill customer name + lines in one go. The prefill is only ever a
 * starting point — every line stays fully editable (quantity/removal/adding
 * more), and the actual submitted `items` always wins as what was really
 * sold; see buildLineFromOrderItem above for how prefill quantities are
 * revalidated against current car stock rather than trusted blindly. */
export function NewSaleForm({ products, customers, customerOrders }: NewSaleFormProps) {
  const [state, formAction, isPending] = useActionState(createRepSale, initialState);
  const [lines, setLines] = useState<SaleLine[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [customerPicked, setCustomerPicked] = useState(false);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderNotices, setOrderNotices] = useState<string[]>([]);

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

  /** Selecting a customer order REPLACES the current lines/customer name
   * with that order's template — it's a fresh starting point, not a merge
   * with whatever the rep had already been building manually (matches how
   * clicking a second, different order should behave too). Phone/city/
   * address are cleared rather than left stale, since the order itself only
   * ever carries a name — see the RepCustomerOrder doc comment. */
  function handleSelectOrder(order: RepCustomerOrderOption) {
    const notices: string[] = [];
    const nextLines: SaleLine[] = [];
    for (const item of order.items) {
      const { line, note } = buildLineFromOrderItem(item, products);
      if (line) nextLines.push(line);
      if (note) notices.push(note);
    }
    setLines(nextLines);
    setCustomerName(order.customerName);
    setCustomerPhone("");
    setCity("");
    setAddress("");
    setCustomerPicked(false);
    setSelectedOrderId(order.id);
    setOrderNotices(notices);
  }

  function handleStartBlankSale() {
    setLines([]);
    setCustomerName("");
    setCustomerPhone("");
    setCity("");
    setAddress("");
    setNotes("");
    setCustomerPicked(false);
    setSelectedOrderId(null);
    setOrderNotices([]);
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
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <form action={formAction} className="order-1 flex min-w-0 flex-1 flex-col gap-6 lg:order-2">
        <input type="hidden" name="items" value={itemsJson} />
        <input type="hidden" name="repCustomerOrderId" value={selectedOrderId ?? ""} />

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
            {orderNotices.length > 0 && (
              <div className="mb-3 flex flex-col gap-1 rounded-card border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                {orderNotices.map((notice) => (
                  <p key={notice} className="text-xs text-amber-700">{notice}</p>
                ))}
              </div>
            )}
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

      <div className="order-2 flex w-full flex-col gap-3 lg:order-1 lg:w-72 lg:shrink-0">
        <Button type="button" variant={selectedOrderId ? "outline" : "primary"} onClick={handleStartBlankSale}>
          بيع جديد فارغ
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>طلبات الزبائن</CardTitle>
          </CardHeader>
          <CardContent>
            {customerOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-bg/50">لا توجد طلبات زبائن نشطة حالياً</p>
            ) : (
              <div className="flex flex-col gap-2">
                {customerOrders.map((order) => {
                  const isSelected = selectedOrderId === order.id;
                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => handleSelectOrder(order)}
                      aria-pressed={isSelected}
                      className={cn(
                        "rounded-card border px-3 py-2 text-start transition-colors",
                        isSelected
                          ? "border-gold-champagne/60 bg-gold-champagne/10"
                          : "border-navy-soft hover:border-gold-champagne/30",
                      )}
                    >
                      <p className={cn("text-sm font-medium", isSelected ? "text-gold-champagne" : "text-neutral-bg")}>
                        {order.customerName}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-bg/50">
                        {order.itemCount} صنف — {order.totalQuantity} قطعة
                      </p>
                      <p className="text-xs text-neutral-bg/40">{new Date(order.createdAt).toLocaleDateString("ar")}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
