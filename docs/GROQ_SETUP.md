# Groq Engine Configuration & API Rotation

To achieve extreme throughput and absolute reliability, the Cozanet Groq Engine (`cozanet-groq`) is designed to rotate requests across three independent API keys. This mechanism prevents rate-limiting issues and guarantees continuous operating system execution.

---

## 🔑 Setup Instructions

Create an `.env` file at the root of the monorepo (or within the `packages/cozanet-groq/` directory):

```bash
# Groq Primary Key Rotation Group
GROQ_API_KEY_PRIMARY="gsk_your_primary_key_here..."
GROQ_API_KEY_SECONDARY="gsk_your_secondary_key_here..."
GROQ_API_KEY_TERTIARY="gsk_your_tertiary_key_here..."

# Failover Configuration
GROQ_MAX_RETRIES=5
GROQ_REQUEST_TIMEOUT_MS=2000
```

---

## 🔄 Rotation Strategy
The API layer executes queries on a round-robin schedule. If any key returns an HTTP `429 (Too Many Requests)` or high latency (> 1.5s), the driver automatically de-prioritizes that credential, switching to the next token seamlessly with zero execution lag for the master swarm.
