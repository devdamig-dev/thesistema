"use client";

import { useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Message={role:"user"|"assistant";text:string;meta?:string};
const suggestions=[
  "¿Cómo viene el negocio este mes?",
  "¿Qué tengo que comprar esta semana?",
  "¿Qué productos tienen peor margen?",
  "¿Qué deudas vencen pronto?",
  "¿Cuánto gasté este mes?",
];

export default function AssistantClient({businessId,userName}:{businessId:string|null;userName:string}) {
  const [messages,setMessages]=useState<Message[]>([{
    role:"assistant",
    text:"Puedo analizar los datos reales de GastroPilot, tanto los cargados manualmente como los que entren por WhatsApp, OCR o automatizaciones. No modifico registros desde este chat.",
  }]);
  const [input,setInput]=useState("");
  const [pending,setPending]=useState(false);

  async function ask(text:string) {
    const clean=text.trim();
    if(!clean||pending||!businessId) return;
    setMessages((current)=>[...current,{role:"user",text:clean}]);
    setInput(""); setPending(true);
    try {
      const response=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:clean})});
      const data=await response.json();
      if(!response.ok||!data.ok) {
        const labels:Record<string,string>={
          quota_exceeded:"Se alcanzó el límite mensual de IA del negocio.",
          provider_unconfigured:"El motor de IA todavía no está disponible.",
          data_unavailable:"No pude leer los datos necesarios para responder.",
          requires_auth:"Tu sesión venció. Volvé a ingresar.",
        };
        setMessages((current)=>[...current,{role:"assistant",text:labels[data.code]??"No pude completar el análisis. Intentá nuevamente."}]);
      } else {
        setMessages((current)=>[...current,{role:"assistant",text:data.answer,meta:`${data.model} · ${data.credits} crédito${data.credits===1?"":"s"}`}]);
      }
    } catch {
      setMessages((current)=>[...current,{role:"assistant",text:"No pude conectar con el asistente. Intentá nuevamente."}]);
    } finally { setPending(false); }
  }

  return <div className="mx-auto max-w-5xl space-y-5">
    <div className="relative overflow-hidden rounded-2xl border border-ai-400/25 bg-gradient-to-br from-ai-500/[0.10] via-bg-elevated to-bg-elevated p-6">
      <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-ai-500/10 blur-3xl" />
      <div className="relative flex items-start gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-ai-400/30 bg-ai-500/10"><Sparkles className="h-5 w-5 text-ai-400"/></div>
        <div>
          <div className="eyebrow">Asistente GastroPilot</div>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Preguntale a tus datos</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">Analiza ventas, compras, gastos, productos, recetas, stock y deudas del negocio. La fuente es la base de GastroPilot, no WhatsApp.</p>
        </div>
      </div>
    </div>

    {!businessId ? <div className="rounded-xl border border-warn-500/30 bg-warn-500/[0.06] p-4 text-sm text-ink-muted">Necesitás estar dentro de un negocio para usar el asistente.</div> : <>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s)=><button key={s} onClick={()=>ask(s)} disabled={pending} className="rounded-full border border-line bg-bg-subtle px-3 py-2 text-xs text-ink-muted transition hover:border-ai-400/40 hover:text-ink disabled:opacity-50">{s}</button>)}
      </div>
      <section className="min-h-[420px] rounded-2xl border border-line bg-bg-elevated/70 p-4 md:p-6">
        <div className="space-y-4">
          {messages.map((m,i)=><div key={i} className={m.role==="user"?"ml-auto max-w-[85%]":"mr-auto max-w-[90%]"}>
            <div className={m.role==="user"?"rounded-2xl rounded-br-md bg-brand-600 px-4 py-3 text-sm text-white":"rounded-2xl rounded-bl-md border border-line bg-bg-subtle px-4 py-3 text-sm leading-relaxed text-ink"}>
              {m.role==="assistant"&&<div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ai-400"><Bot className="h-3.5 w-3.5"/> GastroPilot IA</div>}
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
            {m.meta&&<div className="mt-1 px-2 text-[10px] text-ink-subtle">{m.meta}</div>}
          </div>)}
          {pending&&<div className="mr-auto rounded-2xl rounded-bl-md border border-line bg-bg-subtle px-4 py-3 text-xs text-ink-muted">Analizando datos reales…</div>}
        </div>
      </section>
      <form onSubmit={(e)=>{e.preventDefault();void ask(input)}} className="flex gap-2 rounded-2xl border border-line bg-bg-elevated p-2">
        <input value={input} onChange={(e)=>setInput(e.target.value)} maxLength={1200} placeholder={`Preguntá algo sobre el negocio, ${userName.split(" ")[0]||""}…`} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-subtle"/>
        <Button type="submit" variant="primary" disabled={pending||!input.trim()}><Send className="h-4 w-4"/> Enviar</Button>
      </form>
      <p className="text-center text-[11px] text-ink-subtle">Las respuestas se basan sólo en datos visibles para tu usuario y pueden señalar faltantes antes de recomendar acciones.</p>
    </>}
  </div>;
}
