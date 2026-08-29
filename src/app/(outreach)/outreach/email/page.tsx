import { getTenantSession } from "@/lib/auth";
import { getChannelActivityAction } from "@/lib/actions/outreach-channels";
import { ChannelActivity } from "@/components/outreach/ChannelActivity";

export default async function OutreachEmailPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const result = await getChannelActivityAction("email");
  const { messages, replies, accounts } = result.ok ? result : { messages: [], replies: [], accounts: [] };

  return (
    <ChannelActivity
      tenantId={tenantId}
      channel="email"
      title="Email"
      accentTitle="Outreach"
      subtitle="Email sends automatically once approved -- nothing to action here, just what's happened."
      messages={messages}
      replies={replies}
      accounts={accounts}
    />
  );
}
