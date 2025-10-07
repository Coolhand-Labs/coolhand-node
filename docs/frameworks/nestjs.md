# NestJS Integration

> **⚠️ Status: Theoretical** - These examples are untested. Please test and [contribute improvements](https://github.com/anthropics/coolhand-node/issues)!

## 🎯 Recommended: Bootstrap Integration

Based on Next.js learnings, async bootstrap initialization should be most reliable:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    // Initialize global monitoring BEFORE creating app
    if (process.env.COOLHAND_API_KEY) {
      console.log('🌐 Initializing Coolhand global monitoring...');
      const { initializeGlobalMonitoring } = await import('coolhand-node/auto-monitor');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Global monitoring enabled for all AI API calls!');
    }

    const app = await NestFactory.create(AppModule);
    await app.listen(3000);
    console.log('✅ NestJS app running with global AI monitoring!');
  } catch (error) {
    console.error('❌ Failed to start NestJS app:', error);
    process.exit(1);
  }
}

bootstrap();
```

## Alternative: Global Module (Untested)

```typescript
// coolhand/coolhand.module.ts
import { Global, Module, OnModuleInit } from '@nestjs/common';

@Global()
@Module({})
export class CoolhandModule implements OnModuleInit {
  async onModuleInit() {
    if (process.env.COOLHAND_API_KEY) {
      try {
        const { initializeGlobalMonitoring } = await import('coolhand-node/auto-monitor');
        await initializeGlobalMonitoring({
          apiKey: process.env.COOLHAND_API_KEY,
          silent: process.env.NODE_ENV === 'production'
        });
        console.log('✅ Global monitoring enabled via NestJS module!');
      } catch (error) {
        console.error('❌ Failed to initialize global monitoring:', error);
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
import { ChatOpenAI } from '@langchain/openai';

@Injectable()
export class AiService {
  private model: ChatOpenAI;

  constructor() {
    // No Coolhand setup needed - global monitoring should handle everything!
    this.model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-3.5-turbo',
    });
  }

  async generateResponse(prompt: string): Promise<string> {
    // This call should be automatically logged by global monitoring
    const response = await this.model.invoke(prompt);
    return response.content as string;
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

## 📝 Please Test and Contribute!

If you're using NestJS with Coolhand:
1. **Try the bootstrap initialization approach above**
2. **Verify that AI API calls in services are being logged**
3. **[Create an issue](https://github.com/anthropics/coolhand-node/issues)** with your results
4. **Share any improvements** for NestJS-specific patterns

**Common areas to test:**
- Module initialization order
- Dependency injection compatibility
- Guards and interceptors interaction
- Microservice communication monitoring

## Environment Setup

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key
NODE_ENV=development
```

## Expected Behavior

When working correctly, you should see:
- Bootstrap logs showing global monitoring initialization
- AI API calls from services automatically logged
- Zero interference with NestJS dependency injection