import { NextRequest, NextResponse } from "next/server";
import { answerBusinessQuestion } from "@/lib/assistant/business-assistant";

export async function POST(request: NextRequest) {
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin) {
    return NextResponse.json({ok:false,code:"invalid_origin"},{status:403});
  }
  let body:unknown;
  try { body=await request.json(); } catch {
    return NextResponse.json({ok:false,code:"invalid_json"},{status:400});
  }
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some((key)=>key!=="message")) {
    return NextResponse.json({ok:false,code:"invalid_payload"},{status:400});
  }
  const message=(body as {message?:unknown}).message;
  if(typeof message!=="string"||!message.trim()||message.length>1200) {
    return NextResponse.json({ok:false,code:"invalid_question"},{status:400});
  }
  const result=await answerBusinessQuestion(message);
  if(!result.ok) {
    const status=result.code==="requires_auth"?401:result.code==="quota_exceeded"?429:503;
    return NextResponse.json(result,{status});
  }
  return NextResponse.json(result);
}
