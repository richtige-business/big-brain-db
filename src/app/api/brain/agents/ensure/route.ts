// ============================================================
// /api/brain/agents/ensure - Agent brain lifecycle
//
// Ensures scoped agent brain spaces exist and refreshes their
// durable-knowledge scaffolding pages (with change detection).
// ============================================================

import { NextResponse } from 'next/server';
import { ensureBrainSpace, listBrainSpaces, LOCAL_USER_ID } from '@/lib/server/brain-db';
import { DEFAULT_AGENT_BRAIN_PROFILES, syncAgentBrainKnowledgeSpaces } from '@/lib/server/agent-brain-ingestion';

export const runtime = 'nodejs';

interface AgentBrainInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  type?: unknown;
}

interface NormalizedAgent {
  id: string;
  name: string;
  description: string;
  type: string;
}

function normalizeAgent(input: AgentBrainInput): NormalizedAgent | null {
  const rawId = typeof input.id === 'string' ? input.id.trim() : '';
  const id = rawId === 'master' ? 'brain' : rawId;
  if (!id) return null;
  const defaultName = id === 'brain' ? 'Big Brain' : id;
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : defaultName;
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const type = typeof input.type === 'string' ? input.type.trim() : 'agent';
  return { id, name, description, type };
}

export async function GET() {
  try {
    await syncAgentBrainKnowledgeSpaces(DEFAULT_AGENT_BRAIN_PROFILES, { userId: LOCAL_USER_ID });
    const spaces = (await listBrainSpaces({ userId: LOCAL_USER_ID, scopeType: 'agent', limit: 500 })).filter(
      (space) => space.scopeId !== 'master' && space.scopeId !== 'brain'
    );

    return NextResponse.json({ success: true, count: spaces.length, spaces });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'AGENT_BRAIN_LIST_FAILED',
        message: error instanceof Error ? error.message : 'Agent brains could not be loaded.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const agents: AgentBrainInput[] = Array.isArray(body?.agents) ? body.agents : [];
    const normalized: NormalizedAgent[] = agents
      .map((agent) => normalizeAgent(agent))
      .filter((agent): agent is NormalizedAgent => Boolean(agent));

    const uniqueAgents = Array.from(
      normalized.reduce((map, agent) => map.set(agent.id, agent), new Map<string, NormalizedAgent>()).values()
    );

    const spaces = await Promise.all(
      uniqueAgents.map((agent) =>
        ensureBrainSpace({
          userId: LOCAL_USER_ID,
          scopeType: 'agent',
          scopeId: agent.id,
          name: `${agent.name} Brain`,
          description: agent.description || `Big Brain space for ${agent.name}`,
          metadata: { agentId: agent.id, agentName: agent.name, agentType: agent.type, ensuredBy: 'agent-lifecycle' },
        })
      )
    );

    const ingestResult = await syncAgentBrainKnowledgeSpaces(uniqueAgents, { userId: LOCAL_USER_ID });

    return NextResponse.json({
      success: true,
      count: spaces.length,
      spaces,
      ingestedBrains: ingestResult.count,
      changedDocuments: ingestResult.synced.reduce((sum, entry) => sum + entry.changedDocuments, 0),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'AGENT_BRAIN_ENSURE_FAILED',
        message: error instanceof Error ? error.message : 'Agent brains could not be created.',
      },
      { status: 500 }
    );
  }
}
