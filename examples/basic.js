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

// Example 3: Pattern-based detection for multiple LLM providers
console.log('\n🔬 Example 3: Test completed - monitor is ready to intercept API calls from multiple LLM providers');
console.log('💡 Supports: OpenAI, Anthropic, Google AI, Cohere, Hugging Face, and more');
console.log('🔧 Use custom patterns file to add support for additional providers');
console.log('📖 See README.md for complete usage examples');

// Example 4: Custom patterns file
console.log('\n⚙️  Example 4: Using custom patterns file');
console.log('To use a custom patterns file:');
console.log('const monitor = new Coolhand({');
console.log('  apiKey: "your-api-key",');
console.log('  patternsFile: "./my-custom-patterns.json"');
console.log('});');

// Show final stats
console.log('\n📊 Final Stats:', localMonitor.getStats());