/* No private pages, messages, files or API responses are cached. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101416"><title>GastroPilot · Sin conexión</title><body style="background:#101416;color:#edf3ef;font:16px system-ui;padding:32px"><h1>Estás sin conexión</h1><p>Volvé a conectarte para abrir el chat y enviar mensajes.</p><a style="color:#7ce1ae" href="/chat">Volver a intentar</a></body></html>', { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })));
});
self.addEventListener("push", event => {
  let roomId = "";
  try { roomId = event.data.json().roomId || ""; } catch { /* Generic notification only. */ }
  const url = /^[a-f0-9-]{36}$/i.test(roomId) ? `/chat?room=${encodeURIComponent(roomId)}` : "/chat";
  event.waitUntil(self.registration.showNotification("GastroPilot", { body: "Tenés un mensaje nuevo en el chat de tu equipo.", icon: "/app-icon/192", badge: "/app-icon/192", tag: `chat-${roomId}`, data: { url } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const path = typeof event.notification.data?.url === "string" && event.notification.data.url.startsWith("/chat") ? event.notification.data.url : "/chat";
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin + "/chat"));
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  }));
});
