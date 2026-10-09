import { SALES_CHANNELS, type SaleChannel } from "./types";
import { record, keys, uuid, text, timestamp, scaledDecimal } from "./validation";
export type InboxSaleProposal={kind:"summary";branchId:string;occurredAt:string;paymentMethod:string|null;notes:string|null;channels:Array<{channel:SaleChannel;amount:string}>};
export type InboxSaleReview={extractionId:string;businessId:string;userId:string;timezone:string;branchId:string|null;branches:Array<{id:string;name:string}>;expectedFields:Record<string,unknown>;channels:Array<{channel:string;amount:string}>;occurredAt:string;paymentMethod:string;notes:string};
export type InboxSaleApproval={extractionId:string;businessId:string;userId:string;expectedFields:Record<string,unknown>;review:InboxSaleProposal};
export function parseInboxSaleApproval(input:unknown):InboxSaleApproval{
 const r=record(input);keys(r,["extractionId","businessId","userId","expectedFields","review"]);const review=record(r.review);keys(review,["kind","branchId","occurredAt","paymentMethod","notes","channels"]);
 if(review.kind!=="summary"||!Array.isArray(review.channels)||review.channels.length<1||review.channels.length>6)throw new Error("Revisá los canales del resumen.");
 const seen=new Set<string>();const channels=review.channels.map(raw=>{const c=record(raw);keys(c,["channel","amount"]);if(!(SALES_CHANNELS as readonly unknown[]).includes(c.channel)||seen.has(String(c.channel)))throw new Error("Cada canal debe ser válido y aparecer una sola vez.");seen.add(String(c.channel));const cents=scaledDecimal(c.amount,2,true);if(cents>999999999999n)throw new Error("El importe supera el límite permitido.");return {channel:c.channel as SaleChannel,amount:c.amount as string};});
 return {extractionId:uuid(r.extractionId),businessId:uuid(r.businessId),userId:uuid(r.userId),expectedFields:record(r.expectedFields),review:{kind:"summary",branchId:uuid(review.branchId),occurredAt:timestamp(review.occurredAt),paymentMethod:text(review.paymentMethod,80,true),notes:text(review.notes,2000,true,true),channels}};
}
