/**
 * CozanetOS Heartbeat Endpoint — Vercel Serverless Function
 *
 * This is the endpoint that external pingers (cron-job.org, UptimeRobot,
 * or QStash) hit to keep CozanetOS agents alive on Vercel free plan.
 *
 * It's fully self-contained — no npm install needed. Uses only the
 * global fetch() API (available in Vercel Edge runtime).
 *
 * DEPLOY:
 *   - Push this file to your repo as `api/heartbeat.ts`
 *   - Or deploy standalone via Vercel CLI/API
 *
 * ENV VARS (set in Vercel project settings):
 *   UPSTASH_REDIS_URL    — Your Upstash Redis REST URL
 *   UPSTASH_REDIS_TOKEN   — Your Upstash Redis REST token
 *   GROQ_API_KEY          — Your Groq API key (for LLM calls)
 *   GROQ_API_KEY_1/2/3    — Optional: rotated Groq keys
 *   QSTASH_URL            — Optional: https://qstash.upstash.io/v1
 *   QSTASH_TOKEN          — Optional: for self-scheduling
 *   HEARTBEAT_URL         — This endpoint's URL (for self-scheduling)
 *
 * EXTERNAL PING SETUP:
 *   cron-job.org → POST https://your-app.vercel.app/api/heartbeat every 1 min
 */

// ── Types ────────────────────────────────────────────────────────────
interface Checkpoint {
  id: string;
  taskId: string;
  agentId: string;
  taskType: string;
  input: any;
  partialOutput: any;
  stepIndex: number;
  totalSteps?: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  lastCheckpointAt: number;
  resumeCount: number;
  maxResumes: number;
  lastError: string | null;
  agentState: Record<string, any>;
}

interface HeartbeatResponse {
  hadWork: boolean;
  checkpointId: string | null;
  completed: boolean;
  needsAnotherPing: boolean;
  nextPingDelayMs: number;
  pendingCount: number;
  timestamp: number;
}

// ── Upstash Redis helpers (HTTP only, no SDK needed) ──────────────────
async function kvGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.result ?? null;
}

async function kvSet(key: string, value: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return;

  // Upstash pipeline: set + expire in one call
  await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['SET', key, value],
      ['EXPIRE', key, 86400], // 24h TTL — stale checkpoints auto-clean
    ]),
  });
}

async function kvDel(key: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return;
  await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function kvScan(pattern: string): Promise<string[]> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return [];

  const res = await fetch(`${url}/scan/0?match=${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.result?.[1] ?? [];
}

// ── Checkpoint operations ────────────────────────────────────────────
async function getPausedCheckpoints(): Promise<Checkpoint[]> {
  const keys = await kvScan('cozanet:checkpoint:*');
  const results: Checkpoint[] = [];

  for (const key of keys) {
    const raw = await kvGet(key);
    if (raw) {
      try {
        const cp = JSON.parse(raw) as Checkpoint;
        if (cp.status === 'paused') results.push(cp);
      } catch {}
    }
  }

  return results;
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await kvSet(`cozanet:checkpoint:${cp.id}`, JSON.stringify(cp));
}

async function deleteCheckpoint(id: string): Promise<void> {
  await kvDel(`cozanet:checkpoint:${id}`);
}

// ── Groq LLM call (for agent tasks that need thinking) ─────────────────
async function callGroq(messages: any[], model?: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1 || '';
  if (!apiKey) return '[no-groq-key]';

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model ?? 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.7,
    }),
  });

  if (!res.ok) return `[groq-error:${res.status}]`;
  const data = await res.json();
  return data.choices[0]?.message?.content ?? '';
}

// ── QStash self-scheduling ────────────────────────────────────────────
async function scheduleNextPing(): Promise<void> {
  const qstashUrl = process.env.QSTASH_URL;
  const qstashToken = process.env.QSTASH_TOKEN;
  const heartbeatUrl = process.env.HEARTBEAT_URL;

  if (!qstashUrl || !qstashToken || !heartbeatUrl) return;

  try {
    await fetch(`${qstashUrl}/publish/${encodeURIComponent(heartbeatUrl)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        'Content-Type': 'application/json',
        'Delay': '60s',
      },
      body: JSON.stringify({ source: 'keepalive-auto' }),
    });
  } catch {
    // External cron (cron-job.org) will still ping — this is just a bonus
  }
}

