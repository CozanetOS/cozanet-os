# CozanetOS (Root Monorepo)

> The Ultimate AI-Native Operating System for Next-Generation Swarm Intelligence.

CozanetOS is a revolutionary, AI-native operating system built from the ground up to orchestrate complex, multi-agent engine swarms. Designed for massive scalability, high-performance orchestration, and sub-millisecond communication, CozanetOS unites specialized micro-engines into a singular, cohesive cognitive intelligence.

---

## 🌌 The Vision
Modern operating systems manage files, processes, and memory. **CozanetOS manages thoughts, agents, and goals.** 

By transforming traditional system resources into active, self-correcting neural agents and modeling system operations as agent orchestrations, CozanetOS bridges the gap between raw compute and high-level abstract reasoning.

---

## 🏗️ Architecture Overview

CozanetOS uses a highly decoupled, modular architecture comprised of specialized **micro-engines** coordinated by a central message routing framework.

```
                                  +-----------------------+
                                  |   CEO Orchestrator    |
                                  |     (cozanet-agents)  |
                                  +-----------+-----------+
                                              |
                                     [CommunicationBus]
                                              |
     +-------------------+--------------------+--------------------+-------------------+
     |                   |                    |                    |                   |
+----+----+         +----+----+          +----+----+          +----+----+         +----+----+
|  Core   |         | Memory  |          | Security|          |   CX7   |         | Browser |
|  Engine |         | Engine  |          | Engine  |          |  Engine |         |  Engine |
+---------+         +---------+          +---------+          +---------+         +---------+
```

### Core Communication Paradigm
Engines do not call each other directly via tight RPC bindings or arbitrary APIs. Instead, they register with the central **CommunicationBus** and communicate via standardized, structured message envelopes addressed by **String-based Engine IDs** (e.g., `cozanet-engine-core`, `cozanet-engine-memory`).

---

## 📦 Modules (The 23+ CozanetOS Org Repositories)

CozanetOS consists of the following dedicated modules, each hosted in its own repository within the organization:

| Module / Repository | NPM Package Name | Scope / Responsibility |
|---|---|---|
| **`cozanet-core`** | `@cozanet/core` | Core kernel and low-level resource management. |
| **`cozanet-agents`** | `@cozanet/agents` | Agent runners, dynamic state trees, planning, and goal decomposition. |
| **`cozanet-api`** | `@cozanet/api` | API Registry, credentials vault, provider routing, cost tracking. |
| **`cozanet-apps`** | `@cozanet/apps` | Desktop productivity applications (Calendar, Notes, To-do lists). |
| **`cozanet-automation`** | `@cozanet/automation` | Workflow automation, scheduled background jobs, and trigger queues. |
| **`cozanet-browser`** | `@cozanet/browser` | Autonomous headless browser controller and scraping workspaces. |
| **`cozanet-communication`**| `@cozanet/communication` | Messaging routing and integration with external platforms (Gmail, Outlook). |
| **`cozanet-cx7`** | `@cozanet/cx7` | CX7 visual engine for dynamic programmable infinite layouts. |
| **`cozanet-database`** | `@cozanet/database` | State transaction, configuration storage, and semantic searches. |
| **`cozanet-development`** | `@cozanet/development` | Software engineering toolkit, tests, refactoring, and CI/CD. |
| **`cozanet-device`** | `@cozanet/device` | Registry and synchronization for local & remote connected devices. |
| **`cozanet-filesystem`** | `@cozanet/filesystem` | Virtual filesystem, file watchers, hot backups, and directory ops. |
| **`cozanet-identity`** | `@cozanet/identity` | Decentralized credentials vault, OAuth sessions, and MFA tracking. |
| **`cozanet-learning`** | `@cozanet/learning` | Continuous personal preference profiling and habit tracking. |
| **`cozanet-memory`** | `@cozanet/memory` | Multi-tiered memory engine (Hot, Warm, Cold/Vector). |
| **`cozanet-monitoring`** | `@cozanet/monitoring` | Performance logs, health heartbeats, diagnostics, and metrics. |
| **`cozanet-multimodal`** | `@cozanet/multimodal` | Auditory and visual sensory parsing, TTS/STT, OCR, and vision. |
| **`cozanet-os`** | `@cozanet/os` | CozanetOS root repository and monorepo manager. |
| **`cozanet-plugins`** | `@cozanet/plugins` | Sandbox executor for third-party cognitive plugin extensions. |
| **`cozanet-security`** | `@cozanet/security` | Cryptographic engine isolation, audit records, and security scanners. |
| **`cozanet-shared`** | `@cozanet/shared` | Shared typings, data models, message structures, and helper protocols. |
| **`cozanet-terminal`** | `@cozanet/terminal` | Terminal command execution pipelines inside protected sandboxes. |
| **`cozanet-workspaces`** | `@cozanet/workspaces` | Adaptive UI workspace layouts and viewport focus controller. |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- Docker (optional, for fully isolated deployments)
- A valid LLM Provider API key (Groq, OpenAI, Anthropic, etc.)

### Quick Start
1. **Clone the root monorepo:**
   ```bash
   git clone https://github.com/CozanetOS/cozanet-os.git
   cd cozanet-os
   ```

2. **Bootstrap all engines:**
   Our bootstrapping script clones all 23+ engine repositories into the local development workspace:
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

For more details on capabilities mapping, check [docs/CAPABILITIES.md](docs/CAPABILITIES.md).

---

## 🤝 Contributing
We love contributors! Please read [CONTRIBUTING.md](CONTRIBUTING.md) to understand our coding standards, branch rules, and community guidelines.

## 📄 License
CozanetOS is licensed under the Apache 2.0 License. See the LICENSE file for details.
