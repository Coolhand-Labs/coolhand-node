# React Frontend Integration

This guide covers how to integrate Coolhand monitoring in React applications that make AI API calls directly from the browser.

> ⚠️ **Security Note**: For production applications, it's recommended to make AI API calls from your backend rather than directly from the browser to avoid exposing API keys. This guide covers frontend integration for development and specific use cases where frontend AI calls are necessary.

## Overview

For React applications making AI API calls directly from the browser, use the instance-based approach with proper React patterns. The global monitoring approach doesn't work in browser environments, so you'll need to explicitly manage Coolhand instances.

## Installation

```bash
npm install coolhand-node
```

## Quick Start

### Hook Pattern

Create a custom hook to manage the Coolhand instance:

```typescript
// hooks/useCoolhand.ts
import { useEffect, useRef } from 'react';
import { Coolhand } from 'coolhand-node';

let coolhandInstance: Coolhand | null = null;

export function useCoolhand() {
  const instanceRef = useRef<Coolhand | null>(null);

  useEffect(() => {
    if (!coolhandInstance && process.env.REACT_APP_COOLHAND_API_KEY) {
      coolhandInstance = new Coolhand({
        apiKey: process.env.REACT_APP_COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      instanceRef.current = coolhandInstance;
    }
  }, []);

  return instanceRef.current;
}
```

### Component Usage

```typescript
// components/AIChat.tsx
import React, { useState } from 'react';
import { useCoolhand } from '../hooks/useCoolhand';

// Import your AI library
import OpenAI from 'openai';

export function AIChat() {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const coolhand = useCoolhand(); // Initialize monitoring

  const handleChat = async (message: string) => {
    setLoading(true);

    try {
      // Create OpenAI client
      const openai = new OpenAI({
        apiKey: process.env.REACT_APP_OPENAI_API_KEY,
        dangerouslyAllowBrowser: true // Only for demo - use backend in production
      });

      // This AI call will be automatically logged by Coolhand
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: message }],
      });

      setResponse(completion.choices[0]?.message?.content || '');
    } catch (error) {
      console.error('AI request failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => handleChat('Hello, AI!')}
        disabled={loading}
      >
        {loading ? 'Thinking...' : 'Chat with AI'}
      </button>
      {response && <p>AI Response: {response}</p>}
    </div>
  );
}
```

## Integration Patterns

### App-Level Initialization

Initialize Coolhand once at the app level:

```typescript
// App.tsx
import React, { useEffect } from 'react';
import { Coolhand } from 'coolhand-node';
import { AIChat } from './components/AIChat';

// Initialize Coolhand once at app level
let coolhandInitialized = false;

function App() {
  useEffect(() => {
    if (!coolhandInitialized && process.env.REACT_APP_COOLHAND_API_KEY) {
      new Coolhand({
        apiKey: process.env.REACT_APP_COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      coolhandInitialized = true;
      console.log('🔍 Coolhand monitoring initialized for React app');
    }
  }, []);

  return (
    <div className="App">
      <AIChat />
    </div>
  );
}

export default App;
```

### Context Provider Pattern

For more complex applications, use React Context:

```typescript
// contexts/CoolhandContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Coolhand } from 'coolhand-node';

interface CoolhandContextType {
  coolhand: Coolhand | null;
  isInitialized: boolean;
}

const CoolhandContext = createContext<CoolhandContextType>({
  coolhand: null,
  isInitialized: false
});

export function CoolhandProvider({ children }: { children: React.ReactNode }) {
  const [coolhand, setCoolhand] = useState<Coolhand | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (process.env.REACT_APP_COOLHAND_API_KEY) {
      const instance = new Coolhand({
        apiKey: process.env.REACT_APP_COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });

      setCoolhand(instance);
      setIsInitialized(true);
    }
  }, []);

  return (
    <CoolhandContext.Provider value={{ coolhand, isInitialized }}>
      {children}
    </CoolhandContext.Provider>
  );
}

export const useCoolhandContext = () => useContext(CoolhandContext);
```

Usage in components:

```typescript
// Usage in components
import { useCoolhandContext } from '../contexts/CoolhandContext';

function MyComponent() {
  const { coolhand, isInitialized } = useCoolhandContext();

  // Use coolhand for AI calls when initialized
  // All AI API calls will be automatically logged
}
```

## Next.js Integration

### App Router

