/** Pure transitions for the CUSTOMER block of the REP direct-sale form
 * (NewSaleForm). Every way the customer fields can change — picking a known
 * customer, clicking a grouped "طلبات الزبائن" card, editing a field by hand,
 * starting a blank sale — goes through exactly one of these functions and
 * produces ONE state object. The visible inputs bind to that same object
 * (value={state.phone}), so the value the rep SEES is, by construction, the
 * value React holds, the value validation reads and the value the browser
 * submits: an auto-filled phone and a typed phone are indistinguishable.
 *
 * Identity rules are unchanged: the server always resolves the trader by
 * phone, and editing the name after picking a known customer clears that
 * customer's phone/city/address (the 2026-09-22 wrong-merchant fix), so a
 * stale phone can never ride along with a different name. */

export interface SaleCustomerContact {
  /** Merchant.id when the contact is a real, known trader (used to match a
   * grouped customer-order card — never matched by name). */
  id?: string;
  name: string;
  phone: string;
  city: string | null;
  address: string | null;
  /** The trader's live balance when this list was loaded. */
  currentBalanceCents: number;
}

export interface SaleCustomerFormState {
  name: string;
  phone: string;
  city: string;
  address: string;
  /** True while the fields hold a known trader picked by the rep (or the
   * merchantId deep link) — drives the suggestion list and the stale-phone
   * protection above. */
  picked: boolean;
  /** Null until a REAL known trader is resolved — never a guessed 0. */
  balanceCents: number | null;
}

export function emptySaleCustomer(): SaleCustomerFormState {
  return { name: "", phone: "", city: "", address: "", picked: false, balanceCents: null };
}

export function pickSaleCustomer(contact: SaleCustomerContact): SaleCustomerFormState {
  return {
    name: contact.name,
    phone: contact.phone,
    city: contact.city ?? "",
    address: contact.address ?? "",
    picked: true,
    balanceCents: contact.currentBalanceCents,
  };
}

export function initialSaleCustomer(contact?: SaleCustomerContact): SaleCustomerFormState {
  return contact ? pickSaleCustomer(contact) : emptySaleCustomer();
}

/** Typing in the name field. Right after a known trader was picked, every
 * field that belonged to THAT trader is cleared together with the name. */
export function editSaleCustomerName(state: SaleCustomerFormState, name: string): SaleCustomerFormState {
  return state.picked
    ? { name, phone: "", city: "", address: "", picked: false, balanceCents: null }
    : { ...state, name, picked: false, balanceCents: null };
}

/** Typing in the phone / city / address field — the canonical value changes
 * on every keystroke exactly like any other field. */
export function editSaleCustomerField(state: SaleCustomerFormState, field: "phone" | "city" | "address", value: string): SaleCustomerFormState {
  return { ...state, [field]: value };
}

/** Clicking a grouped customer-orders card. When the card's merchantId is a
 * known contact WITH a stored phone, the contact is picked exactly as if the
 * rep had chosen it from the suggestions (name, phone, city, address and
 * balance all filled in one step). Otherwise — no merchantId, not in the
 * contact list, or no phone on file — nothing is invented: only the name is
 * set and the rep enters the phone by hand, as before. Matching is by id,
 * never by name, so two customers with the same name can never be confused. */
export function selectGroupSaleCustomer(group: { merchantId: string | null; customerName: string }, contacts: SaleCustomerContact[]): SaleCustomerFormState {
  const contact = group.merchantId ? contacts.find((candidate) => candidate.id === group.merchantId && candidate.phone.trim() !== "") : undefined;
  return contact ? pickSaleCustomer(contact) : { ...emptySaleCustomer(), name: group.customerName };
}

/** The customer fields exactly as the form submits them. */
export function saleCustomerSubmitFields(state: SaleCustomerFormState): { customerName: string; customerPhone: string; city: string; address: string } {
  return { customerName: state.name, customerPhone: state.phone, city: state.city, address: state.address };
}
