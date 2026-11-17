import { redirect } from "next/navigation";
import { homeFor } from "@/lib/roles";
import { getMe } from "@/lib/session";

export default async function Home() {
  const me = await getMe();
  redirect(homeFor(me.role));
}
