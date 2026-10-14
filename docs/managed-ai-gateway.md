# Managed AI Gateway

## Product decision

GastroPilot provides managed AI as part of the SaaS plan. Standard customers do not create or paste provider API keys. BYOK is reserved for a future Enterprise option and must never be the default onboarding path.

Customer-facing usage is measured in **GastroPilot credits**. Raw provider tokens and USD cost remain internal operational metrics.

## Request path

```
WhatsApp / Web / Inbox / OCR / Automation
                |
                v
        Managed AI Gateway
                |
        quota reservation
                |
        model routing
                |
        OpenAI Responses API
                |
        usage finalization
                |
        validated backend tool registry / domain service
```

The model never writes SQL and never receives permission to execute arbitrary database operations. For WhatsApp, the model only interprets an intent after deterministic heuristics fail. The existing registry, validation, tenant checks, confirmation lifecycle and domain services remain authoritative.

## Routing

| Task | Model | Credits |
| --- | --- | ---: |
| Tool interpretation | GPT-5.6 Luna | 1 |
| Message extraction | GPT-5.6 Luna | 1 |
| Invoice extraction | GPT-5.6 Luna | 3 |
| Business query | GPT-5.6 Terra | 2 |
| Purchase suggestion | GPT-5.6 Terra | 4 |
| Recommendation | GPT-5.6 Terra | 4 |
| Business analysis | GPT-5.6 Sol | 8 |

The client does not choose the model. Routing is a server-side product policy and can be changed without exposing provider details in workflows.

## Metering and quotas

`ai_business_plans` stores the per-business plan and monthly credit allowance.

`ai_usage_events` is the durable usage ledger. Every provider request must:

1. reserve credits atomically;
2. call the provider only when the reservation succeeds;
3. finalize the ledger with provider token usage, internal USD cost and status.

A failed provider request releases capacity because only `reserved` and `completed` rows count toward the current monthly quota. Rejected quota requests remain in the ledger for diagnostics but do not consume credits.

The reservation RPC serializes against the business plan row so concurrent requests cannot overspend a hard monthly limit.

## Security

- Provider keys are server-only environment variables.
- Authenticated clients have read-only RLS access to their own plan and usage.
- Direct inserts/updates/deletes are revoked from authenticated users.
- Reservation/finalization RPCs are executable only by the service role.
- The WhatsApp interpreter may only choose from capabilities already authorized for the actor.
- AI output is validated again by the existing tool registry before any operation can execute.
- Sensitive operations still require explicit confirmation.
- Database mode never falls back to mock AI usage.

## Commercial model

The pilot default is 5,000 credits per month with a hard limit and no overage. This is a technical pilot allowance, not a final public price.

Future commercial plans can map plan codes to different monthly allowances while keeping the same ledger. Packs/overage and Enterprise BYOK can be added without changing the tool execution boundary.

## Provider activation

Production inference requires `OPENAI_API_KEY`.

If the key is absent, the gateway fails closed with `provider_unconfigured`; existing deterministic/heuristic flows continue operating without pretending an AI request succeeded.
