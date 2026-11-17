import { Card, Empty } from "@/components/ui/misc";

export function Placeholder({ title, children }: { title: string; children?: React.ReactNode }) {
  return <Card><Empty title={title}>{children}</Empty></Card>;
}
