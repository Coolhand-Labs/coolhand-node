import * as https from 'https';
import * as http from 'http';
import { getCollectorString, CollectionMethod } from '../utils/collector.js';

export interface BaseServiceConfig {
  apiKey: string;
  silent: boolean;
}

export abstract class BaseService {
  protected apiKey: string;
  protected silent: boolean;
  protected apiEndpoint: string;

  constructor(config: BaseServiceConfig, endpoint: string) {
    this.apiKey = config.apiKey;
    this.silent = config.silent;
    this.apiEndpoint = endpoint;
  }

  protected createRequestOptions(payload: any): RequestInit {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(payload)
    };
  }

  protected addCollectorToData<T extends Record<string, any>>(
    data: T,
    collectionMethod?: CollectionMethod
  ): T & { collector: string } {
    return {
      ...data,
      collector: getCollectorString(collectionMethod)
    };
  }

  protected async sendRequest<T>(payload: any, successMessage: string): Promise<T | null> {
    const requestOptions = this.createRequestOptions(payload);

    try {
      if (typeof fetch !== 'undefined') {
        const response = await fetch(this.apiEndpoint, requestOptions);

        if (response.ok) {
          const result = await response.json() as T;
          this.log(successMessage);
          return result;
        } else {
          const errorText = await response.text();
          console.error(`❌ Request failed: ${response.status} - ${errorText}`);
          return null;
        }
      } else {
        // Fallback to using https/http modules
        await this.sendWithHTTPS(payload);
        this.log(successMessage);
        return null; // HTTPS fallback doesn't return parsed response
      }
    } catch (error) {
      console.error(`❌ Request error:`, (error as Error).message);
      return null;
    }
  }

  private async sendWithHTTPS(payload: any): Promise<void> {
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
            resolve();
          } else {
            console.error(`❌ Request failed: ${res.statusCode} - ${data}`);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  protected log(...args: any[]): void {
    if (!this.silent) {
      console.log(...args);
    }
  }

  protected logSeparator(): void {
    if (!this.silent) {
      console.log('═'.repeat(60));
    }
  }

  public getApiEndpoint(): string {
    return this.apiEndpoint;
  }
}