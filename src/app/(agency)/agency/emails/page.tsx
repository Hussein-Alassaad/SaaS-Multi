import { getTenantSession } from "@/lib/auth";
import { listSentEmailsAction, listEmailTemplatesAction } from "@/lib/actions/marketing-emails";
import { EmailsClient } from "./EmailsClient";

export default async function EmailsPage() {
  await getTenantSession();
  const [emailsResult, templatesResult] = await Promise.all([listSentEmailsAction(), listEmailTemplatesAction()]);

  return (
    <EmailsClient
      initialEmails={emailsResult.ok ? emailsResult.emails : []}
      initialTemplates={
        templatesResult.ok
          ? templatesResult.templates.map((t) => ({
              id: t.id,
              name: t.name,
              subject: t.subject,
              body: t.body,
              updatedAt: t.updatedAt.toISOString(),
            }))
          : []
      }
    />
  );
}