// ── Execute a checkpoint slice ────────────────────────────────────────
async function runSlice(cp: Checkpoint): Promise<void> {
  const MAX_SLICE_MS = 8000; // 8s — buffer under Vercel's 10s limit
  const startTime = Date.now();

  cp.status = 'running';
  cp.resumeCount++;
  cp.lastCheckpointAt = Date.now();
  await saveCheckpoint(cp);

  try {
    // Dispatch based on task type
    let result: any;

    if (cp.taskType === 'think' || cp.taskType === 'plan' || cp.taskType === 'analyze') {
      // LLM thinking task
      const messages = [
        { role: 'system', content: 'You are CozanetOS, a personal AI operating system. Continue the task from where you left off.' },
        { role: 'user', content: `Task: ${cp.input.goal || cp.input.task || JSON.stringify(cp.input)}\n\nPrevious progress (step ${cp.stepIndex}): ${JSON.stringify(cp.partialOutput)}` },
      ];
      result = await callGroq(messages);
    } else if (cp.taskType === 'generate_code' || cp.taskType === 'code') {
      const messages = [
        { role: 'system', content: 'You are CozanetOS code generation engine. Generate clean, production-ready code.' },
        { role: 'user', content: `Generate code for: ${JSON.stringify(cp.input)}\n\nPrevious output: ${JSON.stringify(cp.partialOutput)}` },
      ];
      result = await callGroq(messages);
    } else if (cp.taskType === 'reflect') {
      const messages = [
        { role: 'system', content: 'You are CozanetOS reflection engine. Analyze the action and outcome.' },
        { role: 'user', content: `Action: ${cp.input.action}\nOutcome: ${cp.input.outcome}\n\nPrevious analysis: ${JSON.stringify(cp.partialOutput)}` },
      ];
      result = await callGroq(messages);
    } else {
      // Generic task — pass through to LLM with context
      const messages = [
        { role: 'system', content: 'You are CozanetOS. Process the following task.' },
        { role: 'user', content: `Task type: ${cp.taskType}\nInput: ${JSON.stringify(cp.input)}\nPrevious output: ${JSON.stringify(cp.partialOutput)}` },
      ];
      result = await callGroq(messages);
    }

    // Check if we still have time for more work
    const elapsed = Date.now() - startTime;
    if (elapsed < MAX_SLICE_MS && result) {
      // Task completed within this slice
      cp.status = 'completed';
      cp.partialOutput = result;
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      console.log(`[heartbeat] Checkpoint ${cp.id} completed in ${elapsed}ms`);
    } else {
      // Ran out of time or no result — checkpoint and pause
      cp.status = 'paused';
      cp.partialOutput = result ?? cp.partialOutput;
      cp.stepIndex++;
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      console.log(`[heartbeat] Checkpoint ${cp.id} paused after ${elapsed}ms (slice ${cp.stepIndex})`);
    }
  } catch (err: any) {
    cp.status = 'paused';
    cp.lastError = err.message;
    cp.lastCheckpointAt = Date.now();
    await saveCheckpoint(cp);
    console.error(`[heartbeat] Checkpoint ${cp.id} error: ${err.message}`);
  }
}

// ── Main handler ─────────────────────────────────────────────────────
export default async function handler(
  req: { method?: string; body?: any; query?: any },
  res: { status: (code: number) => { json: (data: any) => void }; json: (data: any) => void }
): Promise<void> {
  // Only respond to POST (from QStash/cron) or GET (from UptimeRobot)
  const method = req.method || 'GET';

  // Health check endpoint
  if (method === 'GET' && req.query?.health === 'true') {
    res.status(200).json({
      status: 'alive',
      timestamp: Date.now(),
      hasRedis: !!process.env.UPSTASH_REDIS_URL,
      hasGroq: !!(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1),
      hasQStash: !!process.env.QSTASH_URL,
    });
    return;
  }

  // Submit a new checkpointed task (POST with task data)
  if (method === 'POST' && req.body?.submit) {
    const taskInput = req.body;
    const checkpoint: Checkpoint = {
      id: `ckpt:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      taskId: taskInput.taskId || `task:${Date.now()}`,
      agentId: taskInput.agentId || 'agent:ceo',
      taskType: taskInput.taskType || 'think',
      input: taskInput.input || taskInput,
      partialOutput: null,
      stepIndex: 0,
      status: 'pending',
      lastCheckpointAt: Date.now(),
      resumeCount: 0,
      maxResumes: taskInput.maxResumes || 50,
      lastError: null,
      agentState: {},
    };

    await saveCheckpoint(checkpoint);

    // Immediately try to run the first slice
    await runSlice(checkpoint);

    // Schedule next ping if still paused
    const updated = await getPausedCheckpoints();
    if (updated.length > 0) {
      await scheduleNextPing();
    }

    res.status(200).json({
      submitted: true,
      checkpointId: checkpoint.id,
      message: 'Task submitted. It will continue processing via heartbeat pings.',
    });
    return;
  }

  // Heartbeat — resume any paused checkpoints
  try {
    const paused = await getPausedCheckpoints();

    if (paused.length === 0) {
      // No work — just a keep-alive ping
      res.status(200).json({
        hadWork: false,
        checkpointId: null,
        completed: false,
        needsAnotherPing: false,
        pendingCount: 0,
        timestamp: Date.now(),
      } as HeartbeatResponse);
      return;
    }

    // Resume the oldest paused checkpoint
    const oldest = paused.sort((a, b) => a.lastCheckpointAt - b.lastCheckpointAt)[0];

    if (oldest.resumeCount >= oldest.maxResumes) {
      oldest.status = 'failed';
      oldest.lastError = `Exceeded max resume attempts (${oldest.maxResumes})`;
      await saveCheckpoint(oldest);
      res.status(200).json({
        hadWork: true,
        checkpointId: oldest.id,
        completed: false,
        needsAnotherPing: false,
        pendingCount: paused.length - 1,
        timestamp: Date.now(),
      } as HeartbeatResponse);
      return;
    }

    await runSlice(oldest);

    // Check if it completed
    const updated = await getPausedCheckpoints();
    const stillPaused = updated.some(c => c.id === oldest.id);
    const completed = !stillPaused;

    // Schedule next ping if there's still work
    if (stillPaused) {
      await scheduleNextPing();
    }

    res.status(200).json({
      hadWork: true,
      checkpointId: oldest.id,
      completed,
      needsAnotherPing: stillPaused,
      nextPingDelayMs: 60000,
      pendingCount: updated.length,
      timestamp: Date.now(),
    } as HeartbeatResponse);
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      timestamp: Date.now(),
    });
  }
}
