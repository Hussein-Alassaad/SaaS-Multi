# Meta app review: ready-to-use answers

Use this when you add Messenger, Instagram and WhatsApp to the Meta app and submit it for review. Meta changes its forms often, so
treat the permission names below as the usual set and follow what the form asks for. Replace anything in `<angle brackets>`.

## 1. App basics

| Field | Value |
|---|---|
| App type | Business |
| App name | `<Client business name> Assistant` (do not put "Meta", "Facebook", "Instagram" or "WhatsApp" in the name) |
| Privacy Policy URL | `<APP_URL>/privacy` |
| Data deletion instructions URL | `<APP_URL>/data-deletion` |
| Category | Business and pages / Messaging |
| Contact email | `<same as LEGAL_CONTACT_EMAIL on Vercel>` |
| Webhook, WhatsApp | `<APP_URL>/api/webhooks/whatsapp` |
| Webhook, Messenger + Instagram | `<APP_URL>/api/webhooks/meta` |
| Verify token | the value of `WHATSAPP_VERIFY_TOKEN` on Vercel |

Webhook fields to subscribe: WhatsApp `messages`; Page `messages`, `messaging_postbacks`, `message_reads`; Instagram `messages`, `messaging_postbacks`, `message_reads`.

## 2. What the app does (paste into "App description" / "How will you use this permission")

> The app lets a business answer the messages its own customers send it on WhatsApp, Instagram Direct and Facebook Messenger. It only ever
> replies to a customer who messaged the business first, and only inside the 24-hour customer-service window. It never sends promotional
> or unsolicited messages and never starts a conversation.
>
> When a customer writes, the app shows the message to the business in a shared inbox, drafts a reply with the help of an AI model using
> only the business's own written knowledge base, and sends it. By default every reply waits for a person at the business to approve it.
> If the customer shows interest, the app offers a time for a phone call; the business confirms it and the customer is sent the confirmed
> time. A person at the business can take over any conversation at any time, which stops the automatic replies.

## 3. Permissions and the reason for each

| Permission | Why the app needs it |
|---|---|
| `whatsapp_business_messaging` | To receive customers' WhatsApp messages and send replies to them. |
| `whatsapp_business_management` | To read the connected number's name and ID when the business connects it, and to manage its webhook subscription. |
| `pages_messaging` | To receive Messenger messages sent to the business's Page and reply to them. |
| `pages_show_list` | To let the business pick which of its Pages to connect. |
| `pages_manage_metadata` | To subscribe the Page to the webhook so new messages reach the app. |
| `instagram_basic` | To identify the connected Instagram professional account. |
| `instagram_manage_messages` | To receive Instagram Direct messages sent to the business and reply to them. |

Say plainly for every permission: used only for the connected business's own account, to reply to customer-initiated conversations.

## 4. Screencast to record (one video, about 3 minutes, English captions or voice)

1. Show the login page, sign in to the platform with the test account, open **Integrations**.
2. Show the connected WhatsApp, Instagram and Facebook cards (display name visible, token never shown).
3. From a phone with a tester role on the app, send a message to the business number: "Hi, what do you offer?"
4. Show it arriving in **Live Inbox** within seconds, and the drafted reply waiting in **Approval Queue**.
5. Approve the reply; show it arriving on the phone.
6. Send "I'd like to talk, can you call me?"; show the bell alert, the offered time on the **Meetings** page, press **Confirm**, and show the phone receiving the confirmed time.
7. Show a person typing a reply in the inbox and the **AI paused** badge appearing.
8. Repeat steps 3 to 5 once on Instagram and once on Messenger (shorter).
9. Open `/privacy` and `/data-deletion` to show they are public.

## 5. Test instructions for Meta's reviewers

> Log in at `<APP_URL>/agency-login` with `<test email>` / `<test password>` (a demo workspace with the channels already connected).
> To test, send any message to `<test WhatsApp number>`, or to the Instagram account `<handle>`, or to the Facebook Page `<page name>`.
> The message appears in "Live Inbox"; open "Approval Queue" to approve the drafted reply, which is then sent to the sender.
> The app never sends anything unless the person messaged the business first.

Create the test account with a password you are happy to share with Meta, and remove it after the review.

## 6. Data handling questionnaire (typical answers)

- **Do you share data with third parties?** Only with the processors needed to run the service: an AI provider (Anthropic) to draft replies, and hosting/database providers (Vercel, Supabase) in the EU. No sale of data, no advertising use.
- **Data retained?** Message text, the sender's name and phone number or messaging ID, and call details the customer provides, for as long as the business keeps its account or until deletion is requested.
- **Data deletion?** Via `<APP_URL>/data-deletion`; completed within 30 days of a verified request.
- **Is data encrypted?** Access tokens are stored encrypted; connections use TLS; webhook messages are verified with Meta's signature.
- **Do you use data for AI training?** No. Conversations are only sent to the AI provider to produce the reply.

## 7. Business verification (Morocco)

Meta usually asks the business to prove it exists. Have ready, for the legal entity that owns the Meta Business account: the commercial
register extract (registre de commerce / ICE number), a recent utility bill or bank statement showing the business address, and a
business email on the company's own domain and a website that shows the company name. The WhatsApp number must not be in use on the
ordinary WhatsApp or WhatsApp Business app (or must be deleted from it first).
