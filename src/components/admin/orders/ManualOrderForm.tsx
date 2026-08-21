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

export interface ManualOrderWalkInAccountOption {
  id: string;
  displayName: string;
  phone: string | null;
}

export interface ManualOrderColorOption {
  id: string;
  name: string;
  nameAr: string | null;
  hexCode: string | null;
}

export interface ManualOrderVariantOption {
  id: string;
  phoneBrandId: string;
  brandLabel: string;
  phoneModelId: string;
  modelLabel: string;
  stock: number;
}

export interface ManualOrderDeviceComboOption {
  id: string;
  phoneBrandId: string;
  brandLabel: string;
  phoneModelId: string;
  modelLabel: string;
  colorId: string;
  colorLabel: string;
  colorHex: string | null;
  stock: number;
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
  /** Empty/omitted for a colorless product. Never populated for a
   * DEVICE_MODEL_COLOR product — its color lives on deviceColorVariantOptions
   * instead (see the page query). */
  colorOptions?: ManualOrderColorOption[];
  /** Active, allocation-READY variants for a PHONE_COMPATIBILITY product. */
  variantOptions?: ManualOrderVariantOption[];
  /** Active brand+model+color combinations for a DEVICE_MODEL_COLOR
   * product — mutually exclusive with variantOptions (a product uses one
   * variant system or the other, enforced by a DB CHECK constraint). */
  deviceColorVariantOptions?: ManualOrderDeviceComboOption[];
}

interface ManualOrderLine {
  productId: string;
  colorId: string | null;
  variantId: string | null;
  deviceColorVariantId: string | null;
  colorLabel: string | null;
  sku: string;
  label: string;
  unitPriceCents: number;
  quantity: number;
  stock: number;
}

function lineKey(productId: string, colorId: string | null, variantId: string | null = null, deviceColorVariantId: string | null = null): string {
  return `${productId}:${variantId ?? ""}:${deviceColorVariantId ?? ""}:${colorId ?? ""}`;
}

export interface ManualOrderFormProps {
  customers: ManualOrderCustomerOption[];
  merchants: ManualOrderMerchantOption[];
  products: ManualOrderProductOption[];
  walkInAccounts: ManualOrderWalkInAccountOption[];
  /** Pre-selection from an /admin/accounts "طلبية جديدة" link — validated
   * against the preloaded option lists below, never trusted as-is. */
  initialMode?: string;
  initialMerchantId?: string;
  initialCustomerId?: string;
  initialWalkInAccountId?: string;
}

const MODE_TABS = [
  { value: MANUAL_ORDER_CUSTOMER_MODES.WALK_IN, label: "عميل مباشر" },
  { value: MANUAL_ORDER_CUSTOMER_MODES.EXISTING_CUSTOMER, label: "عميل مسجّل" },
  { value: MANUAL_ORDER_CUSTOMER_MODES.EXISTING_MERCHANT, label: "تاجر جملة معتمد" },
] as const;

const initialState: ManualOrderState = {};

