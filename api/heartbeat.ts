/**
 * CozanetOS Heartbeat Endpoint — Vercel Serverless Function v4
 *
 * Upgraded agent engine with:
 *  - Streaming Groq responses (partial output within 8s slices)
 *  - Multi-key rotation (GROQ_API_KEY, _1, _2, _3)
 *  - 24 agent personas matching the orchestrator
 *  - Redis-backed memory loading & saving
 *  - Multi-step reasoning (think -> act -> reflect -> respond)
 *  - Conversation history accumulation across slices
 *  - Progress tracking & graceful timeout handling
 *  - Default maxResumes bumped to 30
 */

interface Checkpoint {
  id: string;
  taskId: string;
  agentId: string;
  taskType: string;
  input: any;
  partialOutput: string;
  stepIndex: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  lastCheckpointAt: number;
  resumeCount: number;
  maxResumes: number;
  lastError: string | null;
  agentState: {
    messages: any[];
    phase: 'think' | 'act' | 'reflect' | 'respond' | 'done';
    progress: number;
    thoughts: string[];
    actions: string[];
    startedAt: number;
  };
  submittedAt: number;
  taskDescription?: string;
}

interface AgentPersona {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  taskTypes: string[];
  model?: string;
}

// ── 24 Agent Personas ────────────────────────────────────────────────

