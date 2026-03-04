import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import type { Agent, DiscoveredAgent } from '@/lib/types';

// This route must always be dynamic - it queries live Gateway state + DB
export const dynamic = 'force-dynamic';

// Shape of an agent returned by the OpenClaw Gateway `agents.list` call
interface GatewayAgent {
  id?: string;
  name?: string;
  label?: string;
  model?: string;
  channel?: string;
  status?: string;
  [key: string]: unknown;
}

// GET /api/agents/discover - Discover existing agents from the OpenClaw Gateway
// Multi-workspace semantics:
// - A gateway agent can be imported once globally (canonical Agent row)
// - Then linked into multiple workspaces via workspace_agents
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id') || 'default';

    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json(
          { error: 'Failed to connect to OpenClaw Gateway. Is it running?' },
          { status: 503 }
        );
      }
    }

    let gatewayAgents: GatewayAgent[];
    try {
      gatewayAgents = (await client.listAgents()) as GatewayAgent[];
    } catch (err) {
      console.error('Failed to list agents from Gateway:', err);
      return NextResponse.json(
        { error: 'Failed to list agents from OpenClaw Gateway' },
        { status: 502 }
      );
    }

    if (!Array.isArray(gatewayAgents)) {
      return NextResponse.json(
        { error: 'Unexpected response from Gateway agents.list' },
        { status: 502 }
      );
    }

    // Canonical imported agents (global)
    const existingAgents = queryAll<Agent>(
      `SELECT * FROM agents WHERE gateway_agent_id IS NOT NULL`
    );
    const importedGatewayIds = new Map(
      existingAgents.map((a) => [a.gateway_agent_id!, a.id])
    );

    // Which gateway agents are already linked into this workspace
    const linkedGatewayIds = new Set(
      queryAll<{ gateway_agent_id: string }>(
        `SELECT a.gateway_agent_id as gateway_agent_id
         FROM agents a
         JOIN workspace_agents wa ON wa.agent_id = a.id
         WHERE wa.workspace_id = ?
           AND a.gateway_agent_id IS NOT NULL`,
        [workspaceId]
      ).map((r) => r.gateway_agent_id)
    );

    // Map gateway agents to our DiscoveredAgent type
    const discovered: DiscoveredAgent[] = gatewayAgents.map((ga) => {
      const gatewayId = ga.id || ga.name || '';
      const alreadyImportedGlobally = importedGatewayIds.has(gatewayId);
      const alreadyInWorkspace = linkedGatewayIds.has(gatewayId);

      return {
        id: gatewayId,
        name: ga.name || ga.label || gatewayId,
        label: ga.label,
        model: ga.model,
        channel: ga.channel,
        status: ga.status,

        // Back-compat: in the UI, "already_imported" is used to disable selection.
        // With multi-workspace support, we only disable if it's already linked to THIS workspace.
        already_imported: alreadyInWorkspace,
        already_imported_globally: alreadyImportedGlobally,
        already_in_workspace: alreadyInWorkspace,

        existing_agent_id: alreadyImportedGlobally ? importedGatewayIds.get(gatewayId) : undefined,
      };
    });

    return NextResponse.json({
      agents: discovered,
      total: discovered.length,
      already_in_workspace: discovered.filter((a) => a.already_in_workspace).length,
      already_imported_globally: discovered.filter((a) => a.already_imported_globally).length,
    });
  } catch (error) {
    console.error('Failed to discover agents:', error);
    return NextResponse.json(
      { error: 'Failed to discover agents from Gateway' },
      { status: 500 }
    );
  }
}
