/**
 * CozanetOS Heartbeat Endpoint — Vercel Serverless Function v3
 *
 * Architecture: On-demand self-scheduling pings via QStash.
 * - Pings ONLY happen when the AI is actively working on a task
 * - When task is done, pinging stops automatically
 * - No constant cron, no wasted resources
 *
 * Flow:
 *   1. Submit task → POST {submit: true, taskType, input}
 *   2. Heartbeat runs 8s slice, checkpoints to Redis
 *   3. If not done → schedules next ping via QStash (60s later)
 *   4. QStash ping arrives → runs another slice
 *   5. Repeat until complete → pinging stops
 *
 * Endpoints:
 *   GET  ?health=true              — health check
 *   GET  ?status=true              — list all active/paused tasks
 *   POST {submit: true, ...}       — submit a new task
 *   POST {source: "qstash"}        — heartbeat ping (resume paused tasks)
 *   POST {cancel: "checkpoint_id"} — cancel a running task
 *
 * ENV VARS:
 *   UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN — checkpoint + memory storage
 *   GROQ_API_KEY                            — LLM for agent thinking
 *   QSTASH_URL, QSTASH_TOKEN               — self-scheduling pings
 *   HEARTBEAT_URL                           — this endpoint's URL
 */

interface Checkpoint {
  id: string;
  taskId: string;
  agentId: string;
  taskType: string;
  input: any;
  partialOutput: any;
  stepIndex: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  lastCheckpointAt: number;
  resumeCount: number;
  maxResumes: number;
  lastError: string | null;
  agentState: Record<string, any>;
  submittedAt: number;
  taskDescription?: string;
}

// ── Redis helpers ─────────────────────────────────────────────────────
async function kvGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.result ?? null;
  } catch { return null; }
}

async function kvSet(key: string, value: string, ttl?: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return;
  try {
    const pipeline: any[] = [['SET', key, value]];
    if (ttl) pipeline.push(['EXPIRE', key, ttl]);
    await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
    });
  } catch {}
}

async function kvDel(key: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/del/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
}

async function kvScan(pattern: string): Promise<string[]> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return [];
  try {
    const res = await fetch(`${url}/scan/0?match=${encodeURIComponent(pattern)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.result?.[1] ?? [];
  } catch { return []; }
}

// ── Checkpoint operations ─────────────────────────────────────────────
async function getAllCheckpoints(): Promise<Checkpoint[]> {
  const keys = await kvScan('cozanet:checkpoint:*');
  const results: Checkpoint[] = [];
  for (const key of keys) {
    const raw = await kvGet(key);
    if (raw) {
      try { results.push(JSON.parse(raw) as Checkpoint); } catch {}
    }
  }
  return results;
}

async function getPausedCheckpoints(): Promise<Checkpoint[]> {
  return (await getAllCheckpoints()).filter(c => c.status === 'paused');
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await kvSet(`cozanet:checkpoint:${cp.id}`, JSON.stringify(cp), 86400); // 24h TTL
}

// ── Groq LLM ──────────────────────────────────────────────────────────
async function callGroq(messages: any[], model?: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1 || '';
  if (!apiKey) return '[no-groq-key]';
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model ?? 'llama-3.3-70b-versatile', messages, temperature: 0.7 }),
    });
    if (!res.ok) return `[groq-error:${res.status}]`;
    const data = await res.json();
    return data.choices[0]?.message?.content ?? '';
  } catch (err: any) { return `[groq-failed:${err.message}]`; }
}

// ── QStash self-scheduling ────────────────────────────────────────────
async function scheduleNextPing(): Promise<void> {
  const qstashUrl = process.env.QSTASH_URL;
  const qstashToken = process.env.QSTASH_TOKEN;
  const heartbeatUrl = process.env.HEARTBEAT_URL;
  if (!qstashUrl || !qstashToken || !heartbeatUrl) return;
  try {
    await fetch(`${qstashUrl}/publish/${heartbeatUrl}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        'Content-Type': 'application/json',
        'Delay': '60s',
      },
      body: JSON.stringify({ source: 'keepalive-auto' }),
    });
    console.log('[heartbeat] Scheduled next ping via QStash (60s)');
  } catch (err) {
    console.error('[heartbeat] Failed to schedule next ping:', err);
  }
}

