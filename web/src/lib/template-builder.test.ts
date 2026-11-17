import { describe, expect, it } from "vitest";
import { buildTemplateComponents, validTemplateName } from "@/lib/template-builder";

describe("template builder", () => {
  it("numbers [placeholders] in order and reuses repeats", () => {
    const r = buildTemplateComponents("Salam [nama], pakej [destinasi] untuk [nama]", ["Ya", " ", "Nanti dulu"], { nama: "Puan Aisyah" });
    expect(r.components[0].text).toBe("Salam {{1}}, pakej {{2}} untuk {{1}}");
    expect(r.components[0].example.body_text).toEqual([["Puan Aisyah", "destinasi"]]);
    expect(r.components[1].buttons.map((b: any) => b.text)).toEqual(["Ya", "Nanti dulu"]);
    expect(r.variables).toEqual(["nama", "destinasi"]);
  });
  it("validates Meta template names", () => {
    expect(validTemplateName("susulan_v1")).toBe(true);
    expect(validTemplateName("Susulan v1")).toBe(false);
  });
});
