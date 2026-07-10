# CozanetOS Engine ID Registry

To support hot-swappable microservices, all communication payload routing is governed by unique, standardized **String IDs**. 

Below is the definitive list of engine identifiers:

| Engine ID | Repository Name | Primary Role |
|---|---|---|
| `cozanet-engine-core` | `cozanet-core` | Low-level execution context & scheduler |
| `cozanet-engine-ceo` | `cozanet-ceo` | Orchestration, high-level planning & supervision |
| `cozanet-engine-comms` | `cozanet-comms` | Pub-Sub event bus & socket routing |
| `cozanet-engine-memory` | `cozanet-memory` | Multimodal hot/cold storage & state recall |
| `cozanet-engine-security` | `cozanet-security` | Key generation, packet validation & sandbox controls |
| `cozanet-engine-groq` | `cozanet-groq` | Dynamic-rotation low-latency LLM engine |
| `cozanet-engine-plugins` | `cozanet-plugins` | Third-party cognitive dynamic extension manager |
| `cozanet-engine-agent` | `cozanet-agent` | Worker agent loops, action state loops |
| `cozanet-engine-perception` | `cozanet-perception`| Sensor streams & input processing |
| `cozanet-engine-action` | `cozanet-action` | Execution sandboxes, tool definitions, APIs |
| `cozanet-engine-ui` | `cozanet-ui` | Operational Web dashboard UI |
| `cozanet-engine-cli` | `cozanet-cli` | Developer shell & utility binaries |
| `cozanet-engine-db` | `cozanet-db` | State persistence engine |
| `cozanet-engine-analytics` | `cozanet-analytics`| Performance monitoring, system logging |
| `cozanet-engine-auth` | `cozanet-auth` | Session validation, identity keys |
| `cozanet-engine-registry` | `cozanet-registry` | Central node discovery ledger |
