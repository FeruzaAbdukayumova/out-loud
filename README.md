# Out Loud

A reading-practice page: read a passage aloud and it shows which words you got right and which to work on. Tap any word to hear how it should sound.

**Live demo:** https://feruzaabdukayumova.github.io/out-loud/

## How it works

- **Speech recognition** (`SpeechRecognition` / `webkitSpeechRecognition`) transcribes what you read, and the transcript is aligned word by word against the passage.
- Reading stops by itself a few seconds after you stop talking.
- **Speech synthesis** (`speechSynthesis`) plays the correct pronunciation of any word you tap.
- It's a single `index.html` with no dependencies and no build step.

Works in Chrome, Edge and Safari. It needs microphone access, plus an internet connection for the browser's speech recognition.

## Run locally

The microphone only works on `https://` or `localhost`, so serve the folder rather than opening the file directly:

```bash
npx serve .
```
