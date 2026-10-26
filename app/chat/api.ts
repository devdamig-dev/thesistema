export async function chatRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "No pudimos confirmar la acción. Actualizá el chat.");
  return result;
}
