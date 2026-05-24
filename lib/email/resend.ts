/**
 * Wrapper minimal sobre la REST API de Resend.
 *
 * No usa el SDK oficial para mantener el bundle chico y no agregar
 * deps. Si no hay RESEND_API_KEY, devuelve { ok: false, mode: "demo" }
 * sin romper nada.
 */

export type SendEmailInput = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
};

export type SendEmailResult =
  | { ok: true; id: string; mode: "real" }
  | { ok: false; mode: "demo"; reason: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, mode: "demo", reason: "missing_RESEND_API_KEY" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        reply_to: input.replyTo,
        tags: input.tags,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, mode: "demo", reason: `resend_http_${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id: string };
    return { ok: true, id: data.id, mode: "real" };
  } catch (error: any) {
    return { ok: false, mode: "demo", reason: error?.message ?? "resend_unknown_error" };
  }
}
