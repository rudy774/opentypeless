# ElevenLabs Scribe + Gemini polish setup

This build supports ElevenLabs Scribe v2 as a bring-your-own-key speech-to-text
provider. It uses the existing OpenTypeless record, transcribe, polish, and paste
pipeline, so transcription starts after recording stops rather than streaming
partial text while you speak.

## Configure the providers

1. Open **Settings > Speech Recognition**.
2. Select **ElevenLabs Scribe v2** and save an ElevenLabs API key.
3. Use **Test connection** to verify the key and endpoint.
4. Open **Settings > AI Text Processing**.
5. Select **Gemini**, save a Google AI API key, and use
   `gemini-2.5-flash` as the model.
6. Enable AI polish and choose the polish style you want.

ElevenLabs requests are sent directly to
`https://api.elevenlabs.io/v1/speech-to-text` with `model_id=scribe_v2` and the
key in the `xi-api-key` header. Gemini requests also go directly to the selected
provider. Keys use the application's existing OS credential-vault storage when
available.

## Configure a mouse shortcut on Windows

In **Settings > General > Dictation shortcuts**, add the Windows mouse-macro
preset **Ctrl + Alt + Shift + F10**. In Logitech G HUB, assign a G502 X button
to emit that exact key chord.

The shortcut obeys the selected recording mode:

- **Toggle**: press once to start recording and once more to stop, transcribe,
  polish, and paste.
- **Hold**: hold the mouse button while speaking and release it to transcribe,
  polish, and paste.

If another application already owns the chord, record a different uncommon
combination in OpenTypeless and assign the same combination in G HUB.
