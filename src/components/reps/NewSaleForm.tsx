"use client";

import { useActionState, useMemo, useState, type ChangeEvent } from "react";
import { createRepSale, type RepSaleState } from "@/app/rep/sales/actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { cn, formatCurrencyFromCents } from "@/lib/utils";
import {
  ProductSalePicker,
  buildSaleProductGroups,
  buildSaleSubmitLines,
  summarizeSaleProducts,
  type SaleProductOption,
} from "@/components/reps/ProductSalePicker";
import type { RepCustomerOrderOption } from "@/lib/rep-customer-orders";

export type { SaleProductOption } from "@/components/reps/ProductSalePicker";

export interface SaleCustomerOption {
  name: string;
  phone: string;
  city: string | null;
  address: string | null;
}

interface NewSaleFormProps {
  products: SaleProductOption[];
  customers: SaleCustomerOption[];
  /** This rep's active (OPEN) customer-order car-load templates — see the
   * "طلبات الزبائن" panel below. Never another rep's orders (already scoped
   * server-side by getOpenCustomerOrdersForRep). */
  customerOrders: RepCustomerOrderOption[];
  /** Server action this form submits to — defaults to createRepSale (the
   * rep's own /rep/sales/new flow, requireRole SALES_REPRESENTATIVE,
   * resolves the rep from the logged-in session). The admin "سجل بيعاً
   * للمندوب" page (/admin/reps/[id]/sales/new) instead passes
   * createRepSaleForRep bound to the target repId — both actions parse the
   * same repSaleSchema and run the exact same core transaction
   * (createRepSaleCore in src/lib/rep-sales.ts), so this one form and its
   * product/customer/order data are the only thing either surface needs;
   * nothing here is duplicated. */
  action?: (state: RepSaleState, formData: FormData) => Promise<RepSaleState>;
  /** Preloads the customer fields as already "picked" — used by the "بيع
   * جديد" deep link from a merchant's own page (/rep/merchants/[id]?...),
   * which passes this rep's own already-assigned merchant so the rep never
   * re-types a trader they're already looking at. Purely a starting point,
   * same as selecting a customer order or a suggested contact — every field
   * stays fully editable, and createRepSale still always resolves the real
   * trader identity itself by phone (see resolveOrCreateRepMerchant), never
   * by trusting this prefill. */
  initialCustomer?: SaleCustomerOption;
}

const initialState: RepSaleState = {};

/** Multi-line direct-sale form — a flat, searchable PRODUCT list (see
 * ProductSalePicker.tsx: "OVI 04", "OVI 63", ... — the actual Product rows),
 * plus a customer name field that suggests this rep's past customers (by
 * phone) so repeat sales don't re-register the same person under slightly
 * different details.
 *
 * A rep sale is always "Product + quantity + price" now — no phone-model
 * selection at all (see the SaleProductOption doc comment: REP_CAR only
 * ever tracks one plain aggregate balance per product; the warehouse side
 * is the only place phone models still matter). PRICE is entered ONCE per
 * PRODUCT, directly on its own card, applied to that whole quantity.
 *
 * Also offers a shortcut: this rep's OPEN customer-order car-load templates
 * (right panel, "طلبات الزبائن" — see RepCustomerOrder) can be clicked to
 * prefill customer name + quantities in one go. The prefill is only ever a
 * starting point — every quantity stays fully editable, and the actual
 * submitted `items` always wins as what was really sold; see
 * handleSelectOrder below for how prefill quantities are revalidated
 * against current car stock rather than trusted blindly. Product prices are
 * NEVER prefilled from a customer order (it never carried one) — the rep
 * still types each product's price once after preloading. */
