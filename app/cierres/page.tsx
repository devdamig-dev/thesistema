"use client";
import DatabaseClosures from "./database-closures";
import DemoClosures from "./demo-closures";
export default function CierresPage() { return process.env.NEXT_PUBLIC_APP_MODE === "database" ? <DatabaseClosures /> : <DemoClosures />; }
