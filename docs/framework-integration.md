# Framework Integration Guide

Coolhand's global monitoring works with **any Node.js framework** because it patches core HTTP modules (`https`, `http`, `fetch`) at the Node.js level. This guide shows how to integrate with popular frameworks.

## 🎯 Compatibility Overview

| Framework | Compatibility | Integration Method | Status |
|-----------|---------------|-------------------|--------|
| **Next.js/T3** | ✅ **Tested** | next.config.js | Production-ready implementation |
| **React** | 🧪 Theoretical | Instance-based | Frontend integration patterns |
| **Express.js** | 🧪 Theoretical | Startup hook | Needs testing - please contribute! |
| **NestJS** | 🧪 Theoretical | Bootstrap | Needs testing - please contribute! |
| **Fastify** | 🧪 Theoretical | Register hook | Needs testing - please contribute! |
| **Koa.js** | 🧪 Theoretical | Startup | Needs testing - please contribute! |
| **Serverless** | 🧪 Theoretical | Handler wrapper | Needs testing - please contribute! |
| **Cloudflare Workers** | ⚠️ Limited | Manual setup | Limited Node.js API support |
| **Deno** | ❌ Not supported | N/A | Different runtime environment |

> **📝 Contributing**: Only Next.js/T3 integration has been thoroughly tested. Other examples are theoretical and need community validation. Please [create an issue](https://github.com/anthropics/coolhand-node/issues) or submit a PR with improvements!

## 📚 Framework-Specific Guides

Choose your framework for detailed integration instructions:

- **[Next.js / T3 Stack](./frameworks/nextjs.md)** - ✅ Production-ready, thoroughly tested
- **[React Frontend](./frameworks/react.md)** - 🧪 Theoretical, needs community testing
- **[Express.js](./frameworks/express.md)** - 🧪 Theoretical, needs community testing
- **[NestJS](./frameworks/nestjs.md)** - 🧪 Theoretical, needs community testing
- **[Fastify](./frameworks/fastify.md)** - 🧪 Theoretical, needs community testing
- **[Koa.js](./frameworks/koa.md)** - 🧪 Theoretical, needs community testing
- **[Serverless (AWS Lambda, Vercel, Netlify)](./frameworks/serverless.md)** - 🧪 Theoretical, needs community testing

Each framework guide contains:
- ✅ **Production-ready examples** (Next.js) or 🧪 **theoretical patterns** (others)
- **Best practices** learned from real implementations
- **Environment setup** instructions
- **Common gotchas** and troubleshooting tips
- **Community contribution** requests for validation

## 🎯 Quick Start Summary

For **any Node.js framework**, the pattern is consistent:

1. **Initialize early** - Before importing AI libraries
2. **Use async initialization** - Allows proper module loading
3. **Environment-based config** - Production vs development settings
4. **Verify with logging** - Confirm monitoring is active

### Universal Pattern

```javascript
// At application startup (before AI imports)
if (process.env.COOLHAND_API_KEY) {
  const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');
  await initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY,
    silent: process.env.NODE_ENV === 'production'
  });
}

// Now import and use AI libraries - automatically monitored!
const { ChatOpenAI } = require('@langchain/openai');
```

## 🔧 Framework-Agnostic Integration

For any Node.js application, regardless of framework:

### Method 1: Environment Variable Auto-Initialization

```bash
# .env
COOLHAND_API_KEY=your_api_key_here
COOLHAND_ENVIRONMENT=production
COOLHAND_SILENT=true
```

```javascript
// At the very top of your main file
require('coolhand-node/auto-monitor');

// Rest of your application
```

### Method 2: Manual Initialization

```javascript
// At the very top of your main file
const { initializeGlobalMonitoring } = require('coolhand-node');

initializeGlobalMonitoring({
  apiKey: process.env.COOLHAND_API_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
  silent: process.env.NODE_ENV === 'production'
});

// Rest of your application
```

## 🎯 Best Practices

### 1. Initialize Early
```javascript
// ✅ Good - Initialize before importing AI libraries
const { initializeGlobalMonitoring } = require('coolhand-node');
initializeGlobalMonitoring({...});
const { ChatOpenAI } = require('@langchain/openai');

// ❌ Bad - Initialize after importing AI libraries
const { ChatOpenAI } = require('@langchain/openai');
const { initializeGlobalMonitoring } = require('coolhand-node');
initializeGlobalMonitoring({...});
```

### 2. Environment-Based Configuration
```javascript
const config = {
  apiKey: process.env.COOLHAND_API_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
  silent: process.env.NODE_ENV === 'production'
};
```

### 3. Error Handling
```javascript
try {
  initializeGlobalMonitoring(config);
} catch (error) {
  console.error('Failed to initialize Coolhand monitoring:', error);
  // Continue without monitoring rather than crashing
}
```

### 4. Singleton Pattern for Multiple Initializations
```javascript
let isInitialized = false;

function ensureCoolhandInitialized() {
  if (!isInitialized && process.env.COOLHAND_API_KEY) {
    initializeGlobalMonitoring({...});
    isInitialized = true;
  }
}
```

## 🚨 Framework-Specific Considerations

### Express.js
- **Timing**: Initialize in app.js before route definitions
- **Middleware**: Can use middleware for lazy initialization
- **Best Practice**: Use auto-monitor for simplicity

### NestJS
- **Timing**: Initialize in main.ts bootstrap or OnModuleInit
- **Architecture**: Fits well with global modules
- **Best Practice**: Use global module for DI integration

### Fastify
- **Timing**: Initialize in plugin or onReady hook
- **Performance**: Zero impact on Fastify's speed
- **Best Practice**: Use plugin system for consistency

### Serverless
- **Cold Starts**: Initialize outside handler for reuse
- **Memory**: Minimal overhead perfect for serverless
- **Best Practice**: Use global flag to prevent re-initialization

## ✅ Verification

To verify global monitoring is working in any framework:

```javascript
const { getGlobalStats, isGlobalMonitoringActive } = require('coolhand-node');

// Check if monitoring is active
console.log('Monitoring active:', isGlobalMonitoringActive());

// After making AI calls, check stats
console.log('Stats:', getGlobalStats());
```

## 🎉 Summary

Global monitoring works with **100% of Node.js frameworks** because it operates at the Node.js HTTP module level. The integration pattern is consistent:

1. **Initialize early** (before AI library imports)
2. **Use framework-appropriate initialization point** (middleware, plugins, bootstrap)
3. **Configure based on environment**
4. **Verify with stats/monitoring checks**

No matter what framework you use, your AI API calls will be automatically logged with zero code changes to your business logic! 🚀