```typescript
// app/layout.tsx
'use client';
import { useEffect } from 'react';
import { Coolhand } from 'coolhand-node';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_COOLHAND_API_KEY) {
      new Coolhand({
        apiKey: process.env.NEXT_PUBLIC_COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
    }
  }, []);

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### Backend API Routes (Recommended)

For production Next.js applications, use backend API routes instead of frontend calls:

```typescript
// pages/api/ai-chat.ts (Next.js API route)
import { Coolhand } from 'coolhand-node';
import OpenAI from 'openai';

const coolhand = new Coolhand({
  apiKey: process.env.COOLHAND_API_KEY // Server-side only
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // Server-side only
});

export default async function handler(req, res) {
  // AI call logged automatically by Coolhand
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: req.body.message }],
  });

  res.json({ response: completion.choices[0]?.message?.content });
}
```

## Environment Variables

### Create React App

Add to your `.env.local`:

```bash
REACT_APP_OPENAI_API_KEY=your_openai_key_here
REACT_APP_COOLHAND_API_KEY=your_coolhand_key_here
```

### Next.js

Add to your `.env.local`:

```bash
# For frontend usage (not recommended for production)
NEXT_PUBLIC_OPENAI_API_KEY=your_openai_key_here
NEXT_PUBLIC_COOLHAND_API_KEY=your_coolhand_key_here

# For backend API routes (recommended)
OPENAI_API_KEY=your_openai_key_here
COOLHAND_API_KEY=your_coolhand_key_here
```

### Vite

Add to your `.env.local`:

```bash
VITE_OPENAI_API_KEY=your_openai_key_here
VITE_COOLHAND_API_KEY=your_coolhand_key_here
```

## Security Best Practices

⚠️ **Critical Security Considerations:**

### 1. Never Expose API Keys in Frontend Code

```typescript
// ✅ Secure approach - Backend proxy
const response = await fetch('/api/ai-chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: userInput })
});

// ❌ Insecure - Direct API calls from browser
const openai = new OpenAI({
  apiKey: 'sk-...' // Never do this in production!
});
```

### 2. Use Correct Environment Variable Prefixes

- **React**: `REACT_APP_*`
- **Next.js**: `NEXT_PUBLIC_*` (frontend) or no prefix (backend)
- **Vite**: `VITE_*`

### 3. Backend Integration Pattern

The recommended approach for production applications:

```typescript
// Frontend: Make requests to your backend
const chatWithAI = async (message: string) => {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });

  return response.json();
};

// Backend: Handle AI calls with proper security
// (API keys never exposed to browser)
```

## Browser Compatibility

✅ **Supported Browsers:**
- Chrome 66+ (fetch support)
- Firefox 57+ (fetch support)
- Safari 10+ (fetch support)
- Edge 79+ (fetch support)

⚠️ **Limitations:**
- Requires `fetch` API support
- CORS policies may affect direct AI API calls
- Some AI providers block browser requests

## Debug Mode

You can enable debug mode for development:

```typescript
const coolhand = new Coolhand({
  apiKey: process.env.REACT_APP_COOLHAND_API_KEY,
  debug: process.env.NODE_ENV === 'development' // Enable debug mode in development
});
```

When debug mode is enabled:
- API calls to Coolhand will be mocked
- Debug messages will be logged to the console
- No data will be sent to Coolhand servers

## Troubleshooting

### Common Issues

1. **Environment variables not loading**
   - Ensure you're using the correct prefix for your build tool
   - Restart your development server after adding environment variables

2. **CORS errors**
   - AI providers may block browser requests
   - Consider using a backend proxy instead

3. **API keys exposed in bundle**
   - Check that you're using the correct environment variable prefix
   - Never commit `.env` files to version control

### Getting Help

If you encounter issues with React integration:

1. Check the [main documentation](../../README.md)
2. Review the [troubleshooting guide](../troubleshooting.md)
3. [Open an issue](https://github.com/coolhand-io/coolhand-node/issues) on GitHub

## Example Applications

Check out these example React applications with Coolhand integration:

- [Basic React App](../../examples/react-basic)
- [Next.js App Router](../../examples/nextjs-app-router)
- [Create React App with TypeScript](../../examples/cra-typescript)

---

**Recommendation**: For production applications, use Coolhand monitoring on your backend API routes instead of direct frontend AI calls for better security and reliability.