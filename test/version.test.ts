/**
 * Tests for version management and consistency
 */

import { PACKAGE_VERSION, PACKAGE_NAME, PACKAGE_IDENTIFIER } from '../src/version';
import * as fs from 'fs';
import * as path from 'path';

describe('Version Management', () => {
  describe('Version Constants', () => {
    it('should export correct version format', () => {
      expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should export correct package name', () => {
      expect(PACKAGE_NAME).toBe('coolhand-node');
    });

    it('should export correct package identifier', () => {
      expect(PACKAGE_IDENTIFIER).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}`);
    });
  });

  describe('Version Consistency', () => {
    it('should have consistent version with package.json', () => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      expect(PACKAGE_VERSION).toBe(packageJson.version);
    });

    it('should have consistent package name with package.json', () => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      expect(PACKAGE_NAME).toBe(packageJson.name);
    });
  });

  describe('Version Export', () => {
    it('should be accessible from main index export', async () => {
      const mainExports = await import('../src/index');

      expect(mainExports.PACKAGE_VERSION).toBe(PACKAGE_VERSION);
      expect(mainExports.PACKAGE_NAME).toBe(PACKAGE_NAME);
      expect(mainExports.PACKAGE_IDENTIFIER).toBe(PACKAGE_IDENTIFIER);
    });
  });

  describe('Collector Integration', () => {
    it('should use version constants in collector', async () => {
      const { getCollectorString, getPackageName, getPackageVersion } = await import('../src/utils/collector');

      expect(getPackageName()).toBe(PACKAGE_NAME);
      expect(getPackageVersion()).toBe(PACKAGE_VERSION);
      expect(getCollectorString()).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}`);
    });
  });
});