const AGENT_PERSONAS: Record<string, AgentPersona> = {
  ceo: { id: 'ceo', name: 'CEO Agent', role: 'Strategic decision-maker',
    systemPrompt: 'You are the CEO Agent of CozanetOS. You make strategic decisions, prioritize tasks, delegate to other agents, and ensure the system operates efficiently. You think in terms of goals, priorities, and resource allocation. Be concise and decisive.',
    taskTypes: ['decide', 'prioritize', 'delegate', 'plan', 'think'] },
  research: { id: 'research', name: 'Research Agent', role: 'Information researcher',
    systemPrompt: 'You are the Research Agent of CozanetOS. You gather information, analyze data, and produce structured research findings. You are thorough, systematic, and cite your reasoning.',
    taskTypes: ['research', 'analyze', 'investigate', 'study', 'think'] },
  coding: { id: 'coding', name: 'Coding Agent', role: 'Code generation engine',
    systemPrompt: 'You are the Coding Agent of CozanetOS. You generate clean, production-ready code. You follow best practices, include error handling, and write modular code. Always wrap code in proper markdown code blocks.',
    taskTypes: ['build', 'generate_code', 'code', 'refactor', 'debug'],
    model: 'openai/gpt-oss-120b' },
  memory: { id: 'memory', name: 'Memory Agent', role: 'Memory manager',
    systemPrompt: 'You are the Memory Agent of CozanetOS. You manage the system memory — extracting key facts, organizing memories, and retrieving relevant context.',
    taskTypes: ['memorize', 'recall', 'organize', 'forget', 'think'] },
  planner: { id: 'planner', name: 'Planner Agent', role: 'Task planner',
    systemPrompt: 'You are the Planner Agent of CozanetOS. You break down complex goals into actionable steps with dependencies, timelines, and success criteria.',
    taskTypes: ['plan', 'schedule', 'organize', 'think'] },
  learning: { id: 'learning', name: 'Learning Agent', role: 'Continuous learner',
    systemPrompt: 'You are the Learning Agent of CozanetOS. You study materials, extract knowledge, and build understanding. You create structured notes and connect new information to existing knowledge.',
    taskTypes: ['learn', 'study', 'absorb', 'practice', 'think'] },
  knowledge: { id: 'knowledge', name: 'Knowledge Agent', role: 'Knowledge base manager',
    systemPrompt: 'You are the Knowledge Agent of CozanetOS. You manage the knowledge base — indexing, categorizing, and connecting information.',
    taskTypes: ['index', 'categorize', 'connect', 'query', 'think'] },
  browser: { id: 'browser', name: 'Browser Agent', role: 'Web navigator',
    systemPrompt: 'You are the Browser Agent of CozanetOS. You navigate the web, extract content, and interact with web pages.',
    taskTypes: ['browse', 'scrape', 'navigate', 'extract', 'think'] },
  review: { id: 'review', name: 'Review Agent', role: 'Code reviewer',
    systemPrompt: 'You are the Review Agent of CozanetOS. You review code for quality, security, and best practices. You provide actionable feedback.',
    taskTypes: ['review', 'audit', 'analyze', 'think'] },
  testing: { id: 'testing', name: 'Testing Agent', role: 'Test engineer',
    systemPrompt: 'You are the Testing Agent of CozanetOS. You write and run tests, identify edge cases, and ensure code quality.',
    taskTypes: ['test', 'validate', 'verify', 'think'] },
  security: { id: 'security', name: 'Security Agent', role: 'Security analyst',
    systemPrompt: 'You are the Security Agent of CozanetOS. You identify vulnerabilities, assess risks, and recommend security measures.',
    taskTypes: ['scan', 'assess', 'protect', 'audit', 'think'] },
  vision: { id: 'vision', name: 'Vision Agent', role: 'Visual analyzer',
    systemPrompt: 'You are the Vision Agent of CozanetOS. You analyze images, diagrams, and visual data.',
    taskTypes: ['analyze_image', 'describe', 'visualize', 'think'] },
  cx7: { id: 'cx7', name: 'CX7 Agent', role: 'UX optimizer',
    systemPrompt: 'You are the CX7 Agent of CozanetOS. You optimize user experiences, design interfaces, and ensure smooth interactions.',
    taskTypes: ['design', 'optimize', 'review', 'think'] },
  device: { id: 'device', name: 'Device Agent', role: 'Device manager',
    systemPrompt: 'You are the Device Agent of CozanetOS. You manage device connections, status, and interactions.',
    taskTypes: ['connect', 'manage', 'monitor', 'think'] },
  api: { id: 'api', name: 'API Agent', role: 'API integrator',
    systemPrompt: 'You are the API Agent of CozanetOS. You design, build, and integrate APIs.',
    taskTypes: ['build', 'integrate', 'design', 'code', 'think'] },
  workflow: { id: 'workflow', name: 'Workflow Agent', role: 'Workflow automator',
    systemPrompt: 'You are the Workflow Agent of CozanetOS. You design and automate workflows with triggers, conditions, and actions.',
    taskTypes: ['automate', 'design', 'schedule', 'think'] },
  scheduler: { id: 'scheduler', name: 'Scheduler Agent', role: 'Task scheduler',
    systemPrompt: 'You are the Scheduler Agent of CozanetOS. You manage task scheduling, priorities, and dependencies.',
    taskTypes: ['schedule', 'prioritize', 'organize', 'think'] },
  email: { id: 'email', name: 'Email Agent', role: 'Email manager',
    systemPrompt: 'You are the Email Agent of CozanetOS. You draft, send, and manage emails with clear, professional communication.',
    taskTypes: ['draft', 'send', 'reply', 'summarize', 'think'] },
  documents: { id: 'documents', name: 'Documents Agent', role: 'Document processor',
    systemPrompt: 'You are the Documents Agent of CozanetOS. You create, edit, and process documents.',
    taskTypes: ['create', 'edit', 'format', 'summarize', 'think'] },
  voice: { id: 'voice', name: 'Voice Agent', role: 'Voice interface',
    systemPrompt: 'You are the Voice Agent of CozanetOS. You handle speech-to-text, text-to-speech, and voice commands.',
    taskTypes: ['transcribe', 'speak', 'command', 'think'] },
  analytics: { id: 'analytics', name: 'Analytics Agent', role: 'Data analyst',
    systemPrompt: 'You are the Analytics Agent of CozanetOS. You analyze data, generate insights, and create reports.',
    taskTypes: ['analyze', 'report', 'visualize', 'think'] },
  database: { id: 'database', name: 'Database Agent', role: 'Database manager',
    systemPrompt: 'You are the Database Agent of CozanetOS. You manage data schemas, queries, and migrations.',
    taskTypes: ['query', 'migrate', 'optimize', 'manage', 'think'] },
  integration: { id: 'integration', name: 'Integration Agent', role: 'Integration specialist',
    systemPrompt: 'You are the Integration Agent of CozanetOS. You connect external services and APIs.',
    taskTypes: ['integrate', 'connect', 'configure', 'think'] },
  automation: { id: 'automation', name: 'Automation Agent', role: 'Automation worker',
    systemPrompt: 'You are the Automation Agent of CozanetOS. You execute automated tasks and workflows reliably and efficiently.',
    taskTypes: ['execute', 'automate', 'run', 'process', 'think'] },
  github: { id: 'github', name: 'GitHub Agent', role: 'GitHub operations',
    systemPrompt: 'You are the GitHub Agent of CozanetOS. You manage repositories, pull requests, issues, and CI/CD.',
    taskTypes: ['commit', 'pr', 'issue', 'review', 'merge', 'think'] },
};