export function ManualOrderForm({
  customers,
  merchants,
  products,
  walkInAccounts,
  initialMode,
  initialMerchantId,
  initialCustomerId,
  initialWalkInAccountId,
}: ManualOrderFormProps) {
  const [state, formAction, isPending] = useActionState(createManualOrder, initialState);

  // Resolve a "طلبية جديدة" deep link against the preloaded option lists —
  // an unknown/stale id (e.g. a merchant removed since the link was made)
  // just falls back to an empty walk-in start, same as visiting this page
  // directly.
  const initialMerchant = initialMerchantId ? merchants.find((m) => m.id === initialMerchantId) : undefined;
  const initialCustomer = initialCustomerId ? customers.find((c) => c.id === initialCustomerId) : undefined;
  const initialWalkIn = initialWalkInAccountId
    ? walkInAccounts.find((a) => a.id === initialWalkInAccountId)
    : undefined;
  const resolvedInitialMode =
    initialMode && (Object.values(MANUAL_ORDER_CUSTOMER_MODES) as string[]).includes(initialMode)
      ? initialMode
      : initialMerchant
        ? MANUAL_ORDER_CUSTOMER_MODES.EXISTING_MERCHANT
        : initialCustomer
          ? MANUAL_ORDER_CUSTOMER_MODES.EXISTING_CUSTOMER
          : initialWalkIn
            ? MANUAL_ORDER_CUSTOMER_MODES.WALK_IN
            : MANUAL_ORDER_CUSTOMER_MODES.WALK_IN;

  const [customerMode, setCustomerMode] = useState<string>(resolvedInitialMode);
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialCustomer?.id ?? "");
  const [selectedMerchantId, setSelectedMerchantId] = useState(initialMerchant?.id ?? "");
  const [contactName, setContactName] = useState(
    initialMerchant?.user.name ?? initialCustomer?.name ?? initialWalkIn?.displayName ?? "",
  );
  const [contactPhone, setContactPhone] = useState(
    initialMerchant?.user.phone ?? initialCustomer?.phone ?? initialWalkIn?.phone ?? "",
  );
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ManualOrderLine[]>([]);
  const [discountInput, setDiscountInput] = useState("0");
  const [paidInput, setPaidInput] = useState("0");
  const [trackAsAccountDebt, setTrackAsAccountDebt] = useState(
    Boolean(initialWalkIn || initialCustomer),
  );
  const [walkInAccountId, setWalkInAccountId] = useState(initialWalkIn?.id ?? "");

  const priceMode = customerMode === MANUAL_ORDER_CUSTOMER_MODES.EXISTING_MERCHANT ? "wholesale" : "retail";
  const isMerchantMode = customerMode === MANUAL_ORDER_CUSTOMER_MODES.EXISTING_MERCHANT;
  const isWalkInMode = customerMode === MANUAL_ORDER_CUSTOMER_MODES.WALK_IN;
  const debtTrackingActive = isMerchantMode || trackAsAccountDebt;

  function handleModeChange(mode: string) {
    setCustomerMode(mode);
    setSelectedCustomerId("");
    setSelectedMerchantId("");
    setContactName("");
    setContactPhone("");
    setTrackAsAccountDebt(false);
    setWalkInAccountId("");
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

  const addedLineKeys = useMemo(
    () => new Set(lines.map((line) => lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId))),
    [lines],
  );

  function handleAddProduct(product: ManualOrderProductOption, colorId: string | null, variantId: string | null = null, deviceColorVariantId: string | null = null) {
    const unitPriceCents = priceMode === "wholesale" ? product.wholesalePriceCents : product.retailPriceCents;
    const color = product.colorOptions?.find((option) => option.id === colorId) ?? null;
    const variant = product.variantOptions?.find((option) => option.id === variantId) ?? null;
    const combo = product.deviceColorVariantOptions?.find((option) => option.id === deviceColorVariantId) ?? null;
    const comboLabel = combo ? `${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}` : null;
    const colorLabel = comboLabel ?? ([variant?.modelLabel, color ? (color.nameAr ?? color.name) : null].filter(Boolean).join(" — ") || null);
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
        unitPriceCents,
        quantity: 1,
        stock: combo ? combo.stock : variant ? variant.stock : product.stock,
      },
    ]);
  }

  function handleRemoveLine(productId: string, colorId: string | null, variantId: string | null, deviceColorVariantId: string | null) {
    setLines((prev) =>
      prev.filter((line) => lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId) !== lineKey(productId, colorId, variantId, deviceColorVariantId)),
    );
  }

  function handleQuantityChange(productId: string, colorId: string | null, variantId: string | null, deviceColorVariantId: string | null, value: string) {
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) =>
      prev.map((line) =>
        lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId) === lineKey(productId, colorId, variantId, deviceColorVariantId)
          ? { ...line, quantity }
          : line,
      ),
    );
  }

  function handleUnitPriceChange(productId: string, colorId: string | null, variantId: string | null, deviceColorVariantId: string | null, value: string) {
    const unitPriceCents = Math.max(0, Math.round((Number(value) || 0) * 100));
    setLines((prev) =>
      prev.map((line) =>
        lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId) === lineKey(productId, colorId, variantId, deviceColorVariantId)
          ? { ...line, unitPriceCents }
          : line,
      ),
    );
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
          colorId: line.colorId,
          variantId: line.variantId,
          deviceColorVariantId: line.deviceColorVariantId,
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
      <input type="hidden" name="trackAsAccountDebt" value={debtTrackingActive ? "on" : ""} />
      <input type="hidden" name="walkInAccountId" value={walkInAccountId} />

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

            {isMerchantMode && (
              <p className="text-xs text-neutral-bg/60">
                يُسجَّل هذا الطلب تلقائياً على حساب التاجر — كل تجار الجملة متابَعون بالدين والدفعات.
              </p>
            )}

            {(isWalkInMode || customerMode === MANUAL_ORDER_CUSTOMER_MODES.EXISTING_CUSTOMER) && (
              <div className="flex flex-col gap-3 rounded-card border border-navy-soft p-3">
                <label className="flex items-center gap-2 text-sm text-neutral-bg">
                  <input
                    type="checkbox"
                    checked={trackAsAccountDebt}
                    onChange={(event) => {
                      setTrackAsAccountDebt(event.target.checked);
                      if (!event.target.checked) setWalkInAccountId("");
                    }}
                  />
                  تسجيل هذا الطلب كدين على حساب العميل
                </label>

                {isWalkInMode && trackAsAccountDebt && (
                  <Select
                    name="_walkInAccountSelect"
                    label="حساب موجود (اختياري — اتركه فارغاً لإنشاء حساب جديد بهذا الاسم والهاتف)"
                    value={walkInAccountId}
                    onChange={(event) => setWalkInAccountId(event.target.value)}
                  >
                    <option value="">— إنشاء حساب جديد —</option>
                    {walkInAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayName} {account.phone ? `— ${account.phone}` : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}
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
              addedLineKeys={addedLineKeys}
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
                  <div
                    key={lineKey(line.productId, line.colorId, line.variantId, line.deviceColorVariantId)}
                    className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-bg">
                        {line.label}
                        {line.colorLabel && <span> — {line.colorLabel}</span>}
                      </p>
                      <p className="text-xs text-neutral-bg/50">{line.sku} · متوفر: {line.stock}</p>
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min={1}
                        max={line.stock}
                        value={line.quantity}
                        onChange={(event) => handleQuantityChange(line.productId, line.colorId, line.variantId, line.deviceColorVariantId, event.target.value)}
                        aria-label="الكمية"
                      />
                    </div>
                    <div className="w-28">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPriceCents / 100}
                        onChange={(event) => handleUnitPriceChange(line.productId, line.colorId, line.variantId, line.deviceColorVariantId, event.target.value)}
                        aria-label="سعر الوحدة"
                      />
                    </div>
                    <div className="w-24 text-end text-sm font-semibold text-neutral-bg">
                      {formatCurrencyFromCents(line.unitPriceCents * line.quantity)}
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
