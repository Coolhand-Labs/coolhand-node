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

import { initializeGlobalMonitoring } from './global-monitor';

// Auto-initialize if environment variables are present
const apiKey = process.env.COOLHAND_API_KEY;

if (apiKey) {
  const silent = process.env.COOLHAND_SILENT !== 'false'; // Default to true unless explicitly false
  const patternsFile = process.env.COOLHAND_PATTERNS_FILE;

  try {
    initializeGlobalMonitoring({
      apiKey,
      silent,
      patternsFile
    });

    if (!silent) {
      console.log('🚀 Coolhand auto-monitor activated via environment variables');
    }
  } catch (error) {
    console.error('❌ Failed to initialize Coolhand auto-monitor:', error);
  }
} else {
  // Only warn if not in production to avoid noise
  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  Coolhand auto-monitor: COOLHAND_API_KEY environment variable not found');
    console.warn('   Set COOLHAND_API_KEY to enable automatic AI API monitoring');
  }
}

// Re-export the manual initialization function for advanced users
export { initializeGlobalMonitoring, getGlobalStats, isGlobalMonitoringActive } from './global-monitor';