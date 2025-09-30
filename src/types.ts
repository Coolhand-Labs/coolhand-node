export interface CoolhandOptions {
  apiKey: string;
  environment?: 'local' | 'production';
  silent?: boolean;
}

export interface CallData {
  id: number;
  timestamp: string;
  method: string;
  url: string;
  headers: Record<string, any>;
  request_body: any;
  response_body: any;
  response_headers: Record<string, any> | null;
  status_code: number | null;
  protocol: string;
}

export interface Stats {
  totalRequests: number;
  interceptedCalls: number;
  environment: string;
  apiEndpoint: string;
}

export interface RequestOptions {
  hostname?: string;
  host?: string;
  port?: number;
  path?: string;
  method?: string;
  headers?: Record<string, any>;
  href?: string;
  url?: string;
}

export interface LogPayload {
  llm_request_log: {
    raw_request: CallData;
  };
}