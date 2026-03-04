// Helpers for converting Mission Control's stored openclaw_session_id into Gateway session keys.

/**
 * Mission Control historically stores `openclaw_session_id` as the suffix used in session keys
 * for main-agent messaging: `agent:main:${openclaw_session_id}`.
 *
 * Some callers may already provide a full session key (e.g. sub-agent keys).
 */
export function toGatewaySessionKey(openclawSessionIdOrKey: string): string {
  if (!openclawSessionIdOrKey) return openclawSessionIdOrKey;
  if (openclawSessionIdOrKey.startsWith('agent:')) return openclawSessionIdOrKey;
  return `agent:main:${openclawSessionIdOrKey}`;
}
