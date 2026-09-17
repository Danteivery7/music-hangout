(() => {
  const BG_AUDIO_URL = 'https://cdn1.suno.ai/ae48d12d-608a-40c2-9f08-4c1c0589d0d8.mp3';
  const BG_TARGET_VOLUME = 0.10;
  const BG_FADE_MS = 650;
  const VOLUME_KEY = 'music-hangout-player-volume';
  const MUTED_KEY = 'music-hangout-player-muted';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  let playerVolume = clamp(Number(localStorage.getItem(VOLUME_KEY) ?? 70), 0, 100);
  if (!Number.isFinite(playerVolume)) playerVolume = 70;
  let playerMuted = localStorage.getItem(MUTED_KEY) === '1';
  let capturedPlayer = null;
  let bgFadeFrame = null;
  let bgWanted = false;
  let bgBlocked = false;
  let bgStarting = false;

  const bgAudio = new Audio();
  bgAudio.src = BG_AUDIO_URL;
  bgAudio.loop = true;
  bgAudio.preload = 'auto';
  bgAudio.volume = 0;
  bgAudio.muted = false;
  bgAudio.setAttribute('aria-hidden', 'true');
  bgAudio.load();

  function savePlayerAudioState() {
    localStorage.setItem(VOLUME_KEY, String(Math.round(playerVolume)));
    localStorage.setItem(MUTED_KEY, playerMuted ? '1' : '0');
  }

  function applyPlayerVolume(player = capturedPlayer) {
    if (!player) return;
    try {
      player.setVolume?.(Math.round(playerVolume));
      if (playerMuted || playerVolume <= 0) player.mute?.();
      else player.unMute?.();
    } catch {
      // The iframe may not be ready yet. onReady will apply it again.
    }
  }

  function volumeIcon(muted = playerMuted || playerVolume <= 0) {
    return muted
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.8 8.5H3v7h3.8L11 19V5Z"/><path d="m16 9 5 5m0-5-5 5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.8 8.5H3v7h3.8L11 19V5Z"/><path d="M15.2 9.1a4 4 0 0 1 0 5.8M18 6.5a7.4 7.4 0 0 1 0 11"/></svg>';
  }

  function updateVolumeUI() {
    const slider = document.querySelector('#room-volume-slider');
    const value = document.querySelector('#room-volume-value');
    const button = document.querySelector('#room-volume-mute');
    if (slider && document.activeElement !== slider) slider.value = String(Math.round(playerVolume));
    if (value) value.textContent = playerMuted ? 'Muted' : `${Math.round(playerVolume)}%`;
    if (button) {
      button.innerHTML = volumeIcon();
      button.classList.toggle('is-muted', playerMuted || playerVolume <= 0);
      button.setAttribute('aria-pressed', playerMuted ? 'true' : 'false');
      button.setAttribute('aria-label', playerMuted ? 'Unmute music' : 'Mute music');
      button.title = playerMuted ? 'Unmute music' : 'Mute music';
    }
  }

  function ensureVolumeControl() {
    const panel = document.querySelector('.now-panel');
    if (!panel || panel.querySelector('.room-volume-control')) return;

    const control = document.createElement('div');
    control.className = 'room-volume-control';
    control.innerHTML = `
      <button id="room-volume-mute" class="room-volume-mute" type="button" aria-pressed="${playerMuted ? 'true' : 'false'}"></button>
      <div class="room-volume-main">
        <div class="room-volume-header">
          <span>Volume</span>
          <strong id="room-volume-value">${playerMuted ? 'Muted' : `${Math.round(playerVolume)}%`}</strong>
        </div>
        <input id="room-volume-slider" class="room-volume-slider" type="range" min="0" max="100" step="1" value="${Math.round(playerVolume)}" aria-label="Music volume" />
      </div>`;
    panel.appendChild(control);

    const slider = control.querySelector('#room-volume-slider');
    const mute = control.querySelector('#room-volume-mute');

    slider.addEventListener('input', () => {
      playerVolume = clamp(Number(slider.value) || 0, 0, 100);
      playerMuted = playerVolume <= 0;
      savePlayerAudioState();
      applyPlayerVolume();
      updateVolumeUI();
    });

    mute.addEventListener('click', () => {
      playerMuted = !playerMuted;
      savePlayerAudioState();
      applyPlayerVolume();
      updateVolumeUI();
    });

    updateVolumeUI();
    applyPlayerVolume();
  }

  function wrapYouTubePlayer() {
    if (!window.YT?.Player || window.YT.Player.__musicHangoutVolumeHook) return false;

    const OriginalPlayer = window.YT.Player;
    function MusicHangoutPlayer(element, options = {}) {
      const originalReady = options.events?.onReady;
      const originalStateChange = options.events?.onStateChange;
      const wrappedOptions = {
        ...options,
        events: {
          ...(options.events || {}),
          onReady(event) {
            capturedPlayer = event.target;
            window.__musicHangoutPlayer = event.target;
            applyPlayerVolume(event.target);
            originalReady?.(event);
          },
          onStateChange(event) {
            capturedPlayer = event.target || capturedPlayer;
            window.__musicHangoutPlayer = capturedPlayer;
            originalStateChange?.(event);
          },
        },
      };

      const player = new OriginalPlayer(element, wrappedOptions);
      capturedPlayer = player;
      window.__musicHangoutPlayer = player;
      setTimeout(() => applyPlayerVolume(player), 300);
      return player;
    }

    try {
      MusicHangoutPlayer.prototype = OriginalPlayer.prototype;
      Object.setPrototypeOf(MusicHangoutPlayer, OriginalPlayer);
    } catch {
      // Static inheritance is only a compatibility nicety.
    }
    MusicHangoutPlayer.__musicHangoutVolumeHook = true;
    window.YT.Player = MusicHangoutPlayer;
    return true;
  }

  const existingYouTubeReady = window.onYouTubeIframeAPIReady;
  let appYouTubeReady = typeof existingYouTubeReady === 'function' ? existingYouTubeReady : null;
  try {
    Object.defineProperty(window, 'onYouTubeIframeAPIReady', {
      configurable: true,
      get() {
        return () => {
          wrapYouTubePlayer();
          appYouTubeReady?.();
        };
      },
      set(fn) {
        appYouTubeReady = typeof fn === 'function' ? fn : null;
      },
    });
  } catch {
    // Polling below still catches the player if another script owns the callback.
  }

  wrapYouTubePlayer();
  const playerHookPoll = setInterval(() => {
    if (wrapYouTubePlayer()) clearInterval(playerHookPoll);
  }, 60);
  setTimeout(() => clearInterval(playerHookPoll), 15000);

  function cancelBackgroundFade() {
    if (bgFadeFrame) cancelAnimationFrame(bgFadeFrame);
    bgFadeFrame = null;
  }

  function fadeBackgroundTo(target, duration = BG_FADE_MS, pauseAtEnd = false) {
    cancelBackgroundFade();
    const startVolume = bgAudio.volume;
    const startTime = performance.now();
    const delta = target - startVolume;

    const step = (now) => {
      const progress = clamp((now - startTime) / duration, 0, 1);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      bgAudio.volume = clamp(startVolume + delta * eased, 0, 1);

      if (progress < 1) {
        bgFadeFrame = requestAnimationFrame(step);
      } else {
        bgFadeFrame = null;
        bgAudio.volume = target;
        if (pauseAtEnd && target === 0) {
          bgAudio.pause();
          bgAudio.currentTime = 0;
        }
      }
    };

    bgFadeFrame = requestAnimationFrame(step);
  }

  function removeBackgroundPrompt() {
    document.querySelector('#background-audio-prompt')?.remove();
  }

  function ensureBackgroundPrompt() {
    if (!bgWanted || !bgBlocked || document.querySelector('#background-audio-prompt')) return;
    const button = document.createElement('button');
    button.id = 'background-audio-prompt';
    button.className = 'background-audio-prompt';
    button.type = 'button';
    button.innerHTML = `${volumeIcon(false)}<span><strong>Background music</strong><small>Click to play ambience</small></span>`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      startBackgroundFromGesture();
    });
    document.body.appendChild(button);
  }

  async function startBackground(fromGesture = false) {
    if (!bgWanted || bgStarting) return;
    if (!bgAudio.paused && !bgBlocked) {
      fadeBackgroundTo(BG_TARGET_VOLUME, 450, false);
      return;
    }

    bgStarting = true;
    try {
      bgAudio.muted = false;
      if (bgAudio.volume > BG_TARGET_VOLUME) bgAudio.volume = 0;
      const playPromise = bgAudio.play();
      if (playPromise && typeof playPromise.then === 'function') await playPromise;
      if (!bgWanted) {
        bgAudio.pause();
        return;
      }
      bgBlocked = false;
      removeBackgroundPrompt();
      fadeBackgroundTo(BG_TARGET_VOLUME, fromGesture ? 420 : 700, false);
    } catch (error) {
      bgBlocked = true;
      if (error?.name !== 'NotAllowedError') console.warn('Background music could not start:', error);
      ensureBackgroundPrompt();
    } finally {
      bgStarting = false;
    }
  }

  function startBackgroundFromGesture() {
    if (!bgWanted || (!bgAudio.paused && !bgBlocked)) return;
    startBackground(true);
  }

  function stopBackground() {
    bgBlocked = false;
    removeBackgroundPrompt();
    if (bgAudio.paused) {
      bgAudio.volume = 0;
      bgAudio.currentTime = 0;
      return;
    }
    fadeBackgroundTo(0, BG_FADE_MS, true);
  }

  function syncLandingAudio() {
    const landingVisible = Boolean(document.querySelector('.landing-shell'));
    if (landingVisible === bgWanted) {
      if (landingVisible && bgBlocked) ensureBackgroundPrompt();
      return;
    }
    bgWanted = landingVisible;
    if (landingVisible) startBackground(false);
    else stopBackground();
  }

  // Audible autoplay is often blocked. These capture-phase listeners run before
  // the site's own buttons navigate away, so the very first interaction can
  // unlock the landing music reliably.
  document.addEventListener('pointerdown', startBackgroundFromGesture, { capture: true, passive: true });
  document.addEventListener('touchstart', startBackgroundFromGesture, { capture: true, passive: true });
  document.addEventListener('keydown', startBackgroundFromGesture, { capture: true });

  bgAudio.addEventListener('canplay', () => {
    if (bgWanted && bgAudio.paused && !bgStarting) startBackground(false);
  });
  bgAudio.addEventListener('error', () => {
    if (!bgWanted) return;
    bgBlocked = true;
    ensureBackgroundPrompt();
  });

  const observer = new MutationObserver(() => {
    ensureVolumeControl();
    syncLandingAudio();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => {
    ensureVolumeControl();
    if (!capturedPlayer) capturedPlayer = window.__musicHangoutPlayer || null;
    if (!capturedPlayer || !document.querySelector('.room-shell')) return;
    try {
      if (document.activeElement?.id !== 'room-volume-slider') {
        const liveVolume = Number(capturedPlayer.getVolume?.());
        const liveMuted = Boolean(capturedPlayer.isMuted?.());
        if (Number.isFinite(liveVolume)) playerVolume = clamp(liveVolume, 0, 100);
        playerMuted = liveMuted || playerVolume <= 0;
        savePlayerAudioState();
        updateVolumeUI();
      }
    } catch {
      // Ignore while the player is being recreated.
    }
  }, 1500);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && bgWanted) startBackground(false);
  });

  ensureVolumeControl();
  syncLandingAudio();
})();
