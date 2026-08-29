"use client";

import { useActionState, useMemo, useState, type ChangeEvent } from "react";
import { assignStockToRep, type RepStockTransferState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ProductThumb, ProductQuickPicker, type PickableProduct } from "@/components/reps/ProductQuickPicker";
import { REP_LOAD_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { RepTraderContact } from "@/lib/rep-merchants";

export interface AssignStockProductOption extends PickableProduct {
  /** Non-variant warehouse stock — a phone-variant or device-color-combo
   * product's stock lives per-option on variantOptions[].stock /
   * deviceColorVariantOptions[].stock instead. */
  warehouseStock: number;
}

interface AssignStockFormProps {
  repId: string;
  products: AssignStockProductOption[];
  /** This rep's known traders (real merchants + login-less ones already
   * quick-added from a past sale/customer-order) — same source NewSaleForm
   * uses (getRepTraderContactsForSaleForm). Picking one here carries its
   * stable merchantId straight through to submission (see handlePickTrader)
   * instead of re-resolving identity by phone text — the admin can still
   * type an unlisted name+phone freely for a brand-new trader, which the
   * server then resolves/creates via the same shared helper. */
  traderContacts: RepTraderContact[];
}

interface TransferLine {
  productId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  label: string;
  optionLabel: string | null;
  sku: string;
  quantity: number;
  maxStock: number;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

const initialState: RepStockTransferState = {};

function lineKey(productId: string, variantId: string | null, deviceColorVariantId: string | null): string {
  return `${productId}:${variantId ?? ""}:${deviceColorVariantId ?? ""}`;
}

/** Multi-line transfer form (warehouse → rep car) — reuses the same
 * search/thumbnail/detail product picker as the rep-facing forms. Every
 * product added in one submission becomes one RepStockTransferBatch with
 * one StockMovement per line, printable as a single combined invoice. No
 * customer/order context, so callers never populate colorOptions here (see
 * repStockTransferBatchSchema for the same reasoning) — only variantId /
 * deviceColorVariantId.
 *
 * loadType=CUSTOMER_ORDER additionally requires a resolvable Merchant
 * identity — either an existing trader picked from traderContacts (stable
 * merchantId, submitted directly) or a name+phone the server can
 * resolve/create one from (see assignStockToRep) — enforced client-side via
 * hasMerchantIdentity purely so the submit button reflects it early; the
 * server never trusts this and re-validates independently. loadType=
 * CAR_STOCK never touches any of this — no merchant/customer identity is
 * required or read for a plain warehouse-to-car transfer. */
export function AssignStockForm({ repId, products, traderContacts }: AssignStockFormProps) {
  const action = assignStockToRep.bind(null, repId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [loadType, setLoadType] = useState<string>(REP_LOAD_TYPES.CAR_STOCK);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerPicked, setCustomerPicked] = useState(false);
  // The stable identity this submission will carry — set ONLY by picking an
  // existing trader below, cleared the moment the admin edits the name or
  // phone (typing after a pick means "this isn't that trader anymore", so
  // the server must fall back to resolving/creating by name+phone instead
  // of silently keeping a now-stale merchantId — see requirement J). Never
  // set from typed text alone; only handlePickTrader ever sets it.
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null);
  const isCustomerOrder = loadType === REP_LOAD_TYPES.CUSTOMER_ORDER;
  // A CUSTOMER_ORDER must resolve to a real Merchant identity one way or
  // another — either an existing trader was picked (selectedMerchantId), or
  // there's a phone long enough for the server to resolve/create one (same
  // floor createRepSale enforces on its own required customerPhone). Mirrors
  // assignStockToRep's own server-side rule exactly, just client-side so the
  // submit button reflects it before the round trip.
  const hasMerchantIdentity = Boolean(selectedMerchantId) || customerPhone.trim().length >= 7;

  function handleCustomerNameChange(event: ChangeEvent<HTMLInputElement>) {
    setCustomerName(event.target.value);
    setCustomerPicked(false);
    setSelectedMerchantId(null);
  }

  function handleCustomerPhoneChange(event: ChangeEvent<HTMLInputElement>) {
    setCustomerPhone(event.target.value);
    setSelectedMerchantId(null);
  }

  const filteredTraders = useMemo(() => {
    if (customerPicked) return [];
    const query = customerName.trim().toLowerCase();
    if (!query) return [];
    return traderContacts.filter((trader) => trader.name.toLowerCase().includes(query) || trader.phone.includes(query)).slice(0, 8);
  }, [customerName, traderContacts, customerPicked]);

  function handlePickTrader(trader: RepTraderContact) {
    setCustomerName(trader.name);
    setCustomerPhone(trader.phone);
    setCustomerPicked(true);
    setSelectedMerchantId(trader.id);
  }

  const excludeIds = useMemo(() => {
    const usedKeys = new Set(lines.map((line) => lineKey(line.productId, line.variantId, line.deviceColorVariantId)));
    const ids = new Set<string>();
    for (const product of products) {
      if (product.deviceColorVariantOptions?.length) {
        const allUsed = product.deviceColorVariantOptions.every((combo) => usedKeys.has(lineKey(product.id, null, combo.id)));
        if (allUsed) ids.add(product.id);
        continue;
      }
      const variantIds: (string | null)[] = product.variantOptions?.length ? product.variantOptions.map((variant) => variant.id) : [null];
      const allUsed = variantIds.every((variantId) => usedKeys.has(lineKey(product.id, variantId, null)));
      if (allUsed) ids.add(product.id);
    }
    return ids;
  }, [lines, products]);

  function handleAddProduct(product: AssignStockProductOption, _colorId: string | null, variantId: string | null, deviceColorVariantId: string | null) {
    const variant = product.variantOptions?.find((option) => option.id === variantId) ?? null;
    const combo = product.deviceColorVariantOptions?.find((option) => option.id === deviceColorVariantId) ?? null;
    const key = lineKey(product.id, variantId, deviceColorVariantId);

    setLines((prev) => {
      // The picker's detail modal never disables an option just because
      // it's already in this list (only out-of-stock options are disabled),
      // so re-picking the exact same product+variant+combo is always
      // possible — merge into the existing line instead of adding a second
      // one with the same exact target, which the server would otherwise
      // have to reject outright.
      const alreadyExists = prev.some((line) => lineKey(line.productId, line.variantId, line.deviceColorVariantId) === key);
      if (alreadyExists) {
        return prev.map((line) => (lineKey(line.productId, line.variantId, line.deviceColorVariantId) === key ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [
        ...prev,
        {
          productId: product.id,
          variantId,
          deviceColorVariantId,
          label: product.nameAr ?? product.name,
          optionLabel: variant?.label ?? (combo ? `${combo.brandLabel} / ${combo.modelLabel} / ${combo.colorLabel}` : null),
          sku: product.sku,
          quantity: 1,
          maxStock: variant ? (variant.stock ?? 0) : combo ? (combo.stock ?? 0) : product.warehouseStock,
          thumbnailUrl: product.thumbnailUrl,
          thumbnailAlt: product.thumbnailAlt,
        },
      ];
    });
  }

  function handleRemoveLine(productId: string, variantId: string | null, deviceColorVariantId: string | null) {
    setLines((prev) => prev.filter((line) => lineKey(line.productId, line.variantId, line.deviceColorVariantId) !== lineKey(productId, variantId, deviceColorVariantId)));
  }

  function handleQuantityChange(productId: string, variantId: string | null, deviceColorVariantId: string | null, value: string) {
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) =>
      prev.map((line) =>
        lineKey(line.productId, line.variantId, line.deviceColorVariantId) === lineKey(productId, variantId, deviceColorVariantId) ? { ...line, quantity } : line,
      ),
    );
  }

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          deviceColorVariantId: line.deviceColorVariantId,
          quantity: line.quantity,
        })),
      ),
    [lines],
  );

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="loadType" value={loadType} />
      {isCustomerOrder && <input type="hidden" name="customerName" value={customerName} />}
      {isCustomerOrder && <input type="hidden" name="customerPhone" value={customerPhone} />}
      {isCustomerOrder && selectedMerchantId && <input type="hidden" name="merchantId" value={selectedMerchantId} />}

      <div>
        <p className="mb-1.5 text-sm font-medium text-neutral-bg/80">نوع التحميل</p>
        <div role="radiogroup" aria-label="نوع التحميل" className="flex gap-2">
          {[
            { value: REP_LOAD_TYPES.CAR_STOCK, label: "مخزون سيارة" },
            { value: REP_LOAD_TYPES.CUSTOMER_ORDER, label: "طلبية زبون" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={loadType === option.value}
              onClick={() => setLoadType(option.value)}
              className={cn(
                "flex-1 rounded-card border px-4 py-2 text-sm transition-colors",
                loadType === option.value
                  ? "border-gold-champagne/60 bg-gold-champagne/10 text-gold-champagne"
                  : "border-navy-soft text-neutral-bg/70 hover:border-gold-champagne/30",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isCustomerOrder && (
        <div>
          <Input
            label="اسم الزبون"
            value={customerName}
            onChange={handleCustomerNameChange}
            placeholder="مثال: أحمد محمد"
            autoComplete="off"
            required
          />
          {filteredTraders.length > 0 && (
            <div className="mt-1 max-h-56 overflow-y-auto rounded-card border border-navy-soft">
              <div className="flex flex-col divide-y divide-navy-soft">
                {filteredTraders.map((trader) => (
                  <button
                    key={trader.id}
                    type="button"
                    onClick={() => handlePickTrader(trader)}
                    className="flex items-center justify-between px-3 py-2 text-start text-sm hover:bg-navy-deep"
                  >
                    <span className="text-neutral-bg">{trader.name}</span>
                    <span className="text-xs text-neutral-bg/50">{trader.phone}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isCustomerOrder && (
        <div>
          <Input
            label={selectedMerchantId ? "هاتف الزبون" : "هاتف الزبون (مطلوب إن لم تختر تاجراً من القائمة)"}
            value={customerPhone}
            onChange={handleCustomerPhoneChange}
            placeholder="مثال: 0599999999"
          />
          {selectedMerchantId ? (
            <p className="mt-1 text-xs text-emerald-500">✓ سيتم ربط الطلبية بالتاجر: {customerName}</p>
          ) : (
            <p className="mt-1 text-xs text-neutral-bg/50">لم يتم اختيار تاجر من القائمة — سيتم إنشاء/استخدام تاجر بحسب رقم الهاتف أعلاه.</p>
          )}
        </div>
      )}

      <ProductQuickPicker products={products} excludeIds={excludeIds} onPick={handleAddProduct} placeholder="ابحث عن منتج لتخصيصه..." />

      {lines.length > 0 && (
        <div className="flex flex-col divide-y divide-navy-soft rounded-card border border-navy-soft bg-navy-deep px-3">
          {lines.map((line) => (
            <div key={lineKey(line.productId, line.variantId, line.deviceColorVariantId)} className="flex flex-wrap items-center gap-3 py-3 first:pt-3 last:pb-3">
              <ProductThumb product={{ ...line, name: line.label }} className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-bg">
                  {line.label}
                  {line.optionLabel && <span> — {line.optionLabel}</span>}
                </p>
                <p className="text-xs text-neutral-bg/50">{line.sku} — المتوفر: {line.maxStock}</p>
              </div>
              <div className="w-20">
                <Input
                  type="number"
                  min={1}
                  max={line.maxStock}
                  value={line.quantity}
                  onChange={(event) => handleQuantityChange(line.productId, line.variantId, line.deviceColorVariantId, event.target.value)}
                  aria-label="الكمية"
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveLine(line.productId, line.variantId, line.deviceColorVariantId)}>
                حذف
              </Button>
            </div>
          ))}
        </div>
      )}

      <Textarea name="notes" label="ملاحظات / السبب (اختياري)" rows={3} />

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        disabled={isPending || lines.length === 0 || (isCustomerOrder && (customerName.trim().length < 2 || !hasMerchantIdentity))}
      >
        {isPending && <Spinner />}
        {isPending ? "جارٍ الحفظ..." : `تخصيص المخزون${lines.length > 0 ? ` (${lines.length})` : ""}`}
      </Button>
    </form>
  );
}
