// examples/basic-example.js - Example usage of Coolhand Node Monitor

const Coolhand = require('../index');

// Example 1: Local Development Setup
console.log('🧪 Example 1: Local Development Setup');
const localMonitor = new Coolhand({
    environment: 'local',
    apiKey: 'your-local-api-key-here',
    silent: false
});

console.log('Stats:', localMonitor.getStats());

// Example 2: Production Setup (commented out)
/*
console.log('🚀 Example 2: Production Setup');
const prodMonitor = new Coolhand({
    environment: 'production',
    apiKey: process.env.COOLHAND_API_KEY,
    silent: true
});
*/

// Example 3: Simulated OpenAI call (for testing without actual API)
console.log('\n🔬 Example 3: Test completed - monitor is ready to intercept real API calls');
console.log('💡 To test with actual OpenAI calls, install the OpenAI package and make API requests');
console.log('📖 See README.md for complete usage examples');

// Show final stats
console.log('\n📊 Final Stats:', localMonitor.getStats());