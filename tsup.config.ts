import { defineConfig } from 'tsup';

export default defineConfig({
  // Compile every source file individually rather than bundling entry points.
  // Bundling duplicates global-monitor into both index and auto-monitor, breaking
  // the singleton: require('coolhand-node/auto-monitor') initialises one copy while
  // getGlobalStats() from require('coolhand-node') reads a different uninitialised copy.
  // With bundle:false, Node's module cache keeps a single shared instance.
  entry: ['src/**/*.ts'],
  bundle: false,
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  outDir: 'dist',
});
