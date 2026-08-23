/**
 * CozanetOS Heartbeat v5 — Full Agent Engine
 *
 * Upgrades over v4:
 *  - Groq built-in tools: browser_search + code_interpreter (server-side)
 *  - GitHub function calling: create files, push code, create PRs
 *  - Tool-aware task routing (web tasks use search, code tasks use interpreter)
 *  - gpt-oss-120b as primary model (supports built-in tools)
 *  - Local function calling for GitHub operations
 *  - Structured output with tool results
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
    toolResults: any[];
  };
  submittedAt: number;
  taskDescription?: string;
  useBuiltInTools?: boolean;
  useGithubTools?: boolean;
  attachedFiles?: string[];
}

// ── Groq Key ─────────────────────────────────────────────────────────

function getGroqKey(): string {
  return process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1 || '';
}

// ── Redis ────────────────────────────────────────────────────────────

async function kvGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json(); return data.result ?? null;
  } catch { return null; }
}

async function kvSet(key: string, value: string, ttl?: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return;
  try {
    const pipeline: any[] = [['SET', key, value]];
    if (ttl) pipeline.push(['EXPIRE', key, ttl]);
    await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pipeline) });
  } catch {}
}

async function kvDel(key: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return;
  try { await fetch(`${url}/del/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } }); } catch {}
}

async function kvScan(pattern: string): Promise<string[]> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return [];
  try {
    const res = await fetch(`${url}/scan/0?match=${encodeURIComponent(pattern)}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json(); return data.result?.[1] ?? [];
  } catch { return []; }
}

// ── Memory ───────────────────────────────────────────────────────────

async function loadMemories(limit = 10): Promise<string[]> {
  const keys = await kvScan('cozanet:memory:*');
  const memories: string[] = [];
  for (const key of keys.sort().slice(-limit)) {
    const raw = await kvGet(key);
    if (raw) { try { const m = JSON.parse(raw); memories.push(`- [${m.category||'general'}] ${m.content}`); } catch { memories.push(`- ${raw}`); } }
  }
  return memories;
}

async function saveMemory(content: string, category: string): Promise<void> {
  await kvSet(`cozanet:memory:${Date.now()}:${Math.random().toString(36).slice(2,8)}`, JSON.stringify({ content, category, timestamp: Date.now() }), 604800);
}


// ── File Storage ────────────────────────────────────────────────────

async function saveFile(filename: string, content: string, taskId?: string): Promise<string> {
  const fileId = `cozanet:file:${Date.now()}:${filename}`;
  // Store in chunks if large (Redis has 1MB limit per key)
  const maxChunk = 500000; // 500KB per chunk
  if (content.length > maxChunk) {
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += maxChunk) {
      chunks.push(content.slice(i, i + maxChunk));
    }
    await kvSet(`${fileId}:meta`, JSON.stringify({ filename, size: content.length, chunks: chunks.length, taskId }), 86400);
    for (let i = 0; i < chunks.length; i++) {
      await kvSet(`${fileId}:chunk:${i}`, chunks[i], 86400);
    }
  } else {
    await kvSet(`${fileId}:meta`, JSON.stringify({ filename, size: content.length, chunks: 1, taskId }), 86400);
    await kvSet(`${fileId}:chunk:0`, content, 86400);
  }
  return fileId;
}

async function loadFile(fileId: string): Promise<{ filename: string; content: string; size: number } | null> {
  const metaRaw = await kvGet(`${fileId}:meta`);
  if (!metaRaw) return null;
  const meta = JSON.parse(metaRaw);
  let content = '';
  for (let i = 0; i < meta.chunks; i++) {
    const chunk = await kvGet(`${fileId}:chunk:${i}`);
    if (chunk) content += chunk;
  }
  return { filename: meta.filename, content, size: meta.size };
}

async function listFiles(): Promise<any[]> {
  const keys = await kvScan('cozanet:file:*:meta');
  const files: any[] = [];
  for (const key of keys) {
    const raw = await kvGet(key);
    if (raw) {
      try { files.push(JSON.parse(raw)); } catch {}
    }
  }
  return files;
}

// ── Checkpoints ──────────────────────────────────────────────


async function getAllCheckpoints(): Promise<Checkpoint[]> {
  const keys = await kvScan('cozanet:checkpoint:*');
  const results: Checkpoint[] = [];
  for (const key of keys) { const raw = await kvGet(key); if (raw) { try { results.push(JSON.parse(raw)); } catch {} } }
  return results;
}

async function getPausedCheckpoints(): Promise<Checkpoint[]> {
  return (await getAllCheckpoints()).filter(c => c.status === 'paused');
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await kvSet(`cozanet:checkpoint:${cp.id}`, JSON.stringify(cp), 86400);
}

// ── GitHub Tool Functions ───────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_ORG = process.env.GITHUB_ORG || 'CozanetOS';

// Tool definitions for Groq function calling
const GITHUB_TOOLS = [
  {
    type: "function",
    function: {
      name: "github_create_file",
      description: "Create or update a file in a GitHub repository. This pushes code directly to a repo.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository name (e.g. 'cozanet-os')" },
          path: { type: "string", description: "File path in the repo (e.g. 'src/index.ts')" },
          content: { type: "string", description: "The file content to write" },
          branch: { type: "string", description: "Branch name (default: main)", default: "main" },
          message: { type: "string", description: "Commit message" }
        },
        required: ["repo", "path", "content", "message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "github_read_file",
      description: "Read a file from a GitHub repository",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repository name" },
          path: { type: "string", description: "File path" },
          branch: { type: "string", description: "Branch (default: main)" }
        },
        required: ["repo", "path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "github_list_repos",
      description: "List repositories in the CozanetOS organization",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "github_create_branch",
      description: "Create a new branch in a repository",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          branch: { type: "string", description: "New branch name" },
          from: { type: "string", description: "Base branch (default: main)" }
        },
        required: ["repo", "branch"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "github_create_pr",
      description: "Create a pull request",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          head: { type: "string", description: "Source branch" },
          base: { type: "string", description: "Target branch (default: main)" }
        },
        required: ["repo", "title", "head"]
      }
    }
  }
];

// GitHub function executor
async function executeGithubFunction(name: string, args: any): Promise<string> {
  const headers: Record<string, string> = { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' };
  const base = `https://api.github.com/repos/${GITHUB_ORG}`;

  try {
    switch (name) {
      case 'github_create_file': {
        let { repo, path, content, branch = 'main', message } = args;
        // Get current file SHA if it exists
        const shaRes = await fetch(`${base}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`, { headers });
        let sha: string | undefined;
        if (shaRes.ok) { const shaData = await shaRes.json(); sha = shaData.sha; }
        const body = JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch, sha });
        let res = await fetch(`${base}/${repo}/contents/${encodeURIComponent(path)}`, { method: 'PUT', headers, body });
        let data = await res.json();
        if (!res.ok && (data.message?.includes('pull request') || data.message?.includes('protected'))) {
          // Branch protection — auto-create a feature branch
          const featBranch = `agent/${Date.now()}`;
          const refRes = await fetch(`${base}/${repo}/git/ref/heads/main`, { headers });
          if (refRes.ok) {
            const refData = await refRes.json();
            await fetch(`${base}/${repo}/git/refs`, { method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${featBranch}`, sha: refData.object.sha }) });
            const body2 = JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch: featBranch });
            res = await fetch(`${base}/${repo}/contents/${encodeURIComponent(path)}`, { method: 'PUT', headers, body: body2 });
            data = await res.json();
            if (res.ok) {
              const prRes = await fetch(`${base}/${repo}/pulls`, { method: 'POST', headers, body: JSON.stringify({ title: message, head: featBranch, base: 'main', body: 'Auto-generated by CozanetOS Agent' }) });
              const prData = await prRes.json();
              return `File pushed to branch ${featBranch} and PR created: ${prData.html_url || prData.number}`;
            }
          }
        }
        return res.ok ? `File pushed: ${path} in ${repo}@${branch} (commit: ${data.commit?.sha?.slice(0,7)})` : `Error: ${data.message}`;
      }
      case 'github_read_file': {
        const { repo, path, branch = 'main' } = args;
        const res = await fetch(`${base}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`, { headers });
        if (!res.ok) return `Error: file not found`;
        const data = await res.json();
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return content.slice(0, 4000); // Limit response size
      }
      case 'github_list_repos': {
        const res = await fetch(`https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=50`, { headers });
        const data = await res.json();
        return data.map((r: any) => `${r.name} (${r.language || '?'}, ${r.private ? 'private' : 'public'})`).join('\n');
      }
      case 'github_create_branch': {
        const { repo, branch, from = 'main' } = args;
        const refRes = await fetch(`${base}/${repo}/git/ref/heads/${from}`, { headers });
        if (!refRes.ok) return `Error: base branch ${from} not found`;
        const refData = await refRes.json();
        const sha = refData.object.sha;
        const res = await fetch(`${base}/${repo}/git/refs`, { method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
        const data = await res.json();
        return res.ok ? `Branch ${branch} created in ${repo} from ${from}` : `Error: ${data.message}`;
      }
      case 'github_create_pr': {
        const { repo, title, body = '', head, base = 'main' } = args;
        const res = await fetch(`${base}/${repo}/pulls`, { method: 'POST', headers, body: JSON.stringify({ title, body, head, base }) });
        const data = await res.json();
        return res.ok ? `PR #${data.number} created: ${data.html_url}` : `Error: ${data.message}`;
      }
      default:
        return `Unknown function: ${name}`;
    }
  } catch (err: any) {
    return `Execution error: ${err.message}`;
  }
}

// ── Agent Slice Runner ───────────────────────────────────────────────

async function runSlice(cp: Checkpoint): Promise<void> {
  const MAX_SLICE_MS = 8000;
  const startTime = Date.now();

  cp.status = 'running';
  cp.resumeCount++;
  cp.lastCheckpointAt = Date.now();
  await saveCheckpoint(cp);

  try {
    const model = 'openai/gpt-oss-120b';
    const taskDesc = cp.taskDescription || cp.taskType;

    if (cp.resumeCount === 1) {
      cp.agentState = { messages: [], phase: 'think', progress: 0, thoughts: [], actions: [], startedAt: Date.now(), toolResults: [] };
      cp.partialOutput = '';
    }

    const memories = await loadMemories(5);
    const memoryContext = memories.length > 0 ? `\n\n## Relevant Memories\n${memories.join('\n')}` : '';

    // Load attached files
    let fileContext = '';
    if (cp.attachedFiles && cp.attachedFiles.length > 0) {
      const fileContents: string[] = [];
      for (const fid of cp.attachedFiles) {
        const file = await loadFile(fid);
        if (file) fileContents.push(`### ${file.filename} (${file.size} bytes)\n\n\n${file.content.slice(0, 8000)}${file.content.length > 8000 ? '\n...[truncated]' : ''}`);
      }
      if (fileContents.length > 0) fileContext = `\n\n## Attached Files\n${fileContents.join('\n\n')}`;
    }

    // Build system prompt
    let systemPrompt = `You are CozanetOS AI Agent. You work in time-sliced chunks (max 8s per slice). You may be resumed multiple times. Always produce useful output.

## Current Context
- Task: ${taskDesc}
- Task type: ${cp.taskType}
- Slice #: ${cp.resumeCount}
- Phase: ${cp.agentState.phase}
- Progress: ${cp.agentState.progress}%
- Previous output length: ${cp.partialOutput.length} chars${memoryContext}

## Instructions
- If first slice, analyze and start working. If resuming, continue — don't repeat.
- Be concise but thorough. Output your work directly.
- End with "[DONE]" on a new line when the task is complete.
- When pushing code to GitHub, the agent automatically creates a branch and PR if the repo has branch protection.` + fileContext;

    // Build messages
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    for (const msg of cp.agentState.messages.slice(-8)) messages.push(msg);

    const userPrompt = cp.input.goal || cp.input.task || cp.input.description || JSON.stringify(cp.input);
    const continuationHint = cp.partialOutput ? `\n\n## Previous Output (continue from here — DO NOT repeat work already done)\n${cp.partialOutput.slice(-2000)}` : '';
    const toolHistory = cp.agentState.toolResults.length > 0
      ? `\n\n## Tool Results So Far\n${cp.agentState.toolResults.map((t,i) => `${i+1}. ${t.tool || t.type}: ${t.result} (${t.success ? 'SUCCESS' : 'FAILED'})`).join('\n')}\n\nIf a tool already succeeded, do NOT retry it. Provide your final answer.` : '';
    messages.push({ role: 'user', content: `${userPrompt}${continuationHint}${toolHistory}` });

    // Check time budget
    const remainingMs = startTime + MAX_SLICE_MS - Date.now();
    if (remainingMs <= 1000) { cp.status = 'paused'; cp.lastCheckpointAt = Date.now(); await saveCheckpoint(cp); return; }

    // Build request options
    const apiKey = getGroqKey();
    if (!apiKey) { cp.status = 'paused'; cp.lastError = 'no-groq-key'; cp.lastCheckpointAt = Date.now(); await saveCheckpoint(cp); return; }

    // Determine which tools to use
    const useBuiltInTools = cp.useBuiltInTools !== false; // Default true
    const useGithubTools = cp.useGithubTools !== false && GITHUB_TOKEN; // Default true if token exists

    // Determine if this task needs built-in tools
    const needsWebSearch = ['research', 'analyze', 'investigate', 'browse', 'study'].some(t => cp.taskType.includes(t));
    const needsCodeExec = ['code', 'build', 'calculate', 'compute', 'debug'].some(t => cp.taskType.includes(t));
    const needsGithub = ['github', 'push', 'deploy', 'commit', 'pr', 'repo'].some(t => cp.taskType.includes(t) || taskDesc.toLowerCase().includes(t));

    const requestBody: any = {
      model,
      messages,
      temperature: 0.7,
      max_tokens: 3000,
    };

    // Add built-in tools for gpt-oss-120b
    const builtInTools: any[] = [];
    if (useBuiltInTools && (needsWebSearch || needsCodeExec)) {
      if (needsWebSearch) builtInTools.push({ type: "browser_search" });
      if (needsCodeExec) builtInTools.push({ type: "code_interpreter" });
    }
    // Always allow both tools for general tasks (model decides)
    if (useBuiltInTools && builtInTools.length === 0 && cp.resumeCount === 1) {
      builtInTools.push({ type: "browser_search" }, { type: "code_interpreter" });
    }

    // Add GitHub function calling tools
    if (useGithubTools && (needsGithub || cp.resumeCount === 1)) {
      requestBody.tools = [...builtInTools, ...GITHUB_TOOLS];
    } else if (builtInTools.length > 0) {
      requestBody.tools = builtInTools;
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody),
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      cp.agentState.thoughts.push(`Error in slice ${cp.resumeCount}: ${res.status}`);
      cp.status = 'paused';
      cp.lastError = `groq-error:${res.status}`;
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      return;
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    let newOutput = msg?.content || '';
    const isComplete = newOutput.includes('[DONE]') || data.choices?.[0]?.finish_reason === 'stop';
    newOutput = newOutput.replace('[DONE]', '').trimEnd();

    // Handle function calls (GitHub operations)
    let toolSuccess = false;
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: newOutput, tool_calls: msg.tool_calls });
      for (const toolCall of msg.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs: any = {};
        try { fnArgs = JSON.parse(toolCall.function.arguments); } catch {}

        const result = await executeGithubFunction(fnName, fnArgs);
        const success = !result.startsWith('Error:');
        if (success) toolSuccess = true;
        cp.agentState.toolResults.push({ tool: fnName, args: fnArgs, result: result.slice(0, 500), success });
        cp.agentState.actions.push(`${fnName}(${JSON.stringify(fnArgs).slice(0, 100)}) -> ${result.slice(0, 200)}`);
        messages.push({ role: 'tool', tool_call_id: toolCall.id, name: fnName, content: result });
      }

      // If GitHub push succeeded, mark task complete — don't retry
      if (toolSuccess && (cp.taskType === 'build' || cp.taskType === 'push' || cp.taskType === 'deploy')) {
        const successMsg = cp.agentState.toolResults.filter(t => t.success).map(t => t.result).join('\n');
        cp.partialOutput += successMsg;
        cp.agentState.phase = 'done';
        cp.agentState.progress = 100;
        cp.status = 'completed';
        cp.lastCheckpointAt = Date.now();
        await saveCheckpoint(cp);
        await saveMemory(`Completed "${taskDesc}" — ${successMsg.slice(0, 200)}`, 'task-history');
        console.log(`[heartbeat] Task ${cp.id} completed after GitHub push (${cp.resumeCount} slices)`);
        return;
      }

      // Make a follow-up call with tool results
      requestBody.messages = messages;
      requestBody.max_tokens = 2000;
      const res2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
      });
      if (res2.ok) {
        const data2 = await res2.json();
        const msg2 = data2.choices?.[0]?.message;
        if (msg2?.content) {
          const content2 = msg2.content.replace('[DONE]', '').trimEnd();
          newOutput += '\n' + content2;
          if (data2.choices?.[0]?.finish_reason === 'stop' && toolSuccess) {
            // Model confirmed completion after tool use
            cp.agentState.phase = 'done';
            cp.agentState.progress = 100;
          }
        }
      }
    }

    // Check for built-in tool results (executed_tools from compound)
    if (msg?.executed_tools && msg.executed_tools.length > 0) {
      for (const tool of msg.executed_tools) {
        cp.agentState.toolResults.push({ type: tool.type, args: tool.arguments, result: str(tool.output).slice(0, 500) });
        cp.agentState.actions.push(`built-in:${tool.type}`);
      }
    }

    // Accumulate output
    if (cp.partialOutput && !cp.partialOutput.endsWith('\n')) cp.partialOutput += '\n';
    cp.partialOutput += newOutput;

    // Update conversation history
    cp.agentState.messages.push(
      { role: 'user', content: userPrompt + continuationHint },
      { role: 'assistant', content: newOutput },
    );

    // Phase progression
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
      await saveMemory(`Completed "${taskDesc}" (${cp.taskType}) — ${cp.partialOutput.slice(0, 200)}...`, 'task-history');
      console.log(`[heartbeat] Task ${cp.id} completed in ${elapsed}ms after ${cp.resumeCount} slices`);
    } else {
      cp.status = 'paused';
      cp.stepIndex++;
      cp.lastError = null;
      cp.lastCheckpointAt = Date.now();
      await saveCheckpoint(cp);
      console.log(`[heartbeat] Task ${cp.id} paused after ${elapsed}ms (slice ${cp.stepIndex})`);
    }
  } catch (err: any) {
    cp.status = 'paused';
    cp.lastError = err.message;
    cp.lastCheckpointAt = Date.now();
    await saveCheckpoint(cp);
  }
}

function str(v: any): string { return typeof v === 'string' ? v : JSON.stringify(v); }

// ── QStash ──────────────────────────────────────────────────────────

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
  } catch {}
}

// ── Handler ─────────────────────────────────────────────────────────

export default async function handler(req: { method?: string; body?: any; query?: any }, res: { status: (c: number) => { json: (d: any) => void }; json: (d: any) => void }): Promise<void> {
  const method = req.method || 'GET';

  if (method === 'GET' && req.query?.health === 'true') {
    res.status(200).json({
      status: 'alive', version: 'v5-agent', timestamp: Date.now(),
      hasRedis: !!process.env.UPSTASH_REDIS_URL,
      hasGroq: !!getGroqKey(),
      hasQStash: !!process.env.QSTASH_URL,
      hasGithub: !!GITHUB_TOKEN,
      githubOrg: GITHUB_ORG,
      builtInTools: ['browser_search', 'code_interpreter'],
      githubTools: GITHUB_TOOLS.map(t => t.function.name),
      fileUpload: true,
      maxFileSize: '5MB',
    });
    return;
  }

  if (method === 'GET' && req.query?.status === 'true') {
    const all = await getAllCheckpoints();
    res.status(200).json({
      total: all.length,
      active: all.filter(c => c.status === 'paused' || c.status === 'running').length,
      completed: all.filter(c => c.status === 'completed').length,
      tasks: all.map(c => ({
        id: c.id, taskType: c.taskType, description: c.taskDescription,
        status: c.status, step: c.stepIndex, resumeCount: c.resumeCount,
        progress: c.agentState?.progress || 0, phase: c.agentState?.phase || 'unknown',
        outputLength: c.partialOutput?.length || 0,
        toolResults: c.agentState?.toolResults?.length || 0,
      })),
    });
    return;
  }

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
        toolResults: task.agentState?.toolResults || [],
        resumeCount: task.resumeCount,
      });
    } else { res.status(404).json({ error: 'Task not found' }); }
    return;
  }

  if (method === 'POST' && req.body) {
    const body = req.body;

    if (body.submit) {
      const id = `ckpt:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;
      const cp: Checkpoint = {
        id, taskId: body.taskId || id,
        agentId: body.agentId || 'agent',
        taskType: body.taskType || 'think',
        input: body.input || body.description || {},
        attachedFiles: body.files || [],
        partialOutput: '', stepIndex: 0, status: 'pending',
        lastCheckpointAt: Date.now(), resumeCount: 0,
        maxResumes: body.maxResumes || 30, lastError: null,
        agentState: { messages: [], phase: 'think', progress: 0, thoughts: [], actions: [], startedAt: Date.now(), toolResults: [] },
        submittedAt: Date.now(),
        taskDescription: body.description || body.taskType || 'Unnamed task',
        useBuiltInTools: body.useBuiltInTools !== false,
        useGithubTools: body.useGithubTools !== false,
      };
      await saveCheckpoint(cp);
      await runSlice(cp);
      await scheduleNextPing();
      res.status(200).json({
        submitted: true, checkpointId: id,
        taskDescription: cp.taskDescription, maxResumes: cp.maxResumes,
        builtInTools: cp.useBuiltInTools,
        githubTools: cp.useGithubTools && !!GITHUB_TOKEN,
        message: 'Task started. Agent has web search, code execution, and GitHub push capabilities.',
      });
      return;
    }

    if (body.source === 'keepalive-auto' || body.source === 'manual-test' || body.source === 'keepalive') {
      const paused = await getPausedCheckpoints();
      if (paused.length === 0) {
        res.status(200).json({ hadWork: false, pendingCount: 0, message: 'No active tasks.' });
        return;
      }
      paused.sort((a, b) => a.lastCheckpointAt - b.lastCheckpointAt);
      const cp = paused[0];
      if (cp.resumeCount >= cp.maxResumes) {
        cp.status = 'failed'; cp.lastError = `Exceeded max (${cp.maxResumes})`;
        cp.lastCheckpointAt = Date.now(); await saveCheckpoint(cp);
        res.status(200).json({ hadWork: false, failed: cp.id, reason: cp.lastError });
        return;
      }
      await runSlice(cp);
      const stillPaused = await getPausedCheckpoints();
      if (stillPaused.length > 0) await scheduleNextPing();
      res.status(200).json({
        hadWork: true, checkpointId: cp.id, completed: cp.status === 'completed',
        status: cp.status, step: cp.stepIndex, resumeCount: cp.resumeCount,
        progress: cp.agentState?.progress || 0,
        outputPreview: cp.partialOutput?.slice(-200) || '',
        toolResults: cp.agentState?.toolResults || [],
        needsAnotherPing: stillPaused.length > 0, pendingCount: stillPaused.length,
      });
      return;
    }

    if (body.cancel) {
      const all = await getAllCheckpoints();
      const cp = all.find(c => c.id === body.cancel);
      if (cp) { cp.status = 'cancelled'; cp.lastError = 'Cancelled'; cp.lastCheckpointAt = Date.now(); await saveCheckpoint(cp); res.status(200).json({ cancelled: true, id: cp.id }); }
      else { res.status(404).json({ error: 'Not found' }); }
      return;
    }

    if (body.uploadFile) {
      const { filename, content, taskId } = body.uploadFile;
      if (!filename || !content) { res.status(400).json({ error: 'filename and content required' }); return; }
      const fileId = await saveFile(filename, content, taskId);
      res.status(200).json({ uploaded: true, fileId, filename, size: content.length });
      return;
    }
    if (body.listFiles) {
      const files = await listFiles();
      res.status(200).json({ files, count: files.length });
      return;
    }
    if (body.readFile) {
      const file = await loadFile(body.readFile);
      if (file) res.status(200).json(file);
      else res.status(404).json({ error: 'File not found' });
      return;
    }
    if (body.remember) { await saveMemory(body.remember, body.category || 'general'); res.status(200).json({ saved: true }); return; }
    if (body.recall) { const m = await loadMemories(body.limit || 20); res.status(200).json({ memories: m, count: m.length }); return; }
    if (body.cleanup) {
      const all = await getAllCheckpoints(); let deleted = 0;
      for (const cp of all) { if (['completed','failed','cancelled'].includes(cp.status)) { await kvDel(`cozanet:checkpoint:${cp.id}`); deleted++; } }
      res.status(200).json({ cleaned: deleted, remaining: all.length - deleted }); return;
    }
  }

  res.status(200).json({
    status: 'alive', version: 'v5-agent',
    message: 'CozanetOS Heartbeat v5. Capabilities: web search, code execution, GitHub push. Endpoints: ?health=true, ?status=true, ?task=<id>, POST {submit/cancel/remember/recall/cleanup}',
  });
}
