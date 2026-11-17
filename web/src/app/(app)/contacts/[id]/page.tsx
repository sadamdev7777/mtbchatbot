import { ContactProfile } from "@/components/contacts/contact-profile";

export const metadata = { title: "Contact" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactProfile id={id} />;
}
