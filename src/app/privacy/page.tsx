import type { Metadata } from "next";
import { LegalPage, legalIdentity } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Nexaris",
  description: "How Nexaris handles messages and personal data when a business uses it to answer customers on WhatsApp, Instagram and Facebook Messenger.",
};

export default function PrivacyPage() {
  const { company, email } = legalIdentity();
  return (
    <LegalPage title="Privacy Policy" updated="14 October 2026">
      <p>
        {company} (&ldquo;we&rdquo;) provides software that helps a business answer the messages its own customers send it on WhatsApp,
        Instagram and Facebook Messenger. This page explains what personal data is handled when that happens, why, and what your choices
        are. In this policy, &ldquo;the business&rdquo; is the company that uses {company} and &ldquo;you&rdquo; is a person who sent that business a message.
      </p>

      <h2>Who is responsible for the data</h2>
      <p>
        The business decides why your messages are used and is the controller of that data. {company} processes it on the business&rsquo;s
        behalf, only to run the service described here.
      </p>

      <h2>What we handle</h2>
      <ul>
        <li>The messages you send to the business, and the replies sent back (text, and a short description of attachments we cannot read, such as voice notes or images).</li>
        <li>Your name or profile name and your phone number or messaging ID on the channel you used, as provided by WhatsApp, Instagram or Facebook.</li>
        <li>What you asked for or were interested in, and any meeting time or phone number you give so the business can call you.</li>
        <li>Basic technical data such as the time a message was sent and whether it was delivered or read.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To show the business your message, draft a reply with the help of an AI model, and send the reply after the business has approved it or its rules allow it to go out.</li>
        <li>To offer you a time for a call and tell the business that you were offered it.</li>
        <li>To keep a record of the conversation so the business does not ask you the same thing twice.</li>
        <li>To keep the service secure, fix faults and prevent abuse.</li>
      </ul>
      <p>We do not sell personal data. We do not use your messages to advertise to you, and we do not start conversations: the service only replies to messages you sent.</p>

      <h2>AI processing</h2>
      <p>
        To draft replies, the text of the conversation and the business&rsquo;s own knowledge base are sent to an AI provider (Anthropic) that
        processes them to produce a reply. They are used to produce that reply for the business and are not used by us for any other purpose.
        A person at the business can read, edit or take over any conversation, and the AI stops replying when they do.
      </p>

      <h2>Who else receives data</h2>
      <ul>
        <li><strong>Meta Platforms</strong> (WhatsApp, Instagram, Messenger), because that is where the conversation takes place. Meta&rsquo;s own privacy policy applies to your use of its apps.</li>
        <li><strong>Hosting and database providers</strong> (Vercel and Supabase), which store and serve the data for us, in the European Union.</li>
        <li><strong>The AI provider</strong> described above.</li>
      </ul>
      <p>We share data with no one else unless the law requires it.</p>

      <h2>How long we keep it</h2>
      <p>
        Conversations are kept for as long as the business keeps its account, or until you or the business ask for them to be deleted,
        whichever is sooner. Deleted data is removed from our systems; routine backups are overwritten on their normal schedule.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see the data held about you, to correct it, or to have it deleted. See the{" "}
        <a className="underline" href="/data-deletion">data deletion instructions</a>. You can also stop a conversation at any time by
        telling the business, or by blocking the account on the app you used.
      </p>

      <h2>Security</h2>
      <p>
        Access tokens for connected accounts are stored encrypted. Messages from Meta are verified with a cryptographic signature before they
        are accepted, access to a business&rsquo;s data is limited to that business&rsquo;s own users, and connections are encrypted in transit.
      </p>

      <h2>Contact</h2>
      <p>
        {email ? (
          <>
            Questions or requests: <a className="underline" href={`mailto:${email}`}>{email}</a>
          </>
        ) : (
          <>Questions or requests: please contact the business you messaged, or write to {company} through the platform.</>
        )}
      </p>
    </LegalPage>
  );
}
