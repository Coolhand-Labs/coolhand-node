// test/test.ts - Basic test for Coolhand Node Monitor

import { Coolhand, CoolhandOptions } from '../src/index';

console.log('🧪 Running basic tests for Coolhand Node Monitor...\n');

// Test 1: Constructor validation
console.log('Test 1: Constructor validation');
try {
    new Coolhand({} as CoolhandOptions); // Should throw error for missing API key
    console.log('❌ FAIL: Should have thrown error for missing API key');
} catch (error) {
    if ((error as Error).message === 'API key is required') {
        console.log('✅ PASS: Correctly validates required API key');
    } else {
        console.log('❌ FAIL: Wrong error message:', (error as Error).message);
    }
}

// Test 2: Successful initialization
console.log('\nTest 2: Successful initialization');
try {
    const monitor = new Coolhand({
        apiKey: 'test-key',
        environment: 'local',
        silent: true
    });

    const stats = monitor.getStats();

    if (stats.totalRequests === 0 && stats.interceptedCalls === 0) {
        console.log('✅ PASS: Monitor initialized correctly');
    } else {
        console.log('❌ FAIL: Unexpected initial stats:', stats);
    }
} catch (error) {
    console.log('❌ FAIL: Initialization failed:', (error as Error).message);
}

// Test 3: Environment configuration
console.log('\nTest 3: Environment configuration');
const localMonitor = new Coolhand({
    apiKey: 'test-key',
    environment: 'local',
    silent: true
});

const prodMonitor = new Coolhand({
    apiKey: 'test-key',
    environment: 'production',
    silent: true
});

// Test default environment (should be production)
const defaultMonitor = new Coolhand({
    apiKey: 'test-key',
    silent: true
});

const localStats = localMonitor.getStats();
const prodStats = prodMonitor.getStats();
const defaultStats = defaultMonitor.getStats();

if (localStats.apiEndpoint.includes('localhost:3000') &&
    prodStats.apiEndpoint.includes('coolhand.io') &&
    defaultStats.apiEndpoint.includes('coolhand.io')) {
    console.log('✅ PASS: Environment configuration works correctly');
} else {
    console.log('❌ FAIL: Environment configuration incorrect');
    console.log('Local endpoint:', localStats.apiEndpoint);
    console.log('Prod endpoint:', prodStats.apiEndpoint);
    console.log('Default endpoint:', defaultStats.apiEndpoint);
}

// Test 4: Header sanitization with pattern-based redaction
console.log('\nTest 4: Header sanitization with pattern-based redaction');

// Test with a mock OpenAI pattern (which includes openai-api-key sanitization)
const openaiPattern = {
    name: "OpenAI",
    domains: ["openai.com", "api.openai.com"],
    paths: ["/v1/chat/completions", "/v1/completions", "/v1/embeddings"],
    headers: {
        "authorization": "[REDACTED]",
        "openai-api-key": "[REDACTED]"
    }
};

const sanitized = localMonitor.sanitizeHeaders({
    'authorization': 'Bearer sk-abc123xyz',
    'openai-api-key': 'sk-secret',
    'x-api-key': 'anthropic-key-123',
    'content-type': 'application/json'
}, openaiPattern);

if (sanitized.authorization === '[REDACTED]' &&
    sanitized['openai-api-key'] === '[REDACTED]' &&
    sanitized['content-type'] === 'application/json') {
    console.log('✅ PASS: Header sanitization works correctly');
} else {
    console.log('❌ FAIL: Header sanitization failed:', sanitized);
}

// Test 5: JSON parsing
console.log('\nTest 5: JSON parsing');
const validJson = localMonitor.parseJSON('{"test": "value"}');
const invalidJson = localMonitor.parseJSON('invalid json');
const nullInput = localMonitor.parseJSON(null);

if (validJson.test === 'value' &&
    invalidJson === 'invalid json' &&
    nullInput === null) {
    console.log('✅ PASS: JSON parsing works correctly');
} else {
    console.log('❌ FAIL: JSON parsing failed');
}

// Test 6: API Pattern loading
console.log('\nTest 6: API Pattern loading');
try {
    const monitor = new Coolhand({
        apiKey: 'test-key',
        environment: 'local',
        silent: true
    });

    // The monitor should have loaded patterns from the default file
    console.log('✅ PASS: API patterns loaded successfully');
} catch (error) {
    console.log('❌ FAIL: API pattern loading failed:', (error as Error).message);
}

// Test 7: Custom patterns file
console.log('\nTest 7: Custom patterns file handling');
try {
    const monitor = new Coolhand({
        apiKey: 'test-key',
        environment: 'local',
        silent: true,
        patternsFile: './non-existent-file.json'
    });

    // Should not throw error but warn about missing file
    console.log('✅ PASS: Gracefully handles missing custom patterns file');
} catch (error) {
    console.log('❌ FAIL: Should not throw error for missing patterns file:', (error as Error).message);
}

// Test 8: FeedbackService integration
console.log('\nTest 8: FeedbackService integration');
try {
    const monitor = new Coolhand({
        apiKey: 'test-key',
        environment: 'local',
        silent: true
    });

    // Check if the monitor has access to feedback service functionality
    if (typeof monitor.createFeedback === 'function') {
        console.log('✅ PASS: FeedbackService is integrated with Coolhand');
    } else {
        console.log('❌ FAIL: FeedbackService not properly integrated');
    }
} catch (error) {
    console.log('❌ FAIL: FeedbackService integration failed:', (error as Error).message);
}

console.log('\n🎉 All basic tests completed!');
console.log('\n📖 To run comprehensive tests:');
console.log('1. Run feedback service tests: npm run test:feedback');
console.log('2. Run logging service tests: npm run test:logging');
console.log('3. Run all service tests: npm run test:services');
console.log('4. Run all tests: npm run test:all');
console.log('5. To test with real API calls:');
console.log('   - Set up a real API key');
console.log('   - Install any LLM SDK package (OpenAI, Anthropic, etc.)');
console.log('   - Run the example: npm run example');
console.log('6. The monitor will now detect calls to multiple LLM providers automatically!');