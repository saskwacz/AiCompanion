# AiComp - AI Chat Application

A modern, feature-rich web application for chatting with Google's Gemini AI, similar to Character.AI or JanitorAI.

## Features

- **Modern Chat Interface** - Clean, intuitive UI with dark theme inspired by popular AI chat apps
- **Google Gemini Integration** - Connect to Google's powerful Gemini LLM via API
- **Chat History** - Store and manage multiple conversations
- **Customizable AI Character** - Define custom system prompts to create unique AI personalities
- **Adjustable Settings** - Control temperature (creativity), max tokens, and more
- **Local Storage** - All chats and settings stored locally in browser (your API key is never sent anywhere except to Google)
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Real-time Typing** - Smooth message animations and typing indicators

## Getting Started

### 1. Get Your Google Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Create API Key"
3. Copy your API key

### 2. Open the Application

Simply open `index.html` in a modern web browser (Chrome, Firefox, Safari, Edge)

### 3. Configure Settings

1. Click the **⚙️ Settings** button in the bottom left
2. Paste your Google Gemini API key
3. (Optional) Customize the AI character prompt
4. Adjust temperature and max tokens if desired
5. Click **Save Settings**

## Settings Explained

- **API Key**: Your personal Google Gemini API key (stored securely in browser, never sent to external servers)
- **Character Prompt**: System prompt that defines the AI's personality and behavior
- **Temperature**: Controls randomness/creativity (0.0-2.0)
  - Lower values (0.0-0.7): More focused and deterministic
  - Higher values (1.0-2.0): More creative and varied
- **Max Tokens**: Maximum length of AI responses (100-8192)

## Usage

1. Type your message in the input field
2. Press **Enter** to send (or click the send button)
3. Use **Shift+Enter** for line breaks
4. The AI will respond with a message
5. Your chat history is automatically saved

## Creating Custom AI Characters

In the Settings, use the "Character Prompt" field to define the AI's behavior:

### Example Prompts:

**Helpful Assistant**
```
You are a helpful, friendly AI assistant who provides clear and accurate information. Be conversational and engaging.
```

**Code Expert**
```
You are an expert programming assistant. Provide detailed code examples and explanations. Help debug issues and improve code quality.
```

**Creative Writer**
```
You are a creative fiction writer. Help the user develop stories, characters, and plots. Be imaginative and engaging.
```

**Therapist**
```
You are an empathetic listener and counselor. Provide supportive responses and gentle guidance. Always prioritize the user's wellbeing.
```

## File Structure

```
AiComp/
├── index.html      # Main HTML structure
├── styles.css      # Styling and responsive design
├── script.js       # JavaScript logic and API integration
└── README.md       # This file
```

## Browser Requirements

- Modern browser with:
  - LocalStorage API
  - Fetch API
  - ES6+ JavaScript support
  
Compatible with:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Privacy & Security

- ✅ All chats stored locally in browser storage
- ✅ Your API key stored securely in browser (never sent to any server except Google)
- ✅ No tracking or analytics
- ✅ Open source - you can inspect all code

## Troubleshooting

### "API Error: Invalid API key"
- Check that you've copied the full API key correctly
- Verify the key is enabled in Google Cloud Console
- Regenerate the key if necessary

### "No response from API"
- Check your internet connection
- Verify the API key has Generative AI access
- Check Google's status page for service issues

### Chat history not saving
- Enable browser cookies/localStorage
- Check that you have enough storage space
- Try clearing browser cache and refreshing

### Messages not sending
- Ensure API key is configured
- Check internet connection
- Try opening the browser console (F12) for error messages

## Tips for Best Results

1. **Be Specific** - More detailed prompts get better responses
2. **Use Follow-ups** - Build on previous responses for better context
3. **Experiment with Temperature** - Try different values to find the right balance
4. **Clear Prompts** - Custom character prompts should be clear and specific
5. **Keep Context** - Longer conversations maintain better context

## Limitations

- Responses are limited by Google Gemini API rate limits (free tier: ~60 requests per minute)
- Maximum response length depends on max_tokens setting
- Conversation context is limited (earlier messages may be forgotten)

## Future Enhancements

- [ ] Text-to-speech
- [ ] Voice input
- [ ] Export/import chats
- [ ] Multiple character support
- [ ] Image input
- [ ] Code syntax highlighting
- [ ] Dark/Light theme toggle
- [ ] Cloud sync

## License

Open source - feel free to modify and distribute

## Support

For issues or suggestions, check the code comments or create an issue in the repository.

---

**Enjoy your AI conversations with AiComp!** 🚀