export function NewSaleForm({ products, customers, customerOrders, action = createRepSale, initialCustomer }: NewSaleFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  const groups = useMemo(() => buildSaleProductGroups(products), [products]);

  // quantities/productPrices are the entire "what's selected, at what
  // price" state — both keyed by SaleProductGroup.key (productId). Nothing
  // else needs to track selection: building the submit payload is a pure
  // read of `groups` + these two maps (see buildSaleSubmitLines).
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [productPrices, setProductPrices] = useState<Record<string, string>>({});

  const [customerName, setCustomerName] = useState(initialCustomer?.name ?? "");
  const [customerPhone, setCustomerPhone] = useState(initialCustomer?.phone ?? "");
  const [city, setCity] = useState(initialCustomer?.city ?? "");
  const [address, setAddress] = useState(initialCustomer?.address ?? "");
  const [notes, setNotes] = useState("");
  const [customerPicked, setCustomerPicked] = useState(Boolean(initialCustomer));

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderNotices, setOrderNotices] = useState<string[]>([]);

  function handleQuantityChange(productKey: string, quantity: number) {
    setQuantities((prev) => ({ ...prev, [productKey]: quantity }));
  }

  function handleProductPriceChange(productKey: string, value: string) {
    setProductPrices((prev) => ({ ...prev, [productKey]: value }));
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

  /** Selecting a customer order REPLACES the current selection/customer name
   * with that order's template — it's a fresh starting point, not a merge
   * with whatever the rep had already been building manually (matches how
   * clicking a second, different order should behave too). Phone/city/
   * address are cleared rather than left stale, since the order itself only
   * ever carries a name — see the RepCustomerOrder doc comment.
   *
   * The order's own lines are still stored per phone model (that's the
   * WAREHOUSE-side breakdown the admin picked when loading the car — see
   * RepCustomerOrderItem's doc comment), but a sale no longer sells by
   * model, so every line for the SAME product is summed here into that
   * product's one aggregate requested quantity before clamping against
   * current rep-car stock — a product no longer in the car at all is
   * silently dropped with a notice instead of crashing or submitting a
   * phantom line. Product prices are left untouched: the order never
   * carried one, so the rep still types it. */
  function handleSelectOrder(order: RepCustomerOrderOption) {
    const requestedByProduct = new Map<string, number>();
    for (const item of order.items) {
      requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + item.quantity);
    }

    const notices: string[] = [];
    const nextQuantities: Record<string, number> = {};
    for (const [productId, requestedQuantity] of requestedByProduct) {
      const group = groups.find((candidate) => candidate.key === productId);
      if (!group) {
        notices.push(`منتج غير متوفر حالياً في سيارتك (${requestedQuantity} قطعة مطلوبة)`);
        continue;
      }
      if (group.stock <= 0) {
        notices.push(`${group.label} — غير متوفر حالياً في سيارتك`);
        continue;
      }
      const quantity = Math.min(requestedQuantity, group.stock);
      nextQuantities[productId] = quantity;
      if (quantity < requestedQuantity) {
        notices.push(`${group.label} — الكمية المتاحة الآن (${group.stock}) أقل من طلبية الزبون الأصلية (${requestedQuantity})`);
      }
    }
    setQuantities(nextQuantities);
    setCustomerName(order.customerName);
    setCustomerPhone("");
    setCity("");
    setAddress("");
    setCustomerPicked(false);
    setSelectedOrderId(order.id);
    setOrderNotices(notices);
  }

  function handleStartBlankSale() {
    setQuantities({});
    setProductPrices({});
    setCustomerName("");
    setCustomerPhone("");
    setCity("");
    setAddress("");
    setNotes("");
    setCustomerPicked(false);
    setSelectedOrderId(null);
    setOrderNotices([]);
  }

  const productSummaries = useMemo(() => summarizeSaleProducts(groups, quantities, productPrices), [groups, quantities, productPrices]);
  const totalPieces = productSummaries.reduce((sum, product) => sum + product.pieceCount, 0);
  const totalCents = productSummaries.reduce((sum, product) => sum + product.subtotalCents, 0);
  const hasMissingPrice = productSummaries.some((product) => product.priceMissing);

  const itemsJson = useMemo(() => JSON.stringify(buildSaleSubmitLines(groups, quantities, productPrices)), [groups, quantities, productPrices]);

  if (groups.length === 0) {
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
            {orderNotices.length > 0 && (
              <div className="mb-3 flex flex-col gap-1 rounded-card border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                {orderNotices.map((notice) => (
                  <p key={notice} className="text-xs text-amber-700">{notice}</p>
                ))}
              </div>
            )}
            <ProductSalePicker
              groups={groups}
              quantities={quantities}
              onQuantityChange={handleQuantityChange}
              productPrices={productPrices}
              onProductPriceChange={handleProductPriceChange}
            />
          </CardContent>
        </Card>

        {productSummaries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>ملخص الفاتورة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col divide-y divide-navy-soft">
                {productSummaries.map((product) => (
                  <div key={product.productKey} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                    <span className="text-neutral-bg">{product.productLabel}</span>
                    <span className="text-neutral-bg/70">
                      {product.pieceCount} × {formatCurrencyFromCents(product.unitPriceCents)} = {formatCurrencyFromCents(product.subtotalCents)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-3 text-sm font-semibold">
                  <span className="text-neutral-bg">إجمالي القطع: {totalPieces}</span>
                  <span className="text-gold-champagne">إجمالي الفاتورة: {formatCurrencyFromCents(totalCents)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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

        <Button type="submit" disabled={isPending || totalPieces === 0 || hasMissingPrice} className="w-full sm:w-auto">
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
