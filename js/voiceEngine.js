import { clamp } from './utils.js';

let active = false;
let currentCallback = null;

export function isVoiceSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

function pickRussianVoice() {
  if (!isVoiceSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(v => /^ru/i.test(v.lang) && /google|yandex|milena|irina|pavel/i.test(v.name)) ||
    voices.find(v => /^ru/i.test(v.lang)) ||
    null
  );
}

export function stopVoice() {
  if (isVoiceSupported()) window.speechSynthesis.cancel();
  if (active) {
    active = false;
    currentCallback?.(false);
  }
  currentCallback = null;
}

export function isSpeaking() {
  return active;
}

export function speakMemory(memory, onStateChange = () => {}) {
  if (!isVoiceSupported() || !memory?.input?.text) return false;

  if (active) {
    stopVoice();
    return false;
  }

  window.speechSynthesis.cancel();
  const mood = memory.mood || {};
  const style = memory.style || {};

  const utterance = new SpeechSynthesisUtterance(`${memory.title}. ${memory.input.text}`);
  utterance.lang = 'ru-RU';
  const voice = pickRussianVoice();
  if (voice) utterance.voice = voice;

  const energy = clamp((mood.energy ?? 0.45) * 0.6 + (style.motionSpeed ?? 0.45) * 0.4);
  utterance.rate = Math.round((0.8 + energy * 0.36) * 100) / 100;
  utterance.pitch = Math.round((0.88 + clamp(mood.valence ?? 0.5) * 0.22 - clamp(mood.calm ?? 0.5) * 0.06) * 100) / 100;

  currentCallback = onStateChange;
  active = true;
  onStateChange(true);

  const finish = () => {
    if (currentCallback === onStateChange) {
      active = false;
      currentCallback = null;
      onStateChange(false);
    }
  };
  utterance.onend = finish;
  utterance.onerror = finish;

  window.speechSynthesis.speak(utterance);
  return true;
}