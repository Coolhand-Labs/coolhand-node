// examples/feedback-example.js - Example usage of LLM Request Log Feedback API

const { Coolhand } = require('../dist/index');

async function demonstrateFeedback() {
  console.log('🔍 Coolhand Feedback API Example\n');

  // Initialize Coolhand
  const monitor = new Coolhand({
    apiKey: process.env.COOLHAND_API_KEY || 'your-api-key-here',
    environment: 'local', // Use local for testing
    silent: false
  });

  console.log('✅ Coolhand initialized successfully!\n');

  // Example: Create feedback for an LLM request log
  const exampleFeedback = {
    llm_request_log_id: 123, // This would be the ID of an actual logged request
    like: true,
    explanation: 'Great response! The AI understood the context perfectly and provided accurate information.',
    revised_output: 'This could be an improved version of the response if needed.',
    llm_provider_unique_id: 'openai-chatgpt-4',
    original_output: 'The original AI response that was provided',
    client_unique_id: 'user-session-456'
  };

  console.log('📝 Creating feedback for LLM request log...');
  console.log('Feedback data:', JSON.stringify(exampleFeedback, null, 2));

  try {
    const result = await monitor.createFeedback(exampleFeedback);

    if (result) {
      console.log('\n✅ Feedback created successfully!');
      console.log('Response:', JSON.stringify(result, null, 2));
    } else {
      console.log('\n❌ Failed to create feedback');
    }
  } catch (error) {
    console.error('\n❌ Error creating feedback:', error.message);
  }

  // Get current stats
  const stats = monitor.getStats();
  console.log('\n📊 Current Stats:', stats);

  console.log('\n🎉 Feedback example completed!');
  console.log('\n💡 Note: To use with a real API key:');
  console.log('   export COOLHAND_API_KEY=your-actual-key');
  console.log('   node examples/feedback-example.js');
}

// Run the example
demonstrateFeedback().catch(console.error);