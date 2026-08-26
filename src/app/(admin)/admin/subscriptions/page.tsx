import { getPlans } from "@/lib/mock/billing";
import { SubscriptionsClient } from "./SubscriptionsClient";

export default async function SubscriptionsPage() {
  const plans = await getPlans();
  return <SubscriptionsClient plans={plans} />;
}
