const https = require('https');
const http = require('http');

class Coolhand {
    constructor(options = {}) {
        this.callCounter = 0;
        this.interceptedCalls = 0;

        // Configuration options
        this.silent = options.silent !== false;
        this.environment = options.environment || 'production';
        this.apiKey = options.apiKey;
        
        // Set API endpoint based on environment
        this.apiEndpoint = this.environment === 'production' 
            ? 'https://coolhandlabs.com/api/v2/llm_request_logs'
            : 'http://localhost:3000/api/v2/llm_request_logs';

        if (!this.apiKey) {
            console.error('❌ API key is required for logging. Pass it in options.apiKey');
            throw new Error('API key is required');
        }

        if (!this.silent) {
            console.log('🔍 Setting up Coolhand...');
            console.log(`🌍 Environment: ${this.environment}`);
            console.log(`🎯 API Endpoint: ${this.apiEndpoint}`);
        }
        
        this.setupMonitoring();
        
        if (!this.silent) {
            console.log('✅ Coolhand ready - will log to API');
        }
    }

    log(...args) {
        if (!this.silent) {
            console.log(...args);
        }
    }

    setupMonitoring() {
        // Patch HTTPS
        this.patchHTTPS();

        // Patch HTTP (some libraries might use HTTP with upgrade)
        this.patchHTTP();

        // Patch fetch if available (Node 18+)
        this.patchFetch();

        // Debug: Log when any request happens
        this.log('📡 Monitoring all outbound requests...');
    }

    patchHTTPS() {
        const originalRequest = https.request;
        const originalGet = https.get;
        const monitor = this;

        https.request = function(options, callback) {
            monitor.debugRequest('HTTPS REQUEST', options);

            // Check if this is an OpenAI call
            const isOpenAI = monitor.isOpenAICall(options);

            if (isOpenAI) {
                monitor.log('🎯 INTERCEPTING OpenAI HTTPS call');
                return monitor.interceptRequest(originalRequest, options, callback, 'https');
            }

            return originalRequest.call(this, options, callback);
        };

        https.get = function(options, callback) {
            monitor.debugRequest('HTTPS GET', options);
            const isOpenAI = monitor.isOpenAICall(options);

            if (isOpenAI) {
                monitor.log('🎯 INTERCEPTING OpenAI HTTPS GET');
                return monitor.interceptRequest(originalRequest, options, callback, 'https');
            }

            return originalGet.call(this, options, callback);
        };
    }

    patchHTTP() {
        const originalRequest = http.request;
        const originalGet = http.get;
        const monitor = this;

        http.request = function(options, callback) {
            monitor.debugRequest('HTTP REQUEST', options);
            const isOpenAI = monitor.isOpenAICall(options);

            if (isOpenAI) {
                monitor.log('🎯 INTERCEPTING OpenAI HTTP call');
                return monitor.interceptRequest(originalRequest, options, callback, 'http');
            }

            return originalRequest.call(this, options, callback);
        };

        http.get = function(options, callback) {
            monitor.debugRequest('HTTP GET', options);
            const isOpenAI = monitor.isOpenAICall(options);

            if (isOpenAI) {
                monitor.log('🎯 INTERCEPTING OpenAI HTTP GET');
                return monitor.interceptRequest(originalRequest, options, callback, 'http');
            }

            return originalGet.call(this, options, callback);
        };
    }

    patchFetch() {
        if (typeof globalThis.fetch === 'function') {
            const originalFetch = globalThis.fetch;
            const monitor = this;

            globalThis.fetch = async function(url, options = {}) {
                const urlStr = typeof url === 'string' ? url : url.toString();

                monitor.debugRequest('FETCH', { url: urlStr, ...options });

                if (urlStr.includes('openai.com')) {
                    monitor.log('🎯 INTERCEPTING OpenAI FETCH call');
                    return monitor.interceptFetch(originalFetch, url, options);
                }

                return originalFetch.call(this, url, options);
            };
        }
    }

    isOpenAICall(options) {
        if (typeof options === 'string') {
            return options.includes('openai.com');
        }

        const hostname = options.hostname || options.host || '';
        const href = options.href || '';
        const path = options.path || '';

        return hostname.includes('openai.com') ||
               href.includes('openai.com') ||
               path.includes('openai.com');
    }

    debugRequest(type, options) {
        const hostname = options.hostname || options.host || options.url || 'unknown';
        this.log(`🌐 ${type} to: ${hostname}`);

        // Count all requests
        this.callCounter++;
    }

