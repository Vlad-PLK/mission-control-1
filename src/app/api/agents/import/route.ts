import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run, transaction } from '@/lib/db';
import type { Agent } from '@/lib/types';

interface ImportAgentRequest {
  gateway_agent_id: string;
  name: string;
  model?: string;
  workspace_id?: string;
}

interface ImportRequest {
  agents: ImportAgentRequest[];
}

// POST /api/agents/import - Import one or more agents from the OpenClaw Gateway
// Multi-workspace semantics:
// - A gateway agent (gateway_agent_id) is imported ONCE into the agents table (canonical identity)
// - Then it can be linked into many workspaces via workspace_agents
export async function POST(request: NextRequest) {
  try {
    const body: ImportRequest = await request.json();

    if (!body.agents || !Array.isArray(body.agents) || body.agents.length === 0) {
      return NextResponse.json(
        { error: 'At least one agent is required in the agents array' },
        { status: 400 }
      );
    }

    // Validate each agent
    for (const agentReq of body.agents) {
      if (!agentReq.gateway_agent_id || !agentReq.name) {
        return NextResponse.json(
          { error: 'Each agent must have gateway_agent_id and name' },
          { status: 400 }
        );
      }
    }

    // Load existing canonical gateway agents
    const existingAgents = queryAll<Agent>(
      `SELECT * FROM agents WHERE gateway_agent_id IS NOT NULL`
    );
    const existingByGatewayId = new Map(existingAgents.map((a) => [a.gateway_agent_id!, a]));

    const results: {
      imported: Agent[];
      skipped: { gateway_agent_id: string; reason: string }[];
    } = {
      imported: [],
      skipped: [],
    };

    transaction(() => {
      const now = new Date().toISOString();

      for (const agentReq of body.agents) {
        const workspaceId = agentReq.workspace_id || 'default';

        // 1) Get or create canonical agent row
        let agent = existingByGatewayId.get(agentReq.gateway_agent_id);
        let agentId: string;
        let created = false;

        if (!agent) {
          created = true;
          agentId = uuidv4();

          run(
            `INSERT INTO agents (id, name, role, description, avatar_emoji, is_master, workspace_id, model, source, gateway_agent_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              agentId,
              agentReq.name,
              'Imported Agent',
              `Imported from OpenClaw Gateway (${agentReq.gateway_agent_id})`,
              '🔗',
              0,
              workspaceId, // legacy field
              agentReq.model || null,
              'gateway',
              agentReq.gateway_agent_id,
              now,
              now,
            ]
          );

          // Log event only when the canonical agent is created
          run(
            `INSERT INTO events (id, type, agent_id, message, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), 'agent_joined', agentId, `${agentReq.name} imported from OpenClaw Gateway`, now]
          );

          agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agentId]);
          if (agent) {
            existingByGatewayId.set(agentReq.gateway_agent_id, agent);
          }
        } else {
          agentId = agent.id;
        }

        if (!agent) {
          results.skipped.push({
            gateway_agent_id: agentReq.gateway_agent_id,
            reason: 'Failed to create or load agent',
          });
          continue;
        }

        // 2) Link agent to workspace (many-to-many)
        const linkRes = run(
          `INSERT OR IGNORE INTO workspace_agents (workspace_id, agent_id) VALUES (?, ?)`,
          [workspaceId, agentId]
        );

        if (created || linkRes.changes > 0) {
          // Return the canonical agent row
          results.imported.push(agent);
        } else {
          results.skipped.push({
            gateway_agent_id: agentReq.gateway_agent_id,
            reason: 'Already in workspace',
          });
        }
      }
    });

    return NextResponse.json(results, { status: 201 });
  } catch (error) {
    console.error('Failed to import agents:', error);
    return NextResponse.json(
      { error: 'Failed to import agents' },
      { status: 500 }
    );
  }
}
