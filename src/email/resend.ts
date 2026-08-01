import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "Auction Tracker <onboarding@resend.dev>";

let client: Resend | null = null;
function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Send one email via Resend. If RESEND_API_KEY is not configured, the message
 * is logged instead of sent (so the whole pipeline is testable without a key).
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const c = getClient();
  if (!c) {
    console.log(
      `[email] RESEND_API_KEY not set — would send to ${opts.to}: "${opts.subject}"`,
    );
    return { ok: true, skipped: true };
  }
  try {
    const { data, error } = await c.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (error) return { ok: false, error: String(error.message ?? error) };
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
