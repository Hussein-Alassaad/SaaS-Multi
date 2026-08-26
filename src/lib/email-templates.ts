/**
 * Plain template-string HTML emails. No react-email dependency: there are
 * no branding assets in the repo yet (public/ has only Next.js scaffold
 * SVGs) and three simple transactional emails don't justify a templating
 * package — inline styles keep these safe with no external assets.
 */
function wrapper(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b0b12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#15151f;border-radius:12px;padding:32px;">
            <tr>
              <td style="color:#f5f5fa;font-size:18px;font-weight:600;padding-bottom:16px;">${title}</td>
            </tr>
            <tr>
              <td style="color:#c7c7d6;font-size:14px;line-height:1.6;">${bodyHtml}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:linear-gradient(90deg,#7c5cff,#5cc8ff);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${label}</a>`;
}

export function verificationEmail(verifyUrl: string): { subject: string; html: string } {
  return {
    subject: "Verify your email — Nexaris",
    html: wrapper(
      "Verify your email",
      `<p>Thanks for signing up. Confirm your email address to finish setting up your workspace.</p>${button(verifyUrl, "Verify email")}<p style="margin-top:20px;color:#8a8aa0;font-size:12px;">This link expires in 24 hours.</p>`
    ),
  };
}

export function resetPasswordEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: "Reset your password — Nexaris",
    html: wrapper(
      "Reset your password",
      `<p>We received a request to reset your password. If this wasn't you, you can safely ignore this email.</p>${button(resetUrl, "Reset password")}<p style="margin-top:20px;color:#8a8aa0;font-size:12px;">This link expires in 1 hour.</p>`
    ),
  };
}

export interface WeeklyDigestPlatformRow {
  platform: string; // "linkedin" | "instagram" | "email"
  sent: number;
  replied: number;
}

export function weeklyDigestEmail(
  tenantName: string,
  rows: WeeklyDigestPlatformRow[],
  dashboardUrl: string
): { subject: string; html: string } {
  const totalSent = rows.reduce((sum, r) => sum + r.sent, 0);
  const totalReplied = rows.reduce((sum, r) => sum + r.replied, 0);
  const platformLabel: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram", email: "Email" };

  const rowsHtml = rows
    .map((r) => {
      const rate = r.sent > 0 ? Math.round((r.replied / r.sent) * 100) : 0;
      return `<tr>
        <td style="padding:6px 0;color:#f5f5fa;font-size:14px;">${platformLabel[r.platform] ?? r.platform}</td>
        <td style="padding:6px 0;color:#c7c7d6;font-size:14px;text-align:right;">${r.sent} sent</td>
        <td style="padding:6px 0;color:#8a8aa0;font-size:13px;text-align:right;">${r.replied} replies (${rate}%)</td>
      </tr>`;
    })
    .join("");

  return {
    subject: `Your weekly outreach digest — ${totalSent} sent, ${totalReplied} replies`,
    html: wrapper(
      "This week on Nexaris Outreach",
      `<p><strong>${tenantName}</strong> — here's what the agent did over the last 7 days.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid #2a2a38;">
        ${rowsHtml}
      </table>
      <p style="margin-top:16px;color:#c7c7d6;font-size:14px;"><strong>${totalSent}</strong> total messages sent, <strong>${totalReplied}</strong> replies.</p>
      ${button(dashboardUrl, "View dashboard")}`
    ),
  };
}

export function teamInviteEmail(
  inviterName: string,
  tenantName: string,
  acceptUrl: string
): { subject: string; html: string } {
  return {
    subject: `${inviterName} invited you to join ${tenantName} on Nexaris`,
    html: wrapper(
      "You've been invited",
      `<p><strong>${inviterName}</strong> invited you to join <strong>${tenantName}</strong>'s workspace on Nexaris.</p>${button(acceptUrl, "Accept invite")}`
    ),
  };
}
