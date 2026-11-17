import { describe, expect, it } from "vitest";
import { mapContactsCsv, parseCsv, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("parses quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseCsv(toCsv([["a,b", 'q"'], ["1", null]]))).toEqual([["a,b", 'q"'], ["1", ""]]);
  });

  it("maps a SleekFlow export", () => {
    const csv = [
      "First Name,Last Name,Phone Number,Email,Labels,Subscriber",
      "Aminah,Yusof,+60 12-345 6789,aminah@x.com,\"Kundasang; HOT\",Yes",
      "Ali,,0123456780,,,No",
      "Bad,,abc,,,",
      "Dup,,60123456789,,,",
    ].join("\n");
    const r = mapContactsCsv(csv);
    expect(r.contacts).toEqual([
      { wa_id: "60123456789", name: "Aminah Yusof", email: "aminah@x.com", state: null, labels: ["Kundasang", "HOT"], opt_in: true },
      { wa_id: "60123456780", name: "Ali", email: null, state: null, labels: [], opt_in: false },
    ]);
    expect(r.skipped.map((s) => s.row)).toEqual([4, 5]);
  });

  it("does not assume opt-in when the file has no opt-in column", () => {
    expect(mapContactsCsv("name,phone\nA,60123000000").contacts[0].opt_in).toBe(false);
  });
});
