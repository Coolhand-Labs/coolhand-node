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

// Re-export functions for backwards compatibility
export { initializeGlobalMonitoring, getGlobalStats, isGlobalMonitoringActive };

// Auto-initialize if environment variables are present
const apiKey = process.env.COOLHAND_API_KEY;

if (apiKey) {
  const silent = process.env.COOLHAND_SILENT !== 'false'; // Default to true unless explicitly false
  const patternsFile = process.env.COOLHAND_PATTERNS_FILE;

  // Async initialization wrapped in IIFE
  (async () => {
    try {
      console.log('🔧 Auto-initializing global monitoring...');

      await initializeGlobalMonitoring({
        apiKey,
        silent,
        patternsFile
      });

      console.log('✅ Global monitoring initialized successfully');
      console.log(`📊 Silent mode: ${silent ? 'ON' : 'OFF'}`);

      if (patternsFile) {
        console.log(`📁 Custom patterns file: ${patternsFile}`);
      }
    } catch (error) {
      console.error('❌ Failed to initialize global monitoring:', (error as Error).message);
    }
  })();
} else {
  console.warn('⚠️  COOLHAND_API_KEY not found. Global monitoring not initialized.');
  console.warn('   Set COOLHAND_API_KEY environment variable to enable monitoring.');
}