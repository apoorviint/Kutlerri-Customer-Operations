import { describe, expect, it } from "vitest";
import { contactsFromRow, detectColumns, findHeader, phonesIn, summarizeContacts } from "../src/rules/prospects.js";
import { cellDate, cellMoney, parseBillingSheet, totalMismatch } from "../src/rules/billingSheet.js";

describe("prospect database columns", () => {
  it("finds First/Last Name, Title, Company and every phone or mobile column except HQ", () => {
    const c = detectColumns(["First Name", "Last Name", "Title", "Company", "Mobile Phone", "Work Direct Phone", "HQ Phone", "Corporate Phone (HQ)", "Email"])!;
    expect(c).toMatchObject({ first: 0, last: 1, title: 2, company: 3 });
    expect(c.phones).toEqual([4, 5]);
  });
  it("accepts a single Name column and other spellings", () => {
    const c = detectColumns(["Name", "Job Title", "Company Name", "Cell Mobile"])!;
    expect(c).toMatchObject({ name: 0, title: 1, company: 2, phones: [3] });
  });
  it("is not a database without a name or without a phone column", () => {
    expect(detectColumns(["Title", "Company", "Phone"])).toBeNull();
    expect(detectColumns(["First Name", "Last Name", "Company"])).toBeNull();
    expect(detectColumns(["First Name", "HQ Phone"])).toBeNull();
  });
  it("skips a title line above the header", () => {
    const h = findHeader([["Export of Rasa leads"], [], ["Name", "Phone"], ["Jo", "5551112222"]])!;
    expect(h.index).toBe(2);
  });
});

describe("phone numbers in a cell", () => {
  it("keeps ten digits, drops a leading 1 and an extension, and splits several numbers", () => {
    expect(phonesIn("(555) 111-2222")).toEqual(["5551112222"]);
    expect(phonesIn("+1 555 111 2222")).toEqual(["5551112222"]);
    expect(phonesIn("555-111-2222 ext 44")).toEqual(["5551112222"]);
    expect(phonesIn("555-111-2222; 555-333-4444")).toEqual(["5551112222", "5553334444"]);
    expect(phonesIn(5551112222)).toEqual(["5551112222"]);
  });
  it("ignores blanks and numbers that are too short", () => {
    expect(phonesIn("")).toEqual([]);
    expect(phonesIn(null)).toEqual([]);
    expect(phonesIn("12345")).toEqual([]);
  });
  it("one row gives one contact per number", () => {
    const c = detectColumns(["First Name", "Last Name", "Title", "Company", "Mobile", "Direct Phone"])!;
    const out = contactsFromRow(["Jane", "Doe", "Manager", "Acme", "5551112222", "5553334444"], c);
    expect(out.map((x) => x.phoneNo10)).toEqual(["5551112222", "5553334444"]);
    expect(out[0]).toMatchObject({ name: "Jane Doe", title: "Manager", company: "Acme" });
  });
});

describe("who a phone number belongs to", () => {
  it("one distinct person (same name and company) gives their details, even when listed twice", () => {
    expect(summarizeContacts([{ name: "Jane Doe", title: "", company: "Acme" }, { name: "jane  doe", title: "Manager", company: "ACME" }]))
      .toEqual({ kind: "one", name: "Jane Doe", company: "Acme", title: "Manager", candidates: null });
  });
  it("several people sharing a company: Multiple contacts, the company, and the candidates", () => {
    const m = summarizeContacts([{ name: "A", title: "Chef", company: "Acme" }, { name: "B", title: "", company: "Acme" }])!;
    expect(m).toMatchObject({ kind: "multiple", name: "Multiple contacts", company: "Acme", candidates: "A (Chef), B" });
  });
  it("several companies: Multiple companies; more than six candidates end with +N more", () => {
    const list = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, title: "T", company: `Co${i}` }));
    const m = summarizeContacts(list)!;
    expect(m.company).toBe("Multiple companies");
    expect(m.candidates).toBe("P0 (T), P1 (T), P2 (T), P3 (T), P4 (T), P5 (T), +3 more");
  });
  it("nobody means no match", () => expect(summarizeContacts([])).toBeNull());
});

describe("billing sheet", () => {
  const head = ["Invoice no", "Client", "Representative", "Created date", "Order date", "Account", "Subtotal", "Tax", "Tip", "Fee", "Discount", "Total"];
  it("reads orders, dates and money in common spellings", () => {
    const p = parseBillingSheet([head, ["A1", "Rasa", "Nia", "10/10/2026", new Date("2026-10-18T00:00:00Z"), "Acme", "$500.00", "40", "50", "10", "0", "$600.00"]]);
    expect(p.errors).toEqual([]);
    expect(p.rows[0]).toMatchObject({ invoiceNo: "A1", createdDate: "2026-10-10", orderDate: "2026-10-18", subtotal: 500, total: 600 });
  });
  it("reports unusable rows with their row number and keeps reading", () => {
    const p = parseBillingSheet([head, ["", "Rasa", "Nia", "", "2026-10-18", "", "", "", "", "", "", "100"], ["A2", "Rasa", "Nia", "", "not a date", "", "", "", "", "", "", "100"], ["A3", "Rasa", "Nia", "", "2026-10-18", "", "", "", "", "", "", "abc"], ["A4", "Rasa", "Nia", "", "2026-10-18", "", "", "", "", "", "", "100"], ["A4", "Rasa", "Nia", "", "2026-10-18", "", "", "", "", "", "", "100"]]);
    expect(p.errors).toHaveLength(4);
    expect(p.errors[0]).toMatch(/Row 2/);
    expect(p.errors.some((e) => /appears in row 5/.test(e))).toBe(true);
    expect(p.rows.map((r) => r.invoiceNo)).toEqual(["A4"]);
  });
  it("explains a missing header", () => expect(parseBillingSheet([["a", "b", "c"], [1, 2, 3]]).errors[0]).toMatch(/header row/));
  it("flags a total that is not subtotal + tax + tip + fee - discount", () => {
    expect(totalMismatch({ subtotal: 500, tax: 40, tip: 50, fee: 10, discount: 0, total: 600 })).toBeNull();
    expect(totalMismatch({ subtotal: 500, tax: 40, tip: 50, fee: 10, discount: 25, total: 600 })).toBe(25);
    expect(totalMismatch({ subtotal: null, tax: null, tip: null, fee: null, discount: null, total: 600 })).toBeNull();
    expect(totalMismatch({ subtotal: 100, tax: null, tip: null, fee: null, discount: null, total: 120 })).toBeNull(); // no breakdown given: nothing to compare
    expect(totalMismatch({ subtotal: 100, tax: 8, tip: null, fee: null, discount: null, total: 120 })).toBe(12);
    expect(totalMismatch({ subtotal: 100, tax: null, tip: null, fee: null, discount: null, total: 100.005 })).toBeNull(); // a cent of rounding
  });
  it("dates and money cells", () => {
    expect(cellDate(46313)).toBe("2026-10-18");
    expect(cellDate("2026-02-30")).toBeNull();
    expect(cellMoney("(12.50)")).toBe(-12.5);
    expect(cellMoney("x")).toBe("bad");
    expect(cellMoney("")).toBeNull();
  });
});
