/**
 * Utility for generating collector identification string
 */

import { PACKAGE_NAME, PACKAGE_VERSION } from '../version.js';

/**
 * Collection methods available
 */
export type CollectionMethod = 'global-monitoring' | 'manual' | 'auto-monitor';

/**
 * Gets the collector identification string
 * Format: "packagename-X.Y.Z-method"
 * @param method Optional collection method suffix
 * @returns Collector string identifying this SDK version and collection method
 */
export function getCollectorString(method?: CollectionMethod): string {
  const base = `${PACKAGE_NAME}-${PACKAGE_VERSION}`;
  return method ? `${base}-${method}` : base;
}

/**
 * Gets the package name
 */
export function getPackageName(): string {
  return PACKAGE_NAME;
}

/**
 * Gets the package version
 */
export function getPackageVersion(): string {
  return PACKAGE_VERSION;
}