// ── Run a task slice ──────────────────────────────────────────────────
async function runSlice(cp: Checkpoint): Promise<void> {
  const MAX_SLICE_MS = 8000;
  const startTime = Date.now();

  cp.status = 'running';
  cp.resumeCount++;
  cp.lastCheckpointAt = Date.now();
  await saveCheckpoint(cp);

  try {
    let result: any;
    const taskDesc = cp.taskDescription || cp.taskType;

    if (cp.taskType === 'think' || cp.taskType === 'plan' || cp.taskType === 'analyze') {
      result = await callGroq([
        { role: 'system', content: 'You are CozanetOS, a personal AI operating system. Continue the task from where you left off.' },
        { role: 'user', content: `Task: ${cp.input.goal || cp.input.task || JSON.stringify(cp.input)}\n\nPrevious progress (step ${cp.stepIndex}): ${JSON.stringify(cp.partialOutput)}` },
      ]);
    } else if (cp.taskType === 'build' || cp.taskType === 'generate_code' || cp.taskType === 'code') {
      result = await callGroq([
        { role: 'system', content: 'You are CozanetOS code generation engine. Generate clean, production-ready code. Continue from where you left off.' },
        { role: 'user', content: `Build/generate: ${JSON.stringify(cp.input)}\n\nPrevious output (step ${cp.stepIndex}): ${JSON.stringify(cp.partialOutput)}` },
      ]);
    } else if (cp.taskType === 'learn' || cp.taskType === 'study') {
      result = await callGroq([
        { role: 'system', content: 'You are CozanetOS learning engine. Study and absorb the material. Continue from where you left off.' },
        { role: 'user', content: `Learn about: ${JSON.stringify(cp.input)}\n\nPrevious notes (step ${cp.stepIndex}): ${JSON.stringify(cp.partialOutput)}` },
      ]);
    } else if (cp.taskType === 'reflect') {
      result = await callGroq([
        { role: 'system', content: 'You are CozanetOS reflection engine. Analyze the action and outcome.' },
        { role: 'user', content: `Action: ${cp.input.action}\nOutcome: ${cp.input.outcome}\n\nPrevious analysis: ${JSON.stringify(cp.partialOutput)}` },
      ]);
    } else {
      result = await callGroq([
        { role: 'system', content: 'You are CozanetOS. Process the following task. Continue from where you left off.' },
        { role: 'user', content: `Task type: ${cp.taskType}\nInput: ${JSON.stringify(cp.input)}\nPrevious output: ${JSON.stringify(cp.partialOutput)}` },
      ]);
    }

    const elapsed = Date.now() - startTime;
    if (elapsed < MAX_SLICE_MS && result && !result.startsWith('[')) {
      // Task completed within this slice
      cp.status = 'completed';
      cp.partialOutput = result;
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      console.log(`[heartbeat] Task ${cp.id} (${taskDesc}) completed in ${elapsed}ms after ${cp.resumeCount} slices`);
    } else {
      // Ran out of time or got error response — checkpoint and pause
      cp.status = 'paused';
      cp.partialOutput = result ?? cp.partialOutput;
      cp.stepIndex++;
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      console.log(`[heartbeat] Task ${cp.id} (${taskDesc}) paused after ${elapsed}ms (slice ${cp.stepIndex})`);
    }
  } catch (err: any) {
    cp.status = 'paused';
    cp.lastError = err.message;
    cp.lastCheckpointAt = Date.now();
    await saveCheckpoint(cp);
    console.error(`[heartbeat] Task ${cp.id} error: ${err.message}`);
  }
}

