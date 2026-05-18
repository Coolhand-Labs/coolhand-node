/**
 * Auto-initializing global monitor
 *
 * This module automatically starts monitoring ALL outbound HTTP requests
 * for AI API calls when imported. Configure via environment variables.
 *
 * Environment Variables:
 * - COOLHAND_API_KEY (required)
 * - COOLHAND_SILENT (optional: 'true' | 'false', default: 'true')
 * - COOLHAND_PATTERNS_FILE (optional: path to custom patterns file)
 * - COOLHAND_DEBUG (optional: 'true' | 'false', default: 'false') — enables verbose logging only
 * - COOLHAND_DRY_RUN (optional: 'true' | 'false', default: 'false') — suppresses all API submissions
 * - COOLHAND_BASE_URL (optional: self-hosted endpoint, e.g. 'https://feedback.example.com')
 *
 * Usage:
 * Just import this module at the very top of your main file:
 *
 * import 'coolhand-node/auto-monitor';
 * // or
 * require('coolhand-node/auto-monitor');
 *
 * That's it! All AI API calls will now be automatically logged.
 */

import { initializeGlobalMonitoring, getGlobalStats, isGlobalMonitoringActive } from './global-monitor.js';

// Auto-initialize if environment variables are present
const apiKey = process.env.COOLHAND_API_KEY;

if (apiKey) {
  const silent = process.env.COOLHAND_SILENT !== 'false'; // Default to true unless explicitly false
  const patternsFile = process.env.COOLHAND_PATTERNS_FILE;
  const debug = process.env.COOLHAND_DEBUG === 'true'; // Default to false unless explicitly true
  const dryRun = process.env.COOLHAND_DRY_RUN === 'true'; // Default to false unless explicitly true
  const baseUrl = process.env.COOLHAND_BASE_URL;

  // Async initialization wrapped in IIFE
  (async () => {
    try {
      if (isGlobalMonitoringActive()) {
        return;
      }

      if (!silent) {
        console.log('🔧 Auto-initializing global monitoring...');
      }

      await initializeGlobalMonitoring({
        apiKey,
        silent,
        patternsFile,
        debug,
        dryRun,
        baseUrl
      });

      if (!silent) {
        console.log('✅ Global monitoring initialized successfully');
        console.log(`📊 Silent mode: ${silent ? 'ON' : 'OFF'}`);

        if (dryRun) {
          console.log('🚫 Dry run mode: ON (API calls will be skipped)');
        }

        if (debug) {
          console.log('🔬 Debug mode: ON (verbose logging)');
        }

        if (patternsFile) {
          console.log(`📁 Custom patterns file: ${patternsFile}`);
        }
      }
    } catch (error) {
      console.error('❌ Failed to initialize global monitoring:', (error as Error).message);
    }
  })();
} else {
  // Only warn if not in production to avoid noise
  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  COOLHAND_API_KEY not found. Global monitoring not initialized.');
    console.warn('   Set COOLHAND_API_KEY environment variable to enable monitoring.');
  }
}

// Re-export functions for backwards compatibility
export { initializeGlobalMonitoring, getGlobalStats, isGlobalMonitoringActive };
