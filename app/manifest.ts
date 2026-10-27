import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: "GastroPilot — Chat del equipo", short_name: "GastroPilot", description: "Tu equipo, sus documentos y la administración del negocio, en un chat.",
    start_url: "/chat", scope: "/", display: "standalone", background_color: "#101416", theme_color: "#101416", lang: "es-AR",
    icons: [{ src: "/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
}