// ── Main handler ─────────────────────────────────────────────────────
export default async function handler(
  req: { method?: string; body?: any; query?: any },
  res: { status: (code: number) => { json: (data: any) => void }; json: (data: any) => void }
): Promise<void> {
  const method = req.method || 'GET';

  // ── Health check ───────────────────────────────────────────────────
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

  // ── Status: list all tasks ─────────────────────────────────────────
  if (method === 'GET' && req.query?.status === 'true') {
    const all = await getAllCheckpoints();
    res.status(200).json({
      total: all.length,
      active: all.filter(c => c.status === 'paused' || c.status === 'running').length,
      completed: all.filter(c => c.status === 'completed').length,
      failed: all.filter(c => c.status === 'failed').length,
      tasks: all.map(c => ({
        id: c.id,
        taskType: c.taskType,
        description: c.taskDescription || c.taskType,
        status: c.status,
        step: c.stepIndex,
        resumeCount: c.resumeCount,
        submittedAt: c.submittedAt,
        lastError: c.lastError,
      })),
    });
    return;
  }

  // ── Cancel a task ──────────────────────────────────────────────────
  if (method === 'POST' && req.body?.cancel) {
    const cpId = req.body.cancel;
    const raw = await kvGet(`cozanet:checkpoint:${cpId}`);
    if (!raw) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const cp = JSON.parse(raw) as Checkpoint;
    cp.status = 'cancelled';
    cp.lastError = 'Cancelled by user';
    await saveCheckpoint(cp);
    res.status(200).json({ cancelled: true, id: cpId, taskType: cp.taskType });
    return;
  }

  // ── Submit a new task ──────────────────────────────────────────────
  if (method === 'POST' && req.body?.submit) {
    const t = req.body;
    const checkpoint: Checkpoint = {
      id: `ckpt:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      taskId: t.taskId || `task:${Date.now()}`,
      agentId: t.agentId || 'agent:ceo',
      taskType: t.taskType || 'think',
      taskDescription: t.description || t.taskType,
      input: t.input || t,
      partialOutput: null,
      stepIndex: 0,
      status: 'pending',
      lastCheckpointAt: Date.now(),
      submittedAt: Date.now(),
      resumeCount: 0,
      maxResumes: t.maxResumes || 100,
      lastError: null,
      agentState: {},
    };

    await saveCheckpoint(checkpoint);

    // Run the first slice immediately
    await runSlice(checkpoint);

    // If still paused, self-schedule the next ping via QStash
    const paused = await getPausedCheckpoints();
    if (paused.length > 0) {
      await scheduleNextPing();
    }

    res.status(200).json({
      submitted: true,
      checkpointId: checkpoint.id,
      taskDescription: checkpoint.taskDescription,
      message: 'Task started. Pings will continue automatically until it\'s done.',
    });
    return;
  }

  // ── Heartbeat ping (from QStash or external) ────────────────────────
  try {
    const paused = await getPausedCheckpoints();

    if (paused.length === 0) {
      // No work — don't schedule any more pings
      res.status(200).json({
        hadWork: false,
        pendingCount: 0,
        message: 'No active tasks. Pinging stopped.',
        timestamp: Date.now(),
      });
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
        failed: true,
        message: `Task "${oldest.taskDescription}" exceeded max attempts`,
        pendingCount: paused.length - 1,
        timestamp: Date.now(),
      });
      return;
    }

    await runSlice(oldest);

    // Check if it completed
    const stillPaused = (await getPausedCheckpoints()).some(c => c.id === oldest.id);

    if (stillPaused) {
      // Still working — schedule the next ping
      await scheduleNextPing();
    }
    // If completed, no ping scheduled — pinging stops automatically

    res.status(200).json({
      hadWork: true,
      checkpointId: oldest.id,
      taskDescription: oldest.taskDescription,
      completed: !stillPaused,
      step: oldest.stepIndex,
      resumeCount: oldest.resumeCount,
      needsAnotherPing: stillPaused,
      pendingCount: (await getPausedCheckpoints()).length,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, timestamp: Date.now() });
  }
}
