import * as https from 'https';
import * as http from 'http';
import { CallData, LogPayload, MatchedPattern } from '../types';

export interface LoggingServiceConfig {
  apiKey: string;
  environment: 'local' | 'production';
  silent: boolean;
}

export class LoggingService {
  private apiKey: string;
  private environment: 'local' | 'production';
  private silent: boolean;
  private apiEndpoint: string;

  constructor(config: LoggingServiceConfig) {
    this.apiKey = config.apiKey;
    this.environment = config.environment;
    this.silent = config.silent;

    // Set API endpoint based on environment
    this.apiEndpoint = this.environment === 'production'
      ? 'https://coolhand.io/api/v2/llm_request_logs'
      : 'http://localhost:3000/api/v2/llm_request_logs';
  }

  public async logRequestToAPI(callData: CallData, matchedPattern?: MatchedPattern): Promise<void> {
    const payload: LogPayload = {
      llm_request_log: {
        raw_request: callData
      }
    };

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(payload)
    };

    try {
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

        console.log(`📤 Sending to: ${this.apiEndpoint}`);
      }

      // Use fetch if available, otherwise use https/http
      if (typeof fetch !== 'undefined') {
        const response = await fetch(this.apiEndpoint, requestOptions);

        if (response.ok) {
          const result = await response.json() as any;
          this.log(`✅ Successfully logged to API with ID: ${result.id}`);
        } else {
          const errorText = await response.text();
          console.error(`❌ Failed to log to API: ${response.status} - ${errorText}`);
        }
      } else {
        // Fallback to using https/http modules
        await this.logWithHTTPS(payload);
      }

      if (!this.silent) {
        console.log('═'.repeat(60));
      }

    } catch (error) {
      console.error(`❌ Error logging to API:`, (error as Error).message);
    }
  }

  private async logWithHTTPS(payload: LogPayload): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.apiEndpoint);
      const postData = JSON.stringify(payload);

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-API-Key': this.apiKey
        }
      };

      const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            this.log(`✅ Successfully logged to API`);
            resolve();
          } else {
            console.error(`❌ Failed to log to API: ${res.statusCode} - ${data}`);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  private log(...args: any[]): void {
    if (!this.silent) {
      console.log(...args);
    }
  }

  public getApiEndpoint(): string {
    return this.apiEndpoint;
  }

  public getEnvironment(): string {
    return this.environment;
  }
}