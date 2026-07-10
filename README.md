# CozanetOS (Root Monorepo)

> The Ultimate AI-Native Operating System for Next-Generation Swarm Intelligence.

CozanetOS is a revolutionary, AI-native operating system built from the ground up to orchestrate complex, multi-agent engine swarms. Designed for massive scalability, high-performance orchestration, and sub-millisecond communication, CozanetOS unites specialized micro-engines into a singular, cohesive cognitive intelligence.

---

## 🌌 The Vision
Modern operating systems manage files, processes, and memory. **CozanetOS manages thoughts, agents, and goals.** 

By transforming traditional system resources into active, self-correcting neural agents and modeling system operations as agent orchestrations, CozanetOS bridges the gap between raw compute and high-level abstract reasoning.

---

## 🏗️ Architecture Overview

CozanetOS uses a highly decoupled, modular architecture comprised of specialized **micro-engines** coordinated by a central **CEO Engine (Chief Executive Orchestrator)**. 

```
                                  +-----------------------+
                                  |   CEO Orchestrator    |
                                  |      (cozanet-ceo)    |
                                  +-----------+-----------+
                                              |
                                     [CommunicationBus]
                                              |
     +-------------------+--------------------+--------------------+-------------------+
     |                   |                    |                    |                   |
+----+----+         +----+----+          +----+----+          +----+----+         +----+----+
|  Core   |         | Memory  |          | Security|          |  Groq   |         | Plugins |
|  Engine |         | Engine  |          | Engine  |          | Engine  |         | Engine  |
+---------+         +---------+          +---------+          +---------+         +---------+
```

### Core Communication Paradigm
Engines do not call each other directly via tight RPC bindings or arbitrary APIs. Instead, they register with the central **CommunicationBus** and communicate via standardized, structured message envelopes addressed by **String-based Engine IDs** (e.g., `cozanet-engine-core`, `cozanet-engine-memory`).

---

## 📦 Modules (The 16+ CozanetOS Engines)

CozanetOS consists of the following dedicated modules, each hosted in its own repository:

1. **`cozanet-core`**: The kernel and core process/resource manager.
2. **`cozanet-ceo`**: The Chief Executive Orchestrator coordinating all engine swarms.
3. **`cozanet-comms`**: Standardized Message Bus and network router for inter-engine communication.
4. **`cozanet-memory`**: Multi-tiered memory engine (Hot, Warm, Cold/Vector).
5. **`cozanet-security`**: Fine-grained access control, encryption, and cryptographic isolation.
6. **`cozanet-groq`**: Ultra-fast LLM execution layer optimized for multi-key Groq rotation.
7. **`cozanet-plugins`**: Dynamic loader and validator for third-party cognitive tools.
8. **`cozanet-agent`**: Base class, agent execution runtimes, and lifecycle controllers.
9. **`cozanet-perception`**: Real-time multi-modal input processing (audio, vision, text streams).
10. **`cozanet-action`**: External integration execution engine (APIs, tools, terminal execution).
11. **`cozanet-ui`**: Next-generation web-based operational command center.
12. **`cozanet-cli`**: Developer command line interface for direct system interaction.
13. **`cozanet-db`**: Structured time-series and state transactional database.
14. **`cozanet-analytics`**: Performance monitoring, trace analysis, and engine efficiency telemetry.
15. **`cozanet-auth`**: User/Agent authentication, session tokens, and identity management.
16. **`cozanet-registry`**: System-wide service discovery and engine availability ledger.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- Docker (optional, for fully isolated deployments)
- A valid Groq API key

### Quick Start
1. **Clone the root monorepo:**
   ```bash
   git clone https://github.com/CozanetOS/cozanet-os.git
   cd cozanet-os
   ```

2. **Bootstrap all engines:**
   Our bootstrapping script clones all 16+ engine repositories into the local development workspace:
   ```bash
   ./scripts/bootstrap.sh
   ```

3. **Start the development environment:**
   Launch all micro-engines in hot-reloading development mode:
   ```bash
   ./scripts/dev.sh
   ```

---

## 📡 Engine Communication

To transmit a message from one engine to another, construct a standard envelope and dispatch it through the central `CommunicationBus`:

```typescript
import { CommunicationBus } from '@cozanet/comms';

const bus = new CommunicationBus();

// Broadcast or target specifically by String ID
bus.send({
  sender: 'cozanet-engine-core',
  recipient: 'cozanet-engine-memory',
  topic: 'MEMORY_STORE_REQUEST',
  payload: {
    key: 'session_token_123',
    value: { user: 'aegis', privileges: 'root' }
  }
});
```

For more details on IDs, check [docs/ENGINE_IDS.md](docs/ENGINE_IDS.md).

---

## 🤝 Contributing
We love contributors! Please read [CONTRIBUTING.md](CONTRIBUTING.md) to understand our coding standards, branch rules, and community guidelines.

## 📄 License
CozanetOS is licensed under the Apache 2.0 License. See the LICENSE file for details.
