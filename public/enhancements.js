(() => {
  const BG_AUDIO_URL = '/Late%20Night%20Polish.mp3';
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
  let bgStarting = false;

  // Landing ambience is a normal local site asset. No remote CDN and no playback prompt.
  const bgAudio = new Audio(BG_AUDIO_URL);
  bgAudio.loop = true;
  bgAudio.autoplay = true;
  bgAudio.preload = 'auto';
  bgAudio.volume = 0;
  bgAudio.muted = false;
  bgAudio.setAttribute('aria-hidden', 'true');

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
    } catch {}
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
        <div class="room-volume-header"><span>Volume</span><strong id="room-volume-value">${playerMuted ? 'Muted' : `${Math.round(playerVolume)}%`}</strong></div>
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
    } catch {}
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
  } catch {}

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
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      bgAudio.volume = clamp(startVolume + delta * eased, 0, 1);
      if (progress < 1) bgFadeFrame = requestAnimationFrame(step);
      else {
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

  async function startBackground(fromGesture = false) {
    if (!bgWanted || bgStarting) return;
    if (!bgAudio.paused) {
      fadeBackgroundTo(BG_TARGET_VOLUME, fromGesture ? 350 : 650, false);
      return;
    }
    bgStarting = true;
    try {
      bgAudio.muted = false;
      bgAudio.volume = 0;
      await bgAudio.play();
      if (bgWanted) fadeBackgroundTo(BG_TARGET_VOLUME, fromGesture ? 350 : 650, false);
      else bgAudio.pause();
    } catch {
      // Audible autoplay can be denied by the browser. We retry invisibly on the
      // first real interaction below. There is intentionally no playback prompt.
    } finally {
      bgStarting = false;
    }
  }

  function retryBackgroundFromGesture() {
    if (bgWanted && bgAudio.paused) startBackground(true);
  }

  function stopBackground() {
    if (bgAudio.paused) {
      bgAudio.volume = 0;
      bgAudio.currentTime = 0;
      return;
    }
    fadeBackgroundTo(0, BG_FADE_MS, true);
  }

  function syncLandingAudio() {
    const landingVisible = Boolean(document.querySelector('.landing-shell'));
    if (landingVisible === bgWanted) return;
    bgWanted = landingVisible;
    if (landingVisible) startBackground(false);
    else stopBackground();
  }

  // Always attempt autoplay immediately. If browser policy blocks audible
  // autoplay, unlock it silently on the first interaction with no extra UI.
  document.addEventListener('pointerdown', retryBackgroundFromGesture, { capture: true, passive: true });
  document.addEventListener('touchstart', retryBackgroundFromGesture, { capture: true, passive: true });
  document.addEventListener('keydown', retryBackgroundFromGesture, { capture: true });
  bgAudio.addEventListener('canplay', () => {
    if (bgWanted && bgAudio.paused) startBackground(false);
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
    } catch {}
  }, 1500);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && bgWanted && bgAudio.paused) startBackground(false);
  });

  ensureVolumeControl();
  syncLandingAudio();
})();
