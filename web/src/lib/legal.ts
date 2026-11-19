import "server-only";

/** Who runs the service, for the public legal pages. Set on Netlify; defaults keep the pages valid. */
export function legal() {
  return {
    company: process.env.LEGAL_COMPANY_NAME || "Muslimtravelbug",
    email: process.env.LEGAL_CONTACT_EMAIL || "",
    address: process.env.LEGAL_ADDRESS || "",
    updated: "19 November 2026",
  };
}
