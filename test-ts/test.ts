// test-ts/test.ts - Basic test for Coolhand Node Monitor

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

// Test 4: Header sanitization
console.log('\nTest 4: Header sanitization');
const sanitized = localMonitor.sanitizeHeaders({
    'authorization': 'Bearer sk-abc123xyz',
    'openai-api-key': 'sk-secret',
    'content-type': 'application/json'
});

if (sanitized.authorization === 'Bearer [REDACTED]' &&
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

console.log('\n🎉 All tests completed!');
console.log('\n📖 To test with real API calls:');
console.log('1. Set up a real API key');
console.log('2. Install OpenAI package: npm install openai');
console.log('3. Run the example: npm run example');