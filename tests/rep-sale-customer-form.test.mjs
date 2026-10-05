import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

// Same load-the-real-module pattern as the other tests here — the customer
// form transitions have zero imports, so this runs the REAL code NewSaleForm
// uses (not a copy).
function load(path) {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)(() => ({}), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const form = load("src/lib/rep-sale-customer-form.ts");

const MOAZ = { id: "merchant-A", name: "معاذ بشير", phone: "0598298789", city: "نابلس", address: "شارع 1", currentBalanceCents: 12_500 };
const MOAZ_TWIN = { id: "merchant-B", name: "معاذ بشير", phone: "0599000002", city: null, address: null, currentBalanceCents: 0 };
const NO_PHONE = { id: "merchant-C", name: "زبون بلا هاتف", phone: "", city: null, address: null, currentBalanceCents: 0 };

// The server rule this form feeds (repSaleSchema: customerPhone min 7 chars).
const SERVER_MIN_PHONE = 7;
const phoneIsAcceptable = (fields) => fields.customerPhone.trim().length >= SERVER_MIN_PHONE;

test("1-6: picking an existing customer puts the phone in the canonical state, validation and the submitted fields — no edit needed", () => {
  const start = form.emptySaleCustomer();
  assert.equal(start.phone, "", "starts empty");
  const picked = form.pickSaleCustomer(MOAZ);
  assert.equal(picked.name, "معاذ بشير");
  assert.equal(picked.phone, "0598298789", "canonical phone state is the picked phone");
  assert.equal(picked.picked, true);
  assert.equal(picked.balanceCents, 12_500, "the trader's balance is resolved with the pick");
  const fields = form.saleCustomerSubmitFields(picked);
  assert.equal(fields.customerPhone, "0598298789", "the submitted phone is exactly the canonical phone");
  assert.equal(phoneIsAcceptable(fields), true, "the very same validation a typed phone goes through accepts it");
  assert.deepEqual(fields, { customerName: "معاذ بشير", customerPhone: "0598298789", city: "نابلس", address: "شارع 1" });
});

test("7: a manually typed phone goes through the same canonical state", () => {
  let state = form.emptySaleCustomer();
  state = form.editSaleCustomerName(state, "معاذ");
  state = form.editSaleCustomerField(state, "phone", "0598298789");
  assert.equal(state.phone, "0598298789");
  assert.equal(state.picked, false, "a typed customer is not a picked one");
  assert.equal(state.balanceCents, null, "no balance is invented for an unknown trader");
  assert.equal(phoneIsAcceptable(form.saleCustomerSubmitFields(state)), true);
  // typing is per-keystroke, like any other field
  state = form.editSaleCustomerField(state, "phone", "05982");
  assert.equal(form.saleCustomerSubmitFields(state).customerPhone, "05982");
  assert.equal(phoneIsAcceptable(form.saleCustomerSubmitFields(state)), false, "an incomplete number is still rejected");
});

test("8: a customer with no stored phone gets NO fabricated phone", () => {
  const picked = form.pickSaleCustomer(NO_PHONE);
  assert.equal(picked.phone, "", "nothing invented");
  assert.equal(phoneIsAcceptable(form.saleCustomerSubmitFields(picked)), false, "the rep must still enter it");
  const viaCard = form.selectGroupSaleCustomer({ merchantId: "merchant-C", customerName: "زبون بلا هاتف" }, [NO_PHONE]);
  assert.equal(viaCard.phone, "", "a card for a contact with no phone only sets the name");
  assert.equal(viaCard.name, "زبون بلا هاتف");
  assert.equal(viaCard.picked, false);
  assert.equal(form.selectGroupSaleCustomer({ merchantId: "merchant-C", customerName: "x" }, [{ ...NO_PHONE, phone: "   " }]).phone, "", "a blank phone counts as no phone");
});

test("9-10: switching customers replaces EVERY field; editing the name drops the previous customer's phone", () => {
  const a = form.pickSaleCustomer(MOAZ);
  const b = form.pickSaleCustomer(MOAZ_TWIN);
  assert.equal(b.phone, "0599000002", "customer B's phone replaces A's");
  assert.equal(b.city, "", "no stale city from A");
  assert.equal(b.address, "", "no stale address from A");
  assert.equal(b.balanceCents, 0);
  const edited = form.editSaleCustomerName(a, "عمر");
  assert.equal(edited.phone, "", "a stale phone can never ride along with a different name (wrong-merchant fix kept)");
  assert.equal(edited.city, "");
  assert.equal(edited.picked, false);
  assert.equal(edited.balanceCents, null);
  assert.equal(form.editSaleCustomerName(form.emptySaleCustomer(), "م").phone, "", "typing before any pick leaves the phone alone");
  const typedFirst = form.editSaleCustomerField(form.editSaleCustomerName(form.emptySaleCustomer(), "معاذ"), "phone", "0598298789");
  assert.equal(form.editSaleCustomerName(typedFirst, "معاذ ب").phone, "0598298789", "a hand-typed phone is not wiped by further name typing (only a PICKED customer's is)");
});

test("11: a grouped customer-orders card fills the customer by merchantId — never by name", () => {
  const contacts = [MOAZ, MOAZ_TWIN, NO_PHONE];
  const viaA = form.selectGroupSaleCustomer({ merchantId: "merchant-A", customerName: "معاذ بشير" }, contacts);
  assert.equal(viaA.phone, "0598298789");
  assert.equal(viaA.picked, true);
  assert.equal(viaA.balanceCents, 12_500, "the balance is shown for the grouped customer too");
  const viaB = form.selectGroupSaleCustomer({ merchantId: "merchant-B", customerName: "معاذ بشير" }, contacts);
  assert.equal(viaB.phone, "0599000002", "same display name, different merchant: B's own phone, not A's");
  const unlinked = form.selectGroupSaleCustomer({ merchantId: null, customerName: "معاذ بشير" }, contacts);
  assert.equal(unlinked.phone, "", "an order with no merchantId is never matched by name");
  assert.equal(unlinked.name, "معاذ بشير");
  const unknown = form.selectGroupSaleCustomer({ merchantId: "merchant-Z", customerName: "معاذ بشير" }, contacts);
  assert.equal(unknown.phone, "", "an id that is not in the rep's contacts fills nothing");
  assert.deepEqual(form.initialSaleCustomer(MOAZ), form.pickSaleCustomer(MOAZ), "the merchantId deep link starts in the same canonical state");
  assert.deepEqual(form.initialSaleCustomer(undefined), form.emptySaleCustomer());
});

test("12: NewSaleForm really uses this state — the visible phone IS the canonical phone, the grouped ids stay intact", () => {
  const source = read("src/components/reps/NewSaleForm.tsx").replace(/\r\n/g, "\n");
  assert.match(source, /useState<SaleCustomerFormState>\(\(\) => initialSaleCustomer\(initialCustomer\)\)/, "one canonical customer state");
  assert.ok(!/setCustomerPhone|setCustomerName|setCustomerPicked|setCurrentBalanceCents|useState\(initialCustomer\?\.phone/.test(source), "no secondary phone/name/picked/balance state remains");
  const phoneInput = source.slice(source.indexOf('name="customerPhone"'), source.indexOf('name="city"'));
  assert.ok(phoneInput.includes("value={customerPhone}") && phoneInput.includes('editSaleCustomerField(previous, "phone", value)'), "the visible phone input is bound to the canonical state both ways");
  assert.ok(phoneInput.includes('autoComplete="off"') && phoneInput.includes("required"), "no browser-injected value React does not hold; the required rule is kept");
  assert.ok(source.includes("setCustomer(pickSaleCustomer(contact))") && source.includes("setCustomer(selectGroupSaleCustomer(group, customers))"), "picking a contact and clicking a card both go through the canonical transitions");
  assert.ok(source.includes('name="repCustomerOrderIds"') && source.includes("setSelectedGroup({ key: group.key, orderIds: group.orderIds })"), "every grouped source order id is still submitted");
  assert.ok(source.includes("disabled={isPending || totalPieces === 0 || hasMissingPrice}"), "the submit rule is unchanged (not forced enabled)");
  for (const page of ["src/app/rep/sales/new/page.tsx", "src/app/admin/reps/[id]/sales/new/page.tsx"]) {
    assert.ok(read(page).includes("customers={customers}") && read(page).includes("getRepTraderContactsForSaleForm"), `${page} passes the id-carrying contacts`);
  }
  assert.match(read("src/lib/rep-merchants.ts"), /export interface RepTraderContact \{[\s\S]*?\bid: string;/, "contacts carry the stable Merchant.id");
});
