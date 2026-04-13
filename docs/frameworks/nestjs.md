# NestJS Integration

> **⚠️ Status: Theoretical** - Based on tested Fastify patterns. Please test and [contribute improvements](https://github.com/Coolhand-Labs/coolhand-node/issues)!

## Module System Background

`coolhand-node` is an **ES module** package. NestJS compiles TypeScript to CommonJS by default (`"module": "commonjs"` in tsconfig), which means:

- `import { ... } from 'coolhand-node'` at the top level won't work (compiled to `require()`)
- `await import('coolhand-node')` won't work (compiled to `require()`)
- You need the `new Function` workaround to emit a native ESM `import()`

## 🎯 Recommended: Bootstrap Integration

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    // Initialize global monitoring BEFORE creating app
    if (process.env.COOLHAND_API_KEY) {
      // new Function emits a native import() that survives CJS compilation.
      // NestJS tsconfig uses "module": "commonjs", which compiles
      // await import() into require() — this workaround preserves the
      // native import() call.
      const _import = new Function('m', 'return import(m)');
      const { initializeGlobalMonitoring } = await _import('coolhand-node');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Coolhand monitoring enabled');
    }

    const app = await NestFactory.create(AppModule);
    await app.listen(3000);
  } catch (error) {
    console.error('Failed to start NestJS app:', error);
    process.exit(1);
  }
}

bootstrap();
```

> **Tip:** If your NestJS project uses `"module": "ES2020"` or `"NodeNext"` in tsconfig, TypeScript preserves the native `import()` and you can use `await import('coolhand-node')` directly without the `new Function` workaround.

## Alternative: Global Module

```typescript
// coolhand/coolhand.module.ts
import { Global, Module, OnModuleInit } from '@nestjs/common';

@Global()
@Module({})
export class CoolhandModule implements OnModuleInit {
  async onModuleInit() {
    if (process.env.COOLHAND_API_KEY) {
      try {
        const _import = new Function('m', 'return import(m)');
        const { initializeGlobalMonitoring } = await _import('coolhand-node');
        await initializeGlobalMonitoring({
          apiKey: process.env.COOLHAND_API_KEY,
          silent: process.env.NODE_ENV === 'production'
        });
        console.log('✅ Coolhand monitoring enabled via NestJS module');
      } catch (error) {
        console.error('Failed to initialize Coolhand:', error);
      }
    }
  }
}

// app.module.ts
import { Module } from '@nestjs/common';
import { CoolhandModule } from './coolhand/coolhand.module';

@Module({
  imports: [CoolhandModule, /* other modules */],
})
export class AppModule {}
```

## Example: AI Service Usage

```typescript
// ai/ai.service.ts
import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private openai: OpenAI;

  constructor() {
    // No Coolhand setup needed here — global monitoring handles everything
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async generateResponse(prompt: string): Promise<string> {
    // This call is automatically intercepted and logged by Coolhand
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    });
    return response.choices[0].message.content ?? '';
  }
}
```

## Example: Controller Usage

```typescript
// ai/ai.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(@Body() body: { message: string }) {
    const response = await this.aiService.generateResponse(body.message);
    return { response };
  }
}
```

## Key Points

- **Initialize in `bootstrap()` before `NestFactory.create()`** — This ensures HTTP/HTTPS patching is active before any modules are loaded.
- **AI clients can be created in service constructors** — Coolhand patches the underlying Node.js `http`/`https` modules, not SDK objects.
- **`require('coolhand-node')` will not work** — This package is ESM-only. The `new Function` pattern is required for NestJS's default CJS compilation.

## Environment Setup

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key
COOLHAND_DEBUG=false
```

## Expected Behavior

When working correctly, you should see:
- Bootstrap logs showing global monitoring initialization
- AI API calls from services automatically logged
- Zero interference with NestJS dependency injection
