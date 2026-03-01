# v0.1.1 Release Notes

## 🚀 What's New

**Google Vertex AI Support** - Enhanced Google AI detection with improved path matching for Vertex AI endpoints and streamlined API pattern configuration.

### 🎯 Enhanced Google AI Detection
- **Vertex AI support** - Added `:generateContent` pattern to capture Google Vertex AI API calls
- **Focused domain matching** - Consolidated Google AI patterns to use `generativelanguage.googleapis.com` for better reliability
- **Improved path detection** - Enhanced pattern matching for Google AI model endpoints

---

## 🔧 Key Technical Improvements

### Streamlined API Pattern Configuration
- **Reduced complexity** - Removed redundant Cohere and Hugging Face patterns to focus on core providers
- **Better reliability** - Simplified Google AI domain detection for fewer false matches
- **Cleaner configuration** - Streamlined `api-patterns.json` for better maintainability

### Google AI Coverage
The updated patterns now capture:
- Standard Google AI API calls (`/v1/models`, `/v1beta/models`)
- Vertex AI generateContent endpoints (`:generateContent` pattern)
- All authentication methods (`authorization`, `x-goog-api-key`)

---

## 📦 Installation

Install or update to the latest version:

```bash
npm install coolhand-node@0.1.1
# or
yarn add coolhand-node@0.1.1
```

---

## 📋 Full Changelog

### ✨ Improvements
- **Enhanced Google AI support** - Added Vertex AI endpoint pattern matching
- **Simplified API patterns** - Removed unused Cohere and Hugging Face patterns
- **Focused provider support** - Streamlined configuration for better reliability

### 🔧 Technical Changes
- **Updated api-patterns.json** - Added `:generateContent` path pattern for Google Vertex AI
- **Domain consolidation** - Removed `ai.googleapis.com` domain to focus on `generativelanguage.googleapis.com`
- **Pattern cleanup** - Removed Cohere and Hugging Face pattern definitions

### 📚 Migration Notes
No breaking changes - existing implementations will continue to work as expected.

---

## 🎯 Use Cases

### Google Vertex AI Monitoring
Now automatically captures Vertex AI API calls:

```javascript
import 'coolhand-node/auto-monitor';

// Your Vertex AI calls are now automatically monitored
const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    contents: [{
      parts: [{ text: "Hello, how can I help you?" }]
    }]
  })
});
```

### Continued Multi-Provider Support
Still supports all major LLM providers:

```javascript
// OpenAI - automatically captured
const openaiResponse = await openai.chat.completions.create({...});

// Anthropic - automatically captured
const anthropicResponse = await anthropic.messages.create({...});

// Google AI/Vertex - now with enhanced detection
const googleResponse = await model.generateContent({...});
```

---

## 🔗 Resources
- [Documentation](https://github.com/Coolhand-Labs/coolhand-node)
- [Google AI Integration Guide](docs/)
- [Version History](VERSION.md)

## 🙏 Acknowledgments
Thanks to our users for feedback on Google Vertex AI support!