    interceptRequest(originalRequest, options, callback, protocol) {
        this.interceptedCalls++;

        const url = this.buildURL(options, protocol);

        const callData = {
            id: this.interceptedCalls,
            timestamp: new Date().toISOString(),
            method: options.method || 'GET',
            url: url,
            headers: this.sanitizeHeaders(options.headers || {}),
            request_body: null,
            response_body: null,
            response_headers: null,
            status_code: null,
            protocol: protocol
        };

        this.log(`📞 Starting API call #${callData.id} to ${url}`);

        let requestBody = '';

        const req = originalRequest.call(protocol === 'https' ? https : http, options, (res) => {
            this.log(`📥 Response received for call #${callData.id}, status: ${res.statusCode}`);

            let responseBody = '';

            res.on('data', (chunk) => {
                responseBody += chunk.toString();
            });

            res.on('end', () => {
                callData.response_body = this.parseJSON(responseBody);
                callData.response_headers = this.sanitizeHeaders(res.headers);
                callData.status_code = res.statusCode;

                this.logCallToAPI(callData);
            });

            if (callback) callback(res);
        });

        // Intercept request body
        const originalWrite = req.write.bind(req);
        const originalEnd = req.end.bind(req);

        req.write = function(chunk, encoding) {
            if (chunk) {
                requestBody += chunk.toString();
            }
            return originalWrite(chunk, encoding);
        };

        req.end = function(chunk, encoding) {
            if (chunk) {
                requestBody += chunk.toString();
            }
            callData.request_body = this.parseJSON(requestBody);
            this.log(`📤 Request complete for call #${callData.id}`);
            return originalEnd(chunk, encoding);
        }.bind(this);

        req.on('error', (err) => {
            this.log(`❌ Request error for call #${callData.id}:`, err.message);
        });

        return req;
    }

    async interceptFetch(originalFetch, url, options) {
        this.interceptedCalls++;

        const callData = {
            id: this.interceptedCalls,
            timestamp: new Date().toISOString(),
            method: options.method || 'GET',
            url: url.toString(),
            headers: this.sanitizeHeaders(options.headers || {}),
            request_body: options.body ? this.parseJSON(options.body) : null,
            response_body: null,
            response_headers: null,
            status_code: null,
            protocol: 'fetch'
        };

        this.log(`📞 Starting FETCH call #${callData.id} to ${url}`);

        try {
            const response = await originalFetch.call(globalThis, url, options);

            callData.status_code = response.status;
            callData.response_headers = Object.fromEntries(response.headers.entries());

            // Clone response to read body without consuming it
            const responseClone = response.clone();
            const responseText = await responseClone.text();
            callData.response_body = this.parseJSON(responseText);

            this.logCallToAPI(callData);

            return response;
        } catch (error) {
            this.log(`❌ Fetch error for call #${callData.id}:`, error.message);
            throw error;
        }
    }

    buildURL(options, protocol) {
        if (options.href) return options.href;

        const hostname = options.hostname || options.host || 'unknown';
        const path = options.path || '/';
        const port = options.port ? `:${options.port}` : '';

        return `${protocol}://${hostname}${port}${path}`;
    }

    sanitizeHeaders(headers) {
        const sanitized = { ...headers };

        if (sanitized.authorization) {
            sanitized.authorization = sanitized.authorization.replace(/Bearer .+/, 'Bearer [REDACTED]');
        }
        if (sanitized['openai-api-key']) {
            sanitized['openai-api-key'] = '[REDACTED]';
        }
        if (sanitized['api-key']) {
            sanitized['api-key'] = '[REDACTED]';
        }

        return sanitized;
    }

    parseJSON(str) {
        if (!str) return null;
        try {
            return JSON.parse(str);
        } catch {
            return str;
        }
    }

    async logCallToAPI(callData) {
        const payload = {
            llm_request_log: {
                raw_request: callData
            }
        };

        const requestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.apiKey
            },
            body: JSON.stringify(payload)
        };

        try {
            if (!this.silent) {
                console.log(`\n🎉 LOGGING OpenAI API Call #${callData.id}`);
                console.log(`🕐 Time: ${callData.timestamp}`);
                console.log(`🎯 ${callData.method} ${callData.url}`);
                console.log(`📊 Status: ${callData.status_code}`);
                console.log(`🔧 Protocol: ${callData.protocol}`);

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
                    const result = await response.json();
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
            console.error(`❌ Error logging to API:`, error.message);
        }
    }

    async logWithHTTPS(payload) {
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
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        this.log(`✅ Successfully logged to API`);
                        resolve(data);
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

    getStats() {
        return {
            totalRequests: this.callCounter,
            interceptedCalls: this.interceptedCalls,
            environment: this.environment,
            apiEndpoint: this.apiEndpoint
        };
    }
}

module.exports = Coolhand;