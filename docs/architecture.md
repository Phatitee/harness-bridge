# Architecture

The gateway is local and account-owned. Users enable only the providers they need.

1. `proxyup setup` selects providers and invokes their external login commands.
2. Managed CLIProxy uses a generated private auth directory; Copilot uses its adapter-owned user-level auth store.
3. The registry fetches only enabled backends, separates shared models using metadata or explicit IDs, and exposes namespaced aliases.
4. `proxyup run` checks the authenticated gateway identity and builds per-launch Claude settings from its current catalog.
5. Anthropic Messages and count-tokens requests are authenticated and routed to the relevant protocol adapter.
6. SSE and tool results return through the gateway. Claude Code executes local tools.

Gateway routes:

| Route | Method | Purpose |
| --- | --- | --- |
| `/health` | GET | Authenticated identity and provider state |
| `/v1/models` | GET | Combined namespaced catalog; cached for 60 seconds |
| `/v1/messages` | POST | Forward selected model request and stream |
| `/v1/messages/count_tokens` | POST | Delegate token counting to selected backend |

The core uses no provider account password or embedded OAuth client secret. Local client authentication and upstream adapter authentication are separate. Request bodies and credentials are never logged by the core. A bounded request signal follows client cancellation; forwarding does not retry tool turns.

Managed process startup preflights ports and refuses collisions. Closing a foreground runtime stops only its children. Attached backend lifecycle belongs to its owner. Account changes are applied on a deliberate gateway restart; no mid-stream account switching occurs.

## Modules

| File | Responsibility |
| --- | --- |
| `config.mjs` | Private state, validation, loopback origins, backend local keys |
| `args.mjs` / `output.mjs` | Strict CLI and structured output |
| `adapters.mjs` | Provider login argument arrays and CLIProxy config generation |
| `processes.mjs` | Bounded login/child lifecycle, port ownership and shutdown |
| `catalog.mjs` | Discovery, metadata partition and route resolution |
| `gateway.mjs` | Authenticated web handler and streaming Node HTTP bridge |
| `runtime.mjs` | Compose listener, backend children and catalog |
| `claude.mjs` | Temporary settings and optional removable launcher |
| `cli.mjs` | User-facing commands and onboarding |

Future work: adapter version negotiation, transactional account switching, native services, streaming probes, schema adapters and toolist. These are not prerequisites hidden behind claims of completed alpha features.
