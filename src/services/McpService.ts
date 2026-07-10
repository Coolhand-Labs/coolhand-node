import { McpToolCallResponse } from '../types.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface McpServiceConfig extends BaseServiceConfig {}

/**
 * Thrown on a non-2xx `/mcp` response. Carries the HTTP `status` so callers can react to it
 * (e.g. the CLI adds a re-authentication hint on 401) without parsing the message string.
 */
class McpHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'McpHttpError';
  }
}

/**
 * Calls the Coolhand server's `/mcp` endpoint, which speaks JSON-RPC 2.0. Used by coolhand-cli's
 * optimization commands (list-workloads, search/get/close/update-optimization) to invoke server-side
 * MCP tools.
 *
 * Unlike logging/feedback, this endpoint authenticates with the client's PRIVATE key (passed as the
 * `apiKey` config field and sent as `X-API-Key`), and it surfaces failures by THROWING rather than
 * returning `null`, so callers can show the error to the user. `dryRun: true` still applies here —
 * it skips the request and returns `null`, since some MCP tools (e.g. `close_optimization`) mutate
 * server state.
 */
export class McpService extends BaseService {
  constructor(config: McpServiceConfig) {
    super(config, '/mcp');
  }

  /**
   * Invoke a server-side MCP tool by name and return its `result` payload.
   *
   * @param toolName The MCP tool to call (e.g. `"list_workloads"`).
   * @param args The tool arguments object, forwarded verbatim as JSON-RPC `params.arguments`.
   * @returns The JSON-RPC `result` field on success, or `null` in dry-run mode.
   * @throws Error on network failure, a non-JSON body, or a JSON-RPC `error`. A non-2xx response
   *   throws an error whose `status` property holds the HTTP status code.
   */
  public async mcpCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };

    if (this.dryRun) {
      if (!this.silent) {
        console.log(`🚫 DRY RUN: Skipping MCP call to ${this.apiEndpoint}`);
        console.log(`🚫 DRY RUN: Would send:`, JSON.stringify(body, null, 2));
      }
      return null;
    }

    if (typeof fetch === 'undefined') {
      throw new Error('MCP request failed: global fetch is unavailable (requires Node.js 18+)');
    }

    let res: Response;
    try {
      res = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`MCP request failed: ${(err as Error).message}`);
    }

    const text = await res.text().catch(() => '');
    const snippet = text.slice(0, 2000);
    if (!res.ok) {
      throw new McpHttpError(`MCP request failed (${res.status}): ${snippet}`, res.status);
    }

    let json: McpToolCallResponse;
    try {
      json = JSON.parse(text) as McpToolCallResponse;
    } catch {
      throw new Error(`MCP response was not valid JSON: ${snippet}`);
    }

    if (json.error) {
      throw new Error(`MCP error: ${json.error.message ?? JSON.stringify(json.error)}`);
    }

    // A tool can reject at the execution level (e.g. "Cannot rename system workloads") while the
    // JSON-RPC envelope still reports success. The backend returns that as a `{ error }` result hash.
    if (json.result !== null && typeof json.result === 'object' && !Array.isArray(json.result)) {
      const result = json.result as { error?: unknown };
      if (typeof result.error === 'string' && result.error.length > 0) {
        throw new Error(result.error);
      }
    }

    return json.result;
  }
}
