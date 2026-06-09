import { CoolhandCallData, CoolhandLogPayload, CoolhandLogResponse, CoolhandMatchedPattern } from '../types';
import { CollectionMethod } from '../utils/collector.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface LoggingServiceConfig extends BaseServiceConfig {}

export class LoggingService extends BaseService {
  constructor(config: LoggingServiceConfig) {
    super(config, '/api/v2/llm_request_logs');
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