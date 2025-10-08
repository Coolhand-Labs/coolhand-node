# Version History

## 0.1.0 (Current)

**Release Date**: October 2025
**Branch**: `0.1.0`
**Status**: Stable

### Major Features

#### 🏗️ **Complete TypeScript Migration**
- Full TypeScript codebase with comprehensive type definitions
- Exported types: `Coolhand`, `CoolhandOptions`, `CoolhandCallData`, `CoolhandStats`, `CoolhandAPIPattern`, `CoolhandMatchedPattern`
- ES Module support with proper `package.json` configuration
- TypeScript compilation with `tsc` and proper build pipeline

#### 🎯 **Pattern-Based Multi-Provider Support**
- **Universal API Detection**: Supports OpenAI, Anthropic, Google AI, Cohere, and Hugging Face
- **Configurable Patterns**: JSON-based API pattern matching system (`api-patterns.json`)
- **Custom Provider Support**: Load custom patterns via `patternsFile` option
- **Domain & Path Matching**: Precise API detection using domain names and URL paths
- **Smart Header Sanitization**: Pattern-based credential redaction while preserving useful headers

#### 📊 **Comprehensive Feedback API**
- **LLM Response Feedback**: Collect user feedback on AI responses (`createFeedback()`)
- **Quality Metrics**: Track likes/dislikes, explanations, and revised outputs
- **Request Correlation**: Link feedback to specific LLM request logs
- **Client Tracking**: Support for unique client identification

#### 🏢 **Modular Service Architecture**
- **PatternMatchingService**: Handles API pattern detection and matching
- **LoggingService**: Manages API request/response logging to Coolhand platform
- **FeedbackService**: Handles feedback collection and submission
- **RequestMonitoringService**: HTTP/HTTPS/fetch interception and monitoring
- **Service Composition**: Clean separation of concerns with dependency injection

#### 🧪 **Production-Ready Testing**
- **Jest Test Framework**: Comprehensive test suite with 85%+ coverage targets
- **Service Testing**: Individual tests for all service components
- **Integration Testing**: End-to-end testing of monitoring functionality
- **Mock Testing**: Proper mocking of HTTP modules and file system operations
- **CI/CD Integration**: GitHub Actions workflow for automated testing

### Installation
```bash
npm install coolhand-node@0.1.0
```

### API Changes

#### New Configuration Options
```typescript
const monitor = new Coolhand({
  apiKey: 'your-api-key',
  environment: 'production' | 'local',  // New: Environment-specific endpoints
  silent: boolean,                       // Enhanced: Better logging control
  patternsFile: string                   // New: Custom API patterns support
});
```

#### New Methods
```typescript
// Feedback API
await monitor.createFeedback({
  llm_request_log_id?: number,
  like: boolean,
  explanation?: string,
  revised_output?: string,
  llm_provider_unique_id?: string,
  original_output?: string,
  client_unique_id?: string
});

// Service Access
import {
  PatternMatchingService,
  LoggingService,
  FeedbackService
} from 'coolhand-node';
```

### Supported AI Providers
- **OpenAI** (`openai.com`, `api.openai.com`)
- **Anthropic** (`api.anthropic.com`)
- **Google AI** (`generativelanguage.googleapis.com`, `ai.googleapis.com`)
- **Cohere** (`api.cohere.ai`)
- **Hugging Face** (`api-inference.huggingface.co`)
- **Custom Providers** (via `patternsFile` configuration)

### Breaking Changes
- **Minimum Node.js**: Now requires Node.js 14+
- **ES Modules**: Package now uses ES modules (`"type": "module"`)
- **Import Syntax**: TypeScript imports required for type safety
- **Build Output**: Compiled JavaScript output in `dist/` directory
- **Type Names**: Generic type names are now namespaced (see Migration Guide below)

### Backward Compatibility
Legacy type exports are still available but deprecated:
- `CallData` → Use `CoolhandCallData` (legacy export available)
- `Stats` → Use `CoolhandStats` (legacy export available)
- `APIPattern` → Use `CoolhandAPIPattern` (legacy export available)
- `MatchedPattern` → Use `CoolhandMatchedPattern` (legacy export available)
- `RequestOptions` → Use `CoolhandRequestOptions` (legacy export available)

### Migration Guide

#### From 0.0.1 to 0.1.0
```javascript
// Before (0.0.1)
const Coolhand = require('coolhand-node');
const monitor = new Coolhand({ apiKey: 'key' });

// After (0.1.0) - JavaScript
import Coolhand from 'coolhand-node';
const monitor = new Coolhand({
  apiKey: 'key',
  environment: 'production'
});

// After (0.1.0) - TypeScript with namespaced types
import { Coolhand, CoolhandOptions, CoolhandStats, CoolhandCallData } from 'coolhand-node';
const options: CoolhandOptions = {
  apiKey: 'key',
  environment: 'production',
  silent: true
};
const monitor = new Coolhand(options);

// Use namespaced types
const stats: CoolhandStats = monitor.getStats();
```

### Enhanced Framework Support
- **Next.js/T3 Stack**: Full TypeScript integration with comprehensive examples
- **Express.js**: Universal HTTP module patching compatibility
- **Universal Node.js**: Works with any framework using HTTP/HTTPS modules

### Development Improvements
- **ESLint Configuration**: TypeScript-aware linting with Jest plugin
- **GitHub Actions CI**: Automated testing on Node.js 16, 18, 20
- **Coverage Thresholds**: Enforced test coverage minimums (85% lines, 75% functions)
- **Build Pipeline**: Automated TypeScript compilation and asset copying

### Known Issues
- **Node.js 12**: No longer supported (minimum Node.js 14+)
- **CommonJS**: Limited CommonJS compatibility (ES modules preferred)

---

## 0.0.1 (Previous)

**Release Date**: Initial development version
**Branch**: `0.0.1`
**Status**: Legacy

### Features
- Core LLM API call interception (OpenAI, Anthropic)
- HTTP/HTTPS request monitoring
- Fetch API support (Node 18+)
- Automatic header sanitization
- Local and production environment support
- Coolhand API integration
- Silent mode option

### Installation
```bash
npm install git+https://github.com/Coolhand-Labs/coolhand-node.git#0.0.1
```

### Breaking Changes
- Initial release

### Known Issues
- Limited provider support (OpenAI/Anthropic only)
- No TypeScript support
- Hardcoded API detection patterns