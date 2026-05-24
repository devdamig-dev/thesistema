/**
 * Email de alerta inmediata para notificaciones de alta prioridad.
 *
 * Cuando `createNotification` recibe `priority: "high"` y
 * `RESEND_API_KEY` está seteada, dispara un email corto al owner
 * del business.
 *
 * Dedup: no manda si ya mandó un email con el mismo título en las
 * últimas 4 horas (checkeo simple via una variable in-memory por
 * runtime — en producción conviene usar un rate-limit con KV o
 * similar).
 */

import { sendEmail } from "./resend";

const FROM = process.env.DIGEST_FROM_EMAIL ?? "GastroPilot <alertas@gastropilot.ai>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://gastropilot.ai";

// In-memory dedup simple — cubre el mismo proceso en un runtime edge/node.
const recentAlerts = new Map<string, number>();
const DEDUP_WINDOW_MS = 4 * 3600_000;

export async function sendHighPriorityAlert(input: {
  to: string;
  businessName: string;
  title: string;
  detail?: string;
  href?: string;
}) {
  const key = `${input.to}:${input.title}`;
  const lastSent = recentAlerts.get(key);
  if (lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS) return;

  const link = input.href ? `${APP_URL}${input.href}` : APP_URL;
  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /><title>Alerta GastroPilot</title></head>
<body style="margin:0;padding:24px;background:#0a0d12;color:#e2e8f0;font-family:-apple-system,system-ui,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#0f141a;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
    <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);border-left:4px solid #ef4444;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.15em;color:#ef4444;">Alerta · ${input.businessName}</div>
      <div style="margin-top:6px;font-size:16px;font-weight:600;color:white;">${input.title}</div>
    </div>
    ${input.detail ? `<div style="padding:16px 20px;font-size:13px;color:#94a3b8;">${input.detail}</div>` : ""}
    <div style="padding:16px 20px;border-top:1px solid rgba(255,255,255,0.06);">
      <a href="${link}" style="display:inline-block;padding:8px 16px;background:#f97316;color:white;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;">Ver en GastroPilot →</a>
    </div>
  </div>
</body>
</html>`;

  const result = await sendEmail({
    from: FROM,
    to: input.to,
    subject: `⚠️ ${input.title} · ${input.businessName}`,
    html,
    tags: [{ name: "type", value: "high-priority-alert" }],
  });

  if (result.ok) {
    recentAlerts.set(key, Date.now());
  }
}
