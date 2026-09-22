// examples/feedback-example.js
//
// Live smoke test: one real Anthropic call, logged to Coolhand, then a real
// piece of feedback attached to that exact logged request — proving delivery
// end to end for both the log-upload and the feedback-creation paths, not
// just that createFeedback() doesn't throw. See examples/README.md.
//
// Run: node examples/feedback-example.js
// Requires: see examples/README.md (COOLHAND_API_KEY, ANTHROPIC_API_KEY)

import https from 'node:https';
import { PatternMatchingService, RequestMonitoringService, LoggingService, FeedbackService } from '../dist/index.js';
import { requireEnvOrSkip, runOrFail } from './_shared.js';

requireEnvOrSkip('feedback-example.js', 'COOLHAND_API_KEY', 'ANTHROPIC_API_KEY');

const config = { apiKey: process.env.COOLHAND_API_KEY, silent: false };
// A real Anthropic call is made and captured by driving RequestMonitoringService directly
// (the same technique anthropic-streaming.js uses) rather than through the automatic http/https
// patch, so this script can read back the exact CoolhandLogResponse — including the log's real
// id — instead of only observing console markers. The pattern is hand-supplied because we're not
// going through PatternMatchingService's own matching for this one deliberately-driven request.
const matchedPattern = {
  pattern: { name: 'Anthropic', domains: ['api.anthropic.com'], paths: ['/v1/messages'], headers: { 'x-api-key': '[REDACTED]' } },
  matchType: 'domain',
  matchValue: 'api.anthropic.com',
};

async function callAnthropic() {
  const patternMatchingService = new PatternMatchingService();
  const monitor = new RequestMonitoringService(patternMatchingService, /* silent */ true);

  const requestBody = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Reply with a single short word.' }],
  });

  const callData = await new Promise((resolve, reject) => {
    monitor.onRequestComplete = resolve;
    const req = monitor.interceptRequest(https.request, {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }, undefined, 'https', matchedPattern);
    req.on('error', reject);
    req.end(requestBody);
  });

  if (callData.status_code && callData.status_code >= 400) {
    throw new Error(`Anthropic request failed: ${callData.status_code} ${JSON.stringify(callData.response_body)}`);
  }

  return callData;
}

await runOrFail(async () => {
  console.log('🔍 Coolhand Feedback API Example (live)\n');

  console.log('📞 Calling Anthropic...');
  const callData = await callAnthropic();

  console.log('📤 Logging the call to Coolhand...');
  const loggingService = new LoggingService(config);
  const logResult = await loggingService.logRequestToAPI(callData, matchedPattern, 'manual');
  if (!logResult?.id) {
    throw new Error('Log delivery failed — logRequestToAPI returned null. See the ❌ line above for the cause.');
  }
  console.log(`✅ Log delivered, id=${logResult.id}\n`);

  console.log('📝 Creating feedback for that logged request...');
  const feedbackService = new FeedbackService(config);
  const feedback = await feedbackService.createFeedback({
    llm_request_log_id: logResult.id,
    sentiment: 'like',
    explanation: 'Automated smoke test feedback from examples/feedback-example.js.',
    client_unique_id: 'coolhand-node-feedback-example',
  });
  if (!feedback?.id) {
    throw new Error('Feedback delivery failed — createFeedback returned null. See the ❌ line above for the cause.');
  }
  console.log(`✅ Feedback delivered, id=${feedback.id}, linked to log ${feedback.llm_request_log_id}`);

  console.log('\n🎉 Feedback example completed — both the log and the feedback record reached Coolhand.');
});
