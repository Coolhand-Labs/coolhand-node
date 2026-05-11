import { CoolhandCallData, CoolhandLogPayload, CoolhandMatchedPattern } from '../types';
import { CollectionMethod } from '../utils/collector.js';
import { BaseService, BaseServiceConfig } from './BaseService.js';

export interface LoggingServiceConfig extends BaseServiceConfig {
  baseUrl?: string;
}

export class LoggingService extends BaseService {
  constructor(config: LoggingServiceConfig) {
    super(config, BaseService.resolveBaseUrl(config.baseUrl) + '/api/v2/llm_request_logs');
  }

  public async logRequestToAPI(callData: CoolhandCallData, matchedPattern?: CoolhandMatchedPattern, collectionMethod?: CollectionMethod): Promise<void> {
    const logData = this.addCollectorToData({ raw_request: callData }, collectionMethod);

    const payload: CoolhandLogPayload = {
      llm_request_log: logData
    };

    this.logRequestInfo(callData, matchedPattern);

    await this.sendRequest(
      payload,
      `✅ Successfully logged to API with ID for call #${callData.id}`
    );

    this.logSeparator();
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

      if (this.debug) {
        console.log(`🐛 DEBUG MODE: Will skip API call`);
      } else {
        console.log(`📤 Sending to: ${this.apiEndpoint}`);
      }
    }
  }

}