// ── Groq Multi-Key Rotation ───────────────────────────────────────────

function getGroqKeys(): string[] {
  return [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ].filter(Boolean) as string[];
}

let keyIndex = 0;
function nextGroqKey(): string {
  const keys = getGroqKeys();
  if (keys.length === 0) return '';
  const key = keys[keyIndex % keys.length];
  keyIndex++;
  return key;
}

// ── Redis Helpers ────────────────────────────────────────────────────

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

// ── Memory System ────────────────────────────────────────────────────

async function loadMemories(limit = 10): Promise<string[]> {
  const keys = await kvScan('cozanet:memory:*');
  const memories: string[] = [];
  const sorted = keys.sort().slice(-limit);
  for (const key of sorted) {
    const raw = await kvGet(key);
    if (raw) {
      try {
        const mem = JSON.parse(raw);
        memories.push(`- [${mem.category || 'general'}] ${mem.content}`);
      } catch { memories.push(`- ${raw}`); }
    }
  }
  return memories;
}

async function saveMemory(content: string, category: string): Promise<void> {
  const key = `cozanet:memory:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await kvSet(key, JSON.stringify({ content, category, timestamp: Date.now() }), 604800);
}

// ── Checkpoint Operations ─────────────────────────────────────────────

async function getAllCheckpoints(): Promise<Checkpoint[]> {
  const keys = await kvScan('cozanet:checkpoint:*');
  const results: Checkpoint[] = [];
  for (const key of keys) {
    const raw = await kvGet(key);
    if (raw) { try { results.push(JSON.parse(raw) as Checkpoint); } catch {} }
  }
  return results;
}

async function getPausedCheckpoints(): Promise<Checkpoint[]> {
  return (await getAllCheckpoints()).filter(c => c.status === 'paused');
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await kvSet(`cozanet:checkpoint:${cp.id}`, JSON.stringify(cp), 86400);
}

// ── Agent Persona Resolution ─────────────────────────────────────────

function resolvePersona(taskType: string, agentId?: string): AgentPersona {
  if (agentId && AGENT_PERSONAS[agentId]) return AGENT_PERSONAS[agentId];
  for (const persona of Object.values(AGENT_PERSONAS)) {
    if (persona.taskTypes.includes(taskType)) return persona;
  }
  return AGENT_PERSONAS.ceo;
}

// ── Groq Streaming Call ──────────────────────────────────────────────

async function callGroqStream(
  messages: any[],
  model: string,
  maxTokens: number,
  onToken: (token: string, isReasoning: boolean) => void
): Promise<{ full: string; reasoning: string; finishReason: string | null; error: string | null }> {
  const apiKey = nextGroqKey();
  if (!apiKey) return { full: '', reasoning: '', finishReason: null, error: 'no-groq-key' };

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens, stream: true }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { full: '', reasoning: '', finishReason: null, error: `groq-error:${res.status}` };
    }

    const reader = res.body?.getReader();
    if (!reader) return { full: '', reasoning: '', finishReason: null, error: 'no-stream-reader' };

    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let reasoningText = '';
    let finishReason: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          const contentDelta = delta?.content || '';
          const reasoningDelta = delta?.reasoning || '';
          if (contentDelta) { fullText += contentDelta; onToken(contentDelta, false); }
          if (reasoningDelta) { reasoningText += reasoningDelta; onToken(reasoningDelta, true); }
          if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
        } catch {}
      }
    }
    return { full: fullText, reasoning: reasoningText, finishReason, error: null };
  } catch (err: any) {
    return { full: '', reasoning: '', finishReason: null, error: `groq-failed:${err.message}` };
  }
}

// ── QStash Self-Scheduling ────────────────────────────────────────────

async function scheduleNextPing(): Promise<void> {
  const qstashUrl = process.env.QSTASH_URL;
  const qstashToken = process.env.QSTASH_TOKEN;
  const heartbeatUrl = process.env.HEARTBEAT_URL;
  if (!qstashUrl || !qstashToken || !heartbeatUrl) return;
  try {
    await fetch(`${qstashUrl}/publish/${heartbeatUrl}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${qstashToken}`, 'Content-Type': 'application/json', 'Delay': '60s' },
      body: JSON.stringify({ source: 'keepalive-auto' }),
    });
    console.log('[heartbeat] Scheduled next ping via QStash (60s)');
  } catch (err) {
    console.error('[heartbeat] Failed to schedule next ping:', err);
  }
}

// ── Multi-Step Agent Slice Runner ─────────────────────────────────────

async function runSlice(cp: Checkpoint): Promise<void> {
  const MAX_SLICE_MS = 8000;
  const startTime = Date.now();

  cp.status = 'running';
  cp.resumeCount++;
  cp.lastCheckpointAt = Date.now();
  await saveCheckpoint(cp);

  try {
    const persona = resolvePersona(cp.taskType, cp.agentId);
    const model = persona.model || 'openai/gpt-oss-120b';
    const taskDesc = cp.taskDescription || cp.taskType;

    // Initialize agent state on first slice
    if (cp.resumeCount === 1) {
      cp.agentState = {
        messages: [], phase: 'think', progress: 0,
        thoughts: [], actions: [], startedAt: Date.now(),
      };
      cp.partialOutput = '';
    }

    // Load memories for context
    const memories = await loadMemories(5);
    const memoryContext = memories.length > 0
      ? `\n\n## Relevant Memories\n${memories.join('\n')}` : '';

    // Build system prompt with persona + context
    const systemPrompt = `${persona.systemPrompt}

You are CozanetOS ${persona.name}. You work in time-sliced chunks (max 8s per slice) and may be resumed multiple times. Always produce useful output so progress accumulates.

## Current Context
- Task: ${taskDesc}
- Task type: ${cp.taskType}
- Slice #: ${cp.resumeCount}
- Phase: ${cp.agentState.phase}
- Progress: ${cp.agentState.progress}%
- Previous thoughts: ${cp.agentState.thoughts.length > 0 ? cp.agentState.thoughts.slice(-3).join(' -> ') : 'none yet'}
- Previous output length: ${cp.partialOutput.length} chars${memoryContext}

## Instructions
- If this is the first slice, analyze the task and start working.
- If resuming, continue from where you left off — don't repeat yourself.
- Be concise but thorough. Output your work directly.
- If the task is complete, end your response with "[DONE]" on a new line.
- If you need more time, just output what you have — the next slice will continue.`;

    // Build conversation messages
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    const history = cp.agentState.messages.slice(-8);
    for (const msg of history) messages.push(msg);

    const userPrompt = cp.input.goal || cp.input.task || cp.input.description || JSON.stringify(cp.input);
    const continuationHint = cp.partialOutput
      ? `\n\n## Previous Output (continue from here)\n${cp.partialOutput.slice(-2000)}` : '';
    messages.push({ role: 'user', content: `${userPrompt}${continuationHint}` });

    // Check time budget
    const remainingMs = startTime + MAX_SLICE_MS - Date.now();
    if (remainingMs <= 1000) {
      cp.status = 'paused';
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      return;
    }

    const maxTokens = Math.min(Math.floor(remainingMs / 50), 1500);
    let streamedText = '';
    let streamedReasoning = '';

    const result = await callGroqStream(messages, model, maxTokens, (token, isReasoning) => {
      if (isReasoning) streamedReasoning += token;
      else streamedText += token;
    });

    const elapsed = Date.now() - startTime;

    if (result.error) {
      cp.agentState.thoughts.push(`Error in slice ${cp.resumeCount}: ${result.error}`);
      cp.status = 'paused';
      cp.lastError = result.error;
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      return;
    }

    const isComplete = result.full.includes('[DONE]') || result.finishReason === 'stop';
    let newOutput = streamedText.replace('[DONE]', '').trimEnd();
    if (cp.partialOutput && !cp.partialOutput.endsWith('\n')) cp.partialOutput += '\n';
    cp.partialOutput += newOutput;

    // Update agent state
    cp.agentState.messages.push(
      { role: 'user', content: userPrompt + continuationHint },
      { role: 'assistant', content: newOutput },
    );

    // Phase progression
    if (streamedReasoning) {
      cp.agentState.thoughts.push(streamedReasoning.slice(0, 500));
    }
    if (cp.agentState.phase === 'think') {
      cp.agentState.thoughts.push(newOutput.slice(0, 200));
      cp.agentState.phase = 'act';
      cp.agentState.progress = Math.min(cp.agentState.progress + 25, 90);
    } else if (cp.agentState.phase === 'act') {
      cp.agentState.actions.push(newOutput.slice(0, 200));
      cp.agentState.phase = isComplete ? 'done' : 'reflect';
      cp.agentState.progress = Math.min(cp.agentState.progress + 30, 95);
    } else if (cp.agentState.phase === 'reflect') {
      cp.agentState.thoughts.push(`Reflection: ${newOutput.slice(0, 200)}`);
      cp.agentState.phase = isComplete ? 'done' : 'act';
      cp.agentState.progress = Math.min(cp.agentState.progress + 15, 95);
    }

    if (isComplete) {
      cp.agentState.phase = 'done';
      cp.agentState.progress = 100;
      cp.status = 'completed';
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      await saveMemory(`Completed task "${taskDesc}" (${cp.taskType}) — ${cp.partialOutput.slice(0, 200)}...`, 'task-history');
      console.log(`[heartbeat] Task ${cp.id} (${taskDesc}) completed in ${elapsed}ms after ${cp.resumeCount} slices`);
    } else {
      cp.status = 'paused';
      cp.stepIndex++;
      cp.lastError = null;
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      console.log(`[heartbeat] Task ${cp.id} (${taskDesc}) paused after ${elapsed}ms (slice ${cp.stepIndex}, ${newOutput.length} new chars)`);
    }
  } catch (err: any) {
    cp.status = 'paused';
    cp.lastError = err.message;
    cp.lastCheckpointAt = Date.now();
    await saveCheckpoint(cp);
  }
}

