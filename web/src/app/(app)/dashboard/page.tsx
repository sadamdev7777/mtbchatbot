import { SetupCard } from "@/components/dashboard/setup-card";
import { Placeholder } from "@/components/ui/placeholder";

export default function Page() {
  return (
    <div className="flex flex-col gap-5">
      <SetupCard />
      <Placeholder title="Dashboard cards">Being built in milestone 10.</Placeholder>
    </div>
  );
}
