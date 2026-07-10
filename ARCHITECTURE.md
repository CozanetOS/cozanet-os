# CozanetOS Technical Architecture

This document provides a deep-dive exploration of the technical systems, core protocols, and design choices powering CozanetOS.

---

## 🏛️ System Topology

CozanetOS operates as a highly decentralized, multi-agent operating system. Rather than compiling all capabilities into a monolith, we deploy a federated swarm of specialized micro-engines communicating via a highly optimized messaging backbone.

```
       +-----------------------------------------------------------+
       |                     Cozanet CLI / UI                      |
       +-----------------------------+-----------------------------+
                                     |
                                     v
       +-----------------------------------------------------------+
       |               Cozanet Comm Bus (cozanet-comms)            |
       +-----+-----------------+-----------------+-----------------+
             |                 |                 |
             v                 v                 v
       +-----+----+      +-----+----+      +-----+----+
       | CEO Engine |    | Memory   |      | Groq     |
       | (Orchestr)|    | Engine   |      | Engine   |
       +----------+      +----------+      +----------+
```

---

## 🧠 CEO Orchestration Flow

The **CEO Engine (`cozanet-ceo`)** acts as the supreme planner, system router, and supervisor. 

1. **Intake**: A user intent or system trigger enters the system via CLI/UI or external hooks.
2. **Analysis**: The CEO Engine parses the intent using the **Groq Engine** to generate an abstract execution plan.
3. **Task Delegation**: The CEO maps specific tasks to appropriate specialized engines using their registered **String IDs**.
4. **Execution Swarm**: Engines execute tasks concurrently, communicating via the `CommunicationBus`.
5. **State Merging**: The CEO aggregates results, handles exceptions, and presents the final system state back to the user or caller.

---

## 📡 Engine Registration & Routing

Engines register dynamically with the **Registry Engine (`cozanet-registry`)** during startup. 

```typescript
interface EngineManifest {
  id: string; // e.g. "cozanet-engine-memory"
  version: string;
  capabilities: string[];
  endpoint: string;
}
```

### Communication Protocol
Message routing is strictly managed using unique **String IDs** over the `CommunicationBus`. This ensures zero compile-time dependencies between engines, allowing for effortless hot-swapping and scaling.

```json
{
  "id": "msg_908234908234",
  "source": "cozanet-engine-ceo",
  "destination": "cozanet-engine-security",
  "type": "AUTHORIZE_TRANSACTION",
  "payload": {
    "target_engine": "cozanet-engine-action",
    "operation": "SYSTEM_SHUTDOWN"
  },
  "timestamp": 1783852100000
}
```

---

## 💾 Hierarchical Memory System

CozanetOS models memory after human cognitive structures:

1. **L1 (Hot Memory)**: Local in-memory caches (Redis/Memcached) supporting sub-millisecond retrieval. Used for active operational contexts.
2. **L2 (Warm Memory)**: Transactional document databases holding active conversation states, session variables, and temporary agent states.
3. **L3 (Cold/Vector Memory)**: Vector database (such as Qdrant or Milvus) storing long-term episodic memory, facts, and experiences enabling semantic retrieval.

---

## 🚀 Ultra-Fast Groq Integration

The **Groq Engine (`cozanet-groq`)** leverages Groq's high-throughput, low-latency Language Processing Units (LPUs). 

To ensure continuous high-availability and bypass strict API rate limits, CozanetOS implements a **Dynamic API Key Rotation System**. The engine rotates queries across 3 independent Groq keys using a round-robin algorithm that monitors latency and rate-limit headers.

---

## 🛡️ Security & Isolation Model

Security is managed centrally by **`cozanet-security`**:

- **Cryptographic Engine Isolation**: Every inter-engine communication is signed and verified using asymmetric key pairs generated during bootstrapping.
- **Role-Based Agent Privileges**: Agents are assigned strict capabilities. An agent cannot access external networks unless explicitly granted the `NET_OUTBOUND` permission by the security controller.
- **Secure Sandboxing**: Dynamic actions executed by `cozanet-action` are isolated inside short-lived micro-containers to prevent host system contamination.