// ── Main Handler ──────────────────────────────────────────────────────

export default async function handler(
  req: { method?: string; body?: any; query?: any },
  res: { status: (code: number) => { json: (data: any) => void }; json: (data: any) => void }
): Promise<void> {
  const method = req.method || 'GET';

  // Health check
  if (method === 'GET' && req.query?.health === 'true') {
    const keys = getGroqKeys();
    res.status(200).json({
      status: 'alive', timestamp: Date.now(), version: 'v4-upgraded',
      hasRedis: !!process.env.UPSTASH_REDIS_URL,
      hasGroq: keys.length > 0, groqKeys: keys.length,
      hasQStash: !!process.env.QSTASH_URL,
      agentPersonas: Object.keys(AGENT_PERSONAS).length,
    });
    return;
  }

  // Status: list all tasks
  if (method === 'GET' && req.query?.status === 'true') {
    const all = await getAllCheckpoints();
    res.status(200).json({
      total: all.length,
      active: all.filter(c => c.status === 'paused' || c.status === 'running').length,
      completed: all.filter(c => c.status === 'completed').length,
      failed: all.filter(c => c.status === 'failed').length,
      tasks: all.map(c => ({
        id: c.id, agentId: c.agentId, taskType: c.taskType,
        description: c.taskDescription, status: c.status,
        step: c.stepIndex, resumeCount: c.resumeCount,
        progress: c.agentState?.progress || 0,
        phase: c.agentState?.phase || 'unknown',
        outputLength: c.partialOutput?.length || 0,
        submittedAt: c.submittedAt, lastError: c.lastError,
      })),
    });
    return;
  }

  // Get task output
  if (method === 'GET' && req.query?.task) {
    const all = await getAllCheckpoints();
    const task = all.find(c => c.id === req.query.task);
    if (task) {
      res.status(200).json({
        id: task.id, status: task.status,
        progress: task.agentState?.progress || 0,
        phase: task.agentState?.phase || 'unknown',
        output: task.partialOutput,
        thoughts: task.agentState?.thoughts || [],
        actions: task.agentState?.actions || [],
        resumeCount: task.resumeCount, step: task.stepIndex,
      });
    } else { res.status(404).json({ error: 'Task not found' }); }
    return;
  }

  // List available agents
  if (method === 'GET' && req.query?.agents === 'true') {
    res.status(200).json({
      count: Object.keys(AGENT_PERSONAS).length,
      agents: Object.values(AGENT_PERSONAS).map(a => ({
        id: a.id, name: a.name, role: a.role, taskTypes: a.taskTypes,
      })),
    });
    return;
  }

  // POST: Submit / Ping / Cancel / Remember / Recall / Cleanup
  if (method === 'POST' && req.body) {
    const body = req.body;

    // Submit new task
    if (body.submit) {
      const id = `ckpt:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const maxResumes = body.maxResumes || 30;
      const persona = resolvePersona(body.taskType, body.agentId);

      const cp: Checkpoint = {
        id, taskId: body.taskId || id,
        agentId: body.agentId || persona.id,
        taskType: body.taskType || 'think',
        input: body.input || body.description || {},
        partialOutput: '', stepIndex: 0, status: 'pending',
        lastCheckpointAt: Date.now(), resumeCount: 0,
        maxResumes, lastError: null,
        agentState: { messages: [], phase: 'think', progress: 0, thoughts: [], actions: [], startedAt: Date.now() },
        submittedAt: Date.now(),
        taskDescription: body.description || body.taskType || 'Unnamed task',
      };

      await saveCheckpoint(cp);
      await runSlice(cp);
      await scheduleNextPing();

      res.status(200).json({
        submitted: true, checkpointId: id,
        agentId: cp.agentId, agentName: persona.name,
        taskDescription: cp.taskDescription, maxResumes,
        message: `Task started with ${persona.name}. Pings will continue automatically until done.`,
      });
      return;
    }

    // Heartbeat ping
    if (body.source === 'keepalive-auto' || body.source === 'manual-test' || body.source === 'keepalive') {
      const paused = await getPausedCheckpoints();
      if (paused.length === 0) {
        res.status(200).json({ hadWork: false, pendingCount: 0, message: 'No active tasks. Pinging stopped.', timestamp: Date.now() });
        return;
      }

      paused.sort((a, b) => a.lastCheckpointAt - b.lastCheckpointAt);
      const cp = paused[0];

      if (cp.resumeCount >= cp.maxResumes) {
        cp.status = 'failed';
        cp.lastError = `Exceeded max resume attempts (${cp.maxResumes})`;
        cp.lastCheckpointAt = Date.now();
        await saveCheckpoint(cp);
        res.status(200).json({ hadWork: false, failed: cp.id, reason: cp.lastError, pendingCount: paused.length - 1 });
        return;
      }

      await runSlice(cp);
      const stillPaused = await getPausedCheckpoints();
      const needsMore = stillPaused.length > 0;
      if (needsMore) await scheduleNextPing();

      res.status(200).json({
        hadWork: true, checkpointId: cp.id,
        taskDescription: cp.taskDescription, agentId: cp.agentId,
        completed: cp.status === 'completed', status: cp.status,
        step: cp.stepIndex, resumeCount: cp.resumeCount,
        progress: cp.agentState?.progress || 0,
        phase: cp.agentState?.phase || 'unknown',
        outputPreview: cp.partialOutput?.slice(-200) || '',
        needsAnotherPing: needsMore, pendingCount: stillPaused.length,
        timestamp: Date.now(),
      });
      return;
    }

    // Cancel task
    if (body.cancel) {
      const all = await getAllCheckpoints();
      const cp = all.find(c => c.id === body.cancel);
      if (cp) {
        cp.status = 'cancelled';
        cp.lastError = 'Cancelled by user';
        cp.lastCheckpointAt = Date.now();
        await saveCheckpoint(cp);
        res.status(200).json({ cancelled: true, id: cp.id, taskType: cp.taskType });
      } else { res.status(404).json({ error: 'Task not found' }); }
      return;
    }

    // Save memory
    if (body.remember) {
      await saveMemory(body.remember, body.category || 'general');
      res.status(200).json({ saved: true, category: body.category || 'general' });
      return;
    }

    // Load memories
    if (body.recall) {
      const memories = await loadMemories(body.limit || 20);
      res.status(200).json({ memories, count: memories.length });
      return;
    }

    // Cleanup
    if (body.cleanup) {
      const all = await getAllCheckpoints();
      let deleted = 0;
      for (const cp of all) {
        if (['completed', 'failed', 'cancelled'].includes(cp.status)) {
          await kvDel(`cozanet:checkpoint:${cp.id}`);
          deleted++;
        }
      }
      res.status(200).json({ cleaned: deleted, remaining: all.length - deleted });
      return;
    }
  }

  // Fallback
  res.status(200).json({
    status: 'alive', version: 'v4-upgraded',
    message: 'CozanetOS Heartbeat v4. Endpoints: ?health=true, ?status=true, ?agents=true, ?task=<id>, POST {submit/cancel/remember/recall/cleanup}',
  });
}
