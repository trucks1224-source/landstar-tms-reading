// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
function playExportSound() {
  try {
    const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [190, 250].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime;
      osc.frequency.value = freq;
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.0001, start);
      [0, 0.42].forEach((offset) => {
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.08, start + offset + 0.025);
        gain.gain.setValueAtTime(0.08, start + offset + 0.23);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.29);
      });
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.75);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // Sound is optional.
  }
}

// Greets the signed-in agent by posting code with a warm, natural voice. Voices load
// asynchronously in some browsers, so wait for them before speaking.
const WELCOME_LINES = [
  code => `Hey, welcome back${code ? `, agent ${code}` : ''}! Good to see you.`,
  code => `Hi${code ? `, agent ${code}` : ''}! Welcome back.`,
  code => `Welcome back${code ? `, agent ${code}` : ''}. Hope you're doing well today.`,
];

function speakWelcomeGreeting(postingCode) {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
    const code = String(postingCode || '').trim().toUpperCase();
    // Spell the posting code letter by letter so it reads naturally.
    const spokenCode = code.split('').join(' ');
    const line = WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)];
    const utterance = new SpeechSynthesisUtterance(line(spokenCode));
    utterance.pitch = 1;
    utterance.rate = 1;
    utterance.volume = 0.9;
    const speak = () => {
      const voices = window.speechSynthesis.getVoices();
      // Prefer Chrome's natural-sounding Google voices; they avoid the robotic
      // tone of the older Microsoft desktop voices.
      const preferred = voices.find(voice => /^google us english$/i.test(voice.name))
        || voices.find(voice => /google uk english female/i.test(voice.name))
        || voices.find(voice => /^google/i.test(voice.name) && /^en([-_]|$)/i.test(voice.lang))
        || voices.find(voice => /aria|jenny|samantha/i.test(voice.name))
        || voices.find(voice => /^en([-_]|$)/i.test(voice.lang));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
    if (window.speechSynthesis.getVoices().length) {
      speak();
      return;
    }
    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      speak();
    };
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    // Some browsers never fire voiceschanged; speak with the default voice after a short wait.
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      if (!window.speechSynthesis.speaking) speak();
    }, 500);
  } catch {
    // The greeting is optional.
  }
}

export {
  playExportSound,
  WELCOME_LINES,
  speakWelcomeGreeting
};
