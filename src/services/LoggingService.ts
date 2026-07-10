import { CoolhandCallData, CoolhandLogPayload, CoolhandLogResponse, CoolhandMatchedPattern, LastSyncResponse } from '../types';
import { CollectionMethod } from '../utils/collector.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface LoggingServiceConfig extends BaseServiceConfig {}

export class LoggingService extends BaseService {
  constructor(config: LoggingServiceConfig) {
    super(config, '/api/v2/llm_request_logs');
  }

  /**
   * Ask the server for the timestamp of the most recent log it already holds for a given collector,
   * so a caller (e.g. coolhand-cli `capture-sessions`) only re-scans files newer than that. This is a
   * server-authoritative cutoff that survives local state-file loss or a reinstall.
   *
   * It NEVER throws: any problem (bad url, 404, network failure, non-JSON body, or a missing/invalid
   * `last_created_at`) returns `null` so the caller can fall back to local state. The companion server
   * endpoint may not exist on every deployment; a 404 is therefore an expected, non-fatal outcome.
   *
   * Auth mirrors the ingest path: the public `apiKey` sent as `X-API-Key`, since the endpoint lives on
   * the same `/api/v2/llm_request_logs` path.
   *
   * @param collector Identifies the submission source in the server's `collector` field. The caller
   *   owns this value (e.g. coolhand-cli passes `"coolhand-cli/claude-code"`).
   * @returns The cutoff `Date`, or `null` when no usable value is available.
   */
  public async fetchLastSync(collector: string): Promise<Date | null> {
    let url: string;
    try {
      const endpoint = new URL(`${this.apiEndpoint}/last_sync`);
      endpoint.searchParams.set('collector', collector);
      url = endpoint.toString();
    } catch {
      return null;
    }

    if (typeof fetch === 'undefined') {
      // No global fetch (Node.js < 18): degrade to local state rather than throw.
      return null;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-API-Key': this.apiKey },
      });
    } catch {
      // Network failure: degrade to local state.
      return null;
    }
    if (!res.ok) {
      // 404 (endpoint not built yet) or any other non-2xx: degrade to local state.
      return null;
    }

    let body: LastSyncResponse;
    try {
      body = (await res.json()) as LastSyncResponse;
    } catch {
      return null;
    }

    if (typeof body.last_created_at !== 'string') {
      return null;
    }
    const date = new Date(body.last_created_at);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  public async logRequestToAPI(
    callData: CoolhandCallData,
    matchedPattern?: CoolhandMatchedPattern,
    collectionMethod?: CollectionMethod,
    collector?: string
  ): Promise<CoolhandLogResponse | null> {
    // An explicit collector string (e.g. from coolhand-cli) overrides the SDK-derived one.
    const logData = collector !== undefined
      ? { raw_request: callData, collector }
      : this.addCollectorToData({ raw_request: callData }, collectionMethod);

    const payload: CoolhandLogPayload = {
      llm_request_log: logData
    };

    this.logRequestInfo(callData, matchedPattern);

    const result = await this.sendRequest<CoolhandLogResponse>(
      payload,
      `✅ Successfully logged to API with ID for call #${callData.id}`
    );

    this.logSeparator();

    return result;
  }

  private logRequestInfo(callData: CoolhandCallData, matchedPattern?: CoolhandMatchedPattern): void {
    if (!this.silent) {
      const apiName = matchedPattern?.pattern.name || 'API';
      console.log(`\n🎉 LOGGING ${apiName} API Call #${callData.id}`);
      console.log(`🕐 Time: ${callData.timestamp}`);
      console.log(`🎯 ${callData.method} ${callData.url}`);
      console.log(`📊 Status: ${callData.status_code}`);
      console.log(`🔧 Protocol: ${callData.protocol}`);
      if (matchedPattern) {
        console.log(`🔍 Matched by: ${matchedPattern.matchType} (${matchedPattern.matchValue})`);
      }

      if (callData.request_body?.model) {
        console.log(`🤖 Model: ${callData.request_body.model}`);
      }

      if (callData.request_body?.messages) {
        console.log(`💬 Messages: ${callData.request_body.messages.length}`);
      }

      if (callData.request_body?.temperature !== undefined) {
        console.log(`🌡️  Temperature: ${callData.request_body.temperature}`);
      }

      if (this.dryRun) {
        console.log(`🚫 DRY RUN: API call will be skipped`);
      } else {
        console.log(`📤 Sending to: ${this.apiEndpoint}`);
      }
    }
  }

}