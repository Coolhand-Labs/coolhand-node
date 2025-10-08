# Express.js Integration

> **⚠️ Status: Theoretical** - These examples are untested. Based on Next.js learnings, the recommended approach is **async startup initialization**. Please test and [contribute improvements](https://github.com/anthropics/coolhand-node/issues)!

## 🎯 Recommended: Async Startup Initialization

Based on our Next.js experience, the most reliable approach is async initialization at startup:

```javascript
// app.js
const express = require('express');

async function startServer() {
  try {
    // Initialize global monitoring BEFORE setting up routes
    if (process.env.COOLHAND_API_KEY) {
      console.log('🌐 Initializing Coolhand global monitoring...');
      const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Global monitoring enabled for all AI API calls!');
    }

    const app = express();

    // Import AI modules AFTER global monitoring initialization
    const { ChatOpenAI } = require('@langchain/openai');
    const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

    app.post('/chat', async (req, res) => {
      // This AI call should be automatically logged
      const response = await model.invoke(req.body.message);
      res.json({ response: response.content });
    });

    app.listen(3000, () => {
      console.log('✅ Server running with global AI monitoring!');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
```

## Alternative: Auto-Monitor Import (Untested)

```javascript
// app.js - Import at the very top
require('coolhand-node/auto-monitor');

const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');

const app = express();
const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/chat', async (req, res) => {
  // This AI call should be automatically logged
  const response = await model.invoke(req.body.message);
  res.json({ response: response.content });
});

app.listen(3000);
```

## 📝 Please Test and Contribute!

If you're using Express.js with Coolhand:
1. **Try the startup initialization approach above**
2. **Verify that AI API calls are being logged**
3. **[Create an issue](https://github.com/anthropics/coolhand-node/issues)** with your results
4. **Share any improvements** or alternative approaches

**Common issues to watch for:**
- Module loading order (import global monitoring first)
- Environment variable availability
- Async initialization timing
- Middleware execution order

## Environment Setup

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key
NODE_ENV=development
```

## Expected Behavior

When working correctly, you should see:
- Startup logs showing global monitoring initialization
- AI API calls automatically logged to Coolhand dashboard
- Zero changes needed to existing route handlers