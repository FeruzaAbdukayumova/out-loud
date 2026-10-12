/** Reading words and texts aloud with the browser's own voices. */

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/**
 * Chrome's online voices go silent about 15 seconds into an utterance, which cuts a long text
 * off mid-way. Speaking it a sentence at a time avoids that.
 */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]*["'”’)]*/g) ?? []).map((s) => s.trim()).filter(Boolean)
}

function englishVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang === 'en-US' && v.localService) ??
    voices.find((v) => v.lang === 'en-US') ??
    voices.find((v) => v.lang.startsWith('en'))
  )
}

export function speak(text: string, rate = 0.85) {
  if (!canSpeak()) return
  speechSynthesis.cancel()
  const voice = englishVoice()
  for (const sentence of sentences(text)) {
    const u = new SpeechSynthesisUtterance(sentence)
    u.lang = 'en-US'
    u.rate = rate
    if (voice) u.voice = voice
    speechSynthesis.speak(u)
  }
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel()
}
