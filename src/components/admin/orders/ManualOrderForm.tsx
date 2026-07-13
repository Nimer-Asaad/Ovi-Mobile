"use client";

import { useActionState, useMemo, useState } from "react";
import { createManualOrder, type ManualOrderState } from "@/app/admin/orders/new/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { formatCurrencyFromCents, cn } from "@/lib/utils";
import { MANUAL_ORDER_CUSTOMER_MODES } from "@/lib/validation/manualOrder";
import { ManualOrderProductPicker } from "./ManualOrderProductPicker";
import { ManualOrderSummary } from "./ManualOrderSummary";

export interface ManualOrderCustomerOption {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface ManualOrderMerchantOption {
  id: string;
  businessName: string;
  user: ManualOrderCustomerOption;
}

export interface ManualOrderProductOption {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  retailPriceCents: number;
  wholesalePriceCents: number;
  categoryLabel: string | null;
  brandLabel: string | null;
  stock: number;
}

interface ManualOrderLine {
  productId: string;
  sku: string;
  label: string;
  unitPriceCents: number;
  quantity: number;
  stock: number;
}

export interface ManualOrderFormProps {
  customers: ManualOrderCustomerOption[];
  merchants: ManualOrderMerchantOption[];
  products: ManualOrderProductOption[];
}

const MODE_TABS = [
  { value: MANUAL_ORDER_CUSTOMER_MODES.WALK_IN, label: "عميل مباشر" },
  { value: MANUAL_ORDER_CUSTOMER_MODES.EXISTING_CUSTOMER, label: "عميل مسجّل" },
  { value: MANUAL_ORDER_CUSTOMER_MODES.EXISTING_MERCHANT, label: "تاجر جملة معتمد" },
] as const;

const initialState: ManualOrderState = {};

export function ManualOrderForm({ customers, merchants, products }: ManualOrderFormProps) {
  const [state, formAction, isPending] = useActionState(createManualOrder, initialState);

  const [customerMode, setCustomerMode] = useState<string>(MANUAL_ORDER_CUSTOMER_MODES.WALK_IN);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedMerchantId, setSelectedMerchantId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ManualOrderLine[]>([]);
  const [discountInput, setDiscountInput] = useState("0");
  const [paidInput, setPaidInput] = useState("0");

  const priceMode = customerMode === MANUAL_ORDER_CUSTOMER_MODES.EXISTING_MERCHANT ? "wholesale" : "retail";

  function handleModeChange(mode: string) {
    setCustomerMode(mode);
    setSelectedCustomerId("");
    setSelectedMerchantId("");
    setContactName("");
    setContactPhone("");
  }

  function handleSelectCustomer(id: string) {
    setSelectedCustomerId(id);
    const customer = customers.find((c) => c.id === id);
    if (customer) {
      setContactName(customer.name);
      setContactPhone(customer.phone ?? "");
    }
  }

  function handleSelectMerchant(id: string) {
    setSelectedMerchantId(id);
    const merchant = merchants.find((m) => m.id === id);
    if (merchant) {
      setContactName(merchant.user.name);
      setContactPhone(merchant.user.phone ?? "");
    }
  }

  function handleAddProduct(product: ManualOrderProductOption) {
    const unitPriceCents = priceMode === "wholesale" ? product.wholesalePriceCents : product.retailPriceCents;
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        sku: product.sku,
        label: product.nameAr ?? product.name,
        unitPriceCents,
        quantity: 1,
        stock: product.stock,
      },
    ]);
  }

  function handleRemoveLine(productId: string) {
    setLines((prev) => prev.filter((line) => line.productId !== productId));
  }

  function handleQuantityChange(productId: string, value: string) {
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, quantity } : line)));
  }

  function handleUnitPriceChange(productId: string, value: string) {
    const unitPriceCents = Math.max(0, Math.round((Number(value) || 0) * 100));
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, unitPriceCents } : line)));
  }

  const subtotalCents = useMemo(
    () => lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0),
    [lines],
  );

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
      ),
    [lines],
  );

  return (
    <form action={formAction} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <input type="hidden" name="customerMode" value={customerMode} />
      <input type="hidden" name="items" value={itemsJson} />

      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>العميل</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {MODE_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => handleModeChange(tab.value)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                    customerMode === tab.value
                      ? "border-gold-champagne bg-gold-champagne/10 text-gold-dark"
                      : "border-navy-soft text-neutral-bg/70 hover:border-gold-champagne/50",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {customerMode === MANUAL_ORDER_CUSTOMER_MODES.EXISTING_CUSTOMER && (
              <Select
                name="customerId"
                label="اختر عميلاً"
                value={selectedCustomerId}
                onChange={(event) => handleSelectCustomer(event.target.value)}
              >
                <option value="">— اختر —</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} ({customer.email})
                  </option>
                ))}
              </Select>
            )}

            {customerMode === MANUAL_ORDER_CUSTOMER_MODES.EXISTING_MERCHANT && (
              <Select
                name="merchantId"
                label="اختر تاجراً معتمداً"
                value={selectedMerchantId}
                onChange={(event) => handleSelectMerchant(event.target.value)}
              >
                <option value="">— اختر —</option>
                {merchants.map((merchant) => (
                  <option key={merchant.id} value={merchant.id}>
                    {merchant.businessName} — {merchant.user.name}
                  </option>
                ))}
              </Select>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                name="contactName"
                label="اسم العميل"
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                required
              />
              <Input
                name="contactPhone"
                label="رقم الهاتف"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                required
              />
              <Input name="city" label="المدينة / المنطقة (اختياري)" value={city} onChange={(event) => setCity(event.target.value)} />
              <Input
                name="address"
                label="العنوان (اختياري)"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>إضافة منتجات</CardTitle>
          </CardHeader>
          <CardContent>
            <ManualOrderProductPicker
              products={products}
              priceMode={priceMode}
              addedProductIds={lines.map((line) => line.productId)}
              onAdd={handleAddProduct}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>عناصر الطلب</CardTitle>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-bg/50">لم تتم إضافة منتجات بعد</p>
            ) : (
              <div className="flex flex-col divide-y divide-navy-soft">
                {lines.map((line) => (
                  <div key={line.productId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-bg">{line.label}</p>
                      <p className="text-xs text-neutral-bg/50">{line.sku} · متوفر: {line.stock}</p>
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min={1}
                        max={line.stock}
                        value={line.quantity}
                        onChange={(event) => handleQuantityChange(line.productId, event.target.value)}
                        aria-label="الكمية"
                      />
                    </div>
                    <div className="w-28">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPriceCents / 100}
                        onChange={(event) => handleUnitPriceChange(line.productId, event.target.value)}
                        aria-label="سعر الوحدة"
                      />
                    </div>
                    <div className="w-24 text-end text-sm font-semibold text-neutral-bg">
                      {formatCurrencyFromCents(line.unitPriceCents * line.quantity)}
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveLine(line.productId)}>
                      حذف
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ملاحظات</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>ملخص الطلب والدفع</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ManualOrderSummary
              subtotalCents={subtotalCents}
              discountInput={discountInput}
              onDiscountChange={setDiscountInput}
              paidInput={paidInput}
              onPaidChange={setPaidInput}
            />
            <input type="hidden" name="discountCents" value={discountInput} />
            <input type="hidden" name="paidAmountCents" value={paidInput} />

            {state.error && (
              <p className="text-sm text-rose-600" role="alert">
                {state.error}
              </p>
            )}

            <Button type="submit" disabled={isPending || lines.length === 0} className="w-full">
              {isPending && <Spinner />}
              {isPending ? "جارٍ إنشاء الطلب..." : "إنشاء الطلب"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
