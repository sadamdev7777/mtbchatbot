import { requireSection } from "@/lib/session";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireSection("payments");
  return <>{children}</>;
}
