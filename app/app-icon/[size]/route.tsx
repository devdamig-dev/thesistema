import { ImageResponse } from "next/og";
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === "512" ? 512 : 192;
  return new ImageResponse(<div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "#188c60", color: "white", fontSize: size * 0.58, fontWeight: 900, fontFamily: "sans-serif" }}>G</div>, { width: size, height: size });
}
