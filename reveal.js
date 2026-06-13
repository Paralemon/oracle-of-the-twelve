// The gold word-reveal — text arrives word by word, each word glowing molten
// gold and cooling to parchment (the color work lives in CSS on .word/.shown;
// this module owns the pacing and lifecycle).

// Active reveals — more than one can be in flight at once (the main reading +
// an in-progress oracle answer), tracked as a set so the panel can cancel them
// all on close / recast.
const activeReveals = new Set();

export function cancelAllReveals() {
  activeReveals.forEach(r => r.cancel && r.cancel());
  activeReveals.clear();
}

// For handles created outside revealInto (e.g. the fade-out timer that runs
// before a reveal starts) so cancelAllReveals covers them too.
export function trackReveal(handle) { activeReveals.add(handle); }

// Pacing. Step is per-character (not per-word) so longer words consume more
// time before the next starts — the reveal cadence stays even instead of
// feeling jumpy across word lengths. Combined with the long .9s word fade in
// CSS, many words are always in-flight at once: a continuous wave of opacity
// rather than discrete pops. Tuned so a ~210-word reading takes roughly 12s.
const REVEAL_STEP_PER_CHAR  = 7;   // ms added per character of the word
const REVEAL_MIN_STEP       = 18;  // floor for very short words ("a", "is")
const REVEAL_SENTENCE_PAUSE = 220; // extra pause after `.` / `!` / `?`
const REVEAL_PARAGRAPH_PAUSE = 600; // extra pause between paragraphs

// Generic word-reveal — targets any element, so it works for the main reading
// body AND for individual oracle-answer turns appended in the dialog area.
// Returns a handle with .cancel() that skips to the fully-revealed state.
export function revealInto(target, text, opts) {
  opts = opts || {};
  // Respect the OS-level reduced-motion preference: show the full text at once
  // instead of the ~12s word-by-word animation.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    opts = Object.assign({}, opts, { instant: true });
  }
  target.classList.remove('dim', 'fading');
  target.classList.add('revealing');
  target.textContent = '';

  // Split on blank lines so paragraph breaks survive in the rendered output
  // (the target uses `white-space: pre-wrap`, so the `\n\n` we re-insert below
  // renders as a real blank line).
  const paragraphs = text.split(/\n\n+/);
  const words = [];
  paragraphs.forEach((para, pi) => {
    if (pi > 0) target.appendChild(document.createTextNode('\n\n'));
    // Keep whitespace runs as their own tokens so spacing inside the paragraph
    // is preserved exactly when we re-assemble the DOM.
    const tokens = para.split(/(\s+)/);
    let lastWordSpan = null;
    tokens.forEach(tok => {
      if (!tok) return;
      if (/^\s+$/.test(tok)) {
        target.appendChild(document.createTextNode(tok));
      } else {
        const s = document.createElement('span');
        s.className = 'word';
        s.textContent = tok;
        target.appendChild(s);
        words.push({ el: s, text: tok, endsParagraph: false });
        lastWordSpan = words[words.length - 1];
      }
    });
    if (lastWordSpan && pi < paragraphs.length - 1) lastWordSpan.endsParagraph = true;
  });

  if (opts.instant) {
    words.forEach(w => w.el.classList.add('shown'));
    target.classList.remove('revealing');
    if (opts.onComplete) opts.onComplete();
    return { cancel: () => {} };
  }

  // Schedule each word's fade-in at an accumulating delay.
  const timers = [];
  let delay = 0;
  words.forEach((w) => {
    timers.push(setTimeout(() => w.el.classList.add('shown'), delay));
    delay += Math.max(REVEAL_MIN_STEP, w.text.length * REVEAL_STEP_PER_CHAR);
    if (/[.!?]$/.test(w.text)) delay += REVEAL_SENTENCE_PAUSE;
    if (w.endsParagraph) delay += REVEAL_PARAGRAPH_PAUSE;
  });
  // One more timer to drop the `revealing` class (and pointer cursor) and
  // fire onComplete once the last word has had time to finish its fade-in.
  const handle = {
    cancel: () => {
      timers.forEach(clearTimeout);
      words.forEach(w => w.el.classList.add('shown'));
      target.classList.remove('revealing');
      activeReveals.delete(handle);
      if (opts.onComplete) opts.onComplete();
    },
  };
  timers.push(setTimeout(() => {
    target.classList.remove('revealing');
    activeReveals.delete(handle);
    if (opts.onComplete) opts.onComplete();
  }, delay + 600));

  // Tap on the target during reveal skips to the full text.
  const tapToSkip = () => handle.cancel();
  target.addEventListener('click', tapToSkip, { once: true });

  activeReveals.add(handle);
  return handle;
}
