import { ItineraryReview } from "@/components/ai/itinerary";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItineraryReview id={id} />;
}
