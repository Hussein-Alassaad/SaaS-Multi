import type { Metadata } from "next";
import { LegalPage, legalIdentity } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Data Deletion — Nexaris",
  description: "How to ask for the messages and personal data held about you to be deleted.",
};

export default function DataDeletionPage() {
  const { company, email } = legalIdentity();
  return (
    <LegalPage title="Data Deletion Instructions" updated="14 October 2026">
      <p>
        If you messaged a business that uses {company} on WhatsApp, Instagram or Facebook Messenger, you can ask for the conversation and
        the personal data kept about you to be deleted. This page explains how.
      </p>

      <h2>How to ask</h2>
      <ul>
        <li>
          {email ? (
            <>
              Send an email to <a className="underline" href={`mailto:${email}`}>{email}</a> with the subject &ldquo;Delete my data&rdquo;.
            </>
          ) : (
            <>Tell the business you messaged that you want your data deleted, and they will ask {company} to remove it. Or write to {company} through the platform.</>
          )}
        </li>
        <li>Say which app you used (WhatsApp, Instagram or Facebook) and the name or phone number or username you messaged from, so we can find the conversation. We may ask you to confirm it is you by replying from the same account.</li>
        <li>You can also send the request as a message in the same conversation.</li>
      </ul>

      <h2>What we delete</h2>
      <ul>
        <li>Every message in your conversations with the business, including the AI&rsquo;s replies.</li>
        <li>Your name, phone number or messaging ID, what you asked about, and any call time or phone number you gave.</li>
      </ul>
      <p>
        We do this within 30 days of confirming your request, and tell you when it is done. Copies in routine backups are overwritten on
        their normal schedule. Data the business is legally required to keep (for example a signed invoice) is not part of the conversation
        record and is handled by the business under its own obligations.
      </p>

      <h2>Meta and your own account</h2>
      <p>
        Deleting data here does not delete anything held by Meta. To remove your activity from WhatsApp, Instagram or Facebook, use that
        app&rsquo;s own settings. More about what we do with data is in our <a className="underline" href="/privacy">Privacy Policy</a>.
      </p>
    </LegalPage>
  );
}
