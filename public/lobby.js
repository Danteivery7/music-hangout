(() => {
  const app = document.querySelector('#app');
  const toastRegion = document.querySelector('#toast-region');
  const NAME_KEY = 'music-hangout-name';
  let browseTimer = null;
  let browseRequest = 0;

  const icon = {
    music: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`,
    back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
    users: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.5"/><path d="M20 4v7h-7"/></svg>`,
    spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></svg>`,
  };

  const esc = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const savedName = () => localStorage.getItem(NAME_KEY) || '';
  const cleanCode = (value = '') => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

  function toast(message, error = false) {
    const node = document.createElement('div');
    node.className = `toast ${error ? 'error' : ''}`;
    node.textContent = message;
    toastRegion?.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function stopBrowseRefresh() {
    if (browseTimer) clearInterval(browseTimer);
    browseTimer = null;
    browseRequest += 1;
  }

  function brandMarkup() {
    return `<div class="lobby-brand-mark">${icon.music}</div><span>Music Hangout</span>`;
  }

  async function fadeAndGo(code) {
    const safe = cleanCode(code);
    if (!safe) return;
    stopBrowseRefresh();
    document.body.classList.add('lobby-is-leaving');
    app.innerHTML = `<div class="shell lobby-transition-screen"><div class="lobby-transition-mark">${icon.music}</div><strong>Joining the room…</strong><span>Syncing the queue and getting your audio ready.</span></div>`;
    await new Promise((resolve) => setTimeout(resolve, 720));
    location.assign(`/room/${safe}`);
  }

  function getName(input) {
    const name = String(input?.value || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    if (!name) {
      toast('Tell us what you want to be called first.', true);
      input?.focus();
      return null;
    }
    localStorage.setItem(NAME_KEY, name);
    return name;
  }

  function patchHomeLanding() {
    if (location.pathname.startsWith('/room/')) return;
    const shell = document.querySelector('.landing-shell');
    const card = document.querySelector('.join-card');
    if (!shell || !card || shell.classList.contains('lobby-custom-screen') || card.dataset.lobbyPatched === '1') return;

    card.dataset.lobbyPatched = '1';
    card.classList.add('lobby-home-card');
    card.innerHTML = `
      <div class="lobby-card-kicker">Your music, your room</div>
      <h2>Where do you want to go?</h2>
      <p>Create your own session, browse what is live right now, or jump straight into a private room with a code.</p>
      <div class="lobby-menu-actions">
        <button id="lobby-create" class="btn btn-primary lobby-menu-button">
          <span class="lobby-menu-icon">${icon.spark}</span>
          <span><strong>Create a room</strong><small>Name it and choose public or private.</small></span>
          <span class="lobby-menu-arrow">${icon.arrow}</span>
        </button>
        <button id="lobby-browse" class="btn btn-secondary lobby-menu-button">
          <span class="lobby-menu-icon">${icon.globe}</span>
          <span><strong>Browse rooms</strong><small>See the sessions that are active right now.</small></span>
          <span class="lobby-menu-arrow">${icon.arrow}</span>
        </button>
      </div>
      <div class="divider">or</div>
      <button id="lobby-code" class="lobby-code-link" type="button">I already have a room code <span>${icon.arrow}</span></button>`;

    card.querySelector('#lobby-create')?.addEventListener('click', renderCreateRoom);
    card.querySelector('#lobby-browse')?.addEventListener('click', renderBrowseRooms);
    card.querySelector('#lobby-code')?.addEventListener('click', renderJoinCode);
  }

  function renderCreateRoom() {
    stopBrowseRefresh();
    app.innerHTML = `
      <div class="shell landing-shell lobby-shell lobby-custom-screen">
        <div class="lobby-topbar">
          <button class="lobby-brand-button" id="lobby-home">${brandMarkup()}</button>
          <button class="lobby-back" id="lobby-back">${icon.back}<span>Back</span></button>
        </div>
        <section class="lobby-setup-layout">
          <div class="lobby-setup-copy">
            <div class="eyebrow">Create a session</div>
            <h1>Make it <span class="gradient-text">yours.</span></h1>
            <p>Give the room a name, decide who can jump in, then send the link or let people find you in Browse Rooms.</p>
            <div class="lobby-preview-card">
              <div class="lobby-preview-orb">${icon.music}</div>
              <div><span>Live room preview</span><strong id="room-preview-name">Untitled room</strong><small id="room-preview-privacy">Public · anyone can join</small></div>
            </div>
          </div>
          <form class="card lobby-setup-card" id="create-room-form">
            <div class="lobby-step"><span>01</span><div><strong>Who are you?</strong><small>This is the name people will see inside the room.</small></div></div>
            <label class="form-label" for="create-display-name">What is the name that you want to be called in the room?</label>
            <input id="create-display-name" class="input" maxlength="28" autocomplete="nickname" placeholder="Your display name" value="${esc(savedName())}" />

            <div class="lobby-form-divider"></div>
            <div class="lobby-step"><span>02</span><div><strong>Name the room</strong><small>Keep it short so it looks good in the room browser.</small></div></div>
            <label class="form-label" for="create-room-name">Room name</label>
            <input id="create-room-name" class="input" maxlength="48" placeholder="Late Night Queue" />

            <div class="lobby-form-divider"></div>
            <div class="lobby-step"><span>03</span><div><strong>Choose who can join</strong><small>You can still share the room code either way.</small></div></div>
            <div class="visibility-picker" role="radiogroup" aria-label="Room visibility">
              <button class="visibility-option is-selected" type="button" data-visibility="public" aria-pressed="true">
                <span class="visibility-icon">${icon.globe}</span>
                <span><strong>Public</strong><small>Listed in Browse Rooms. Anyone can join.</small></span>
                <span class="visibility-check"></span>
              </button>
              <button class="visibility-option" type="button" data-visibility="private" aria-pressed="false">
                <span class="visibility-icon">${icon.lock}</span>
                <span><strong>Private</strong><small>Listed as locked. A room code is required.</small></span>
                <span class="visibility-check"></span>
              </button>
            </div>
            <button class="btn btn-primary lobby-create-final" id="create-room-final" type="submit">Create room ${icon.arrow}</button>
          </form>
        </section>
      </div>`;

    const form = document.querySelector('#create-room-form');
    const roomNameInput = document.querySelector('#create-room-name');
    const previewName = document.querySelector('#room-preview-name');
    const previewPrivacy = document.querySelector('#room-preview-privacy');
    let visibility = 'public';

    const goHome = () => location.assign('/');
    document.querySelector('#lobby-home')?.addEventListener('click', goHome);
    document.querySelector('#lobby-back')?.addEventListener('click', goHome);

    roomNameInput?.addEventListener('input', () => {
      if (previewName) previewName.textContent = roomNameInput.value.trim() || 'Untitled room';
    });

    document.querySelectorAll('[data-visibility]').forEach((button) => {
      button.addEventListener('click', () => {
        visibility = button.dataset.visibility === 'private' ? 'private' : 'public';
        document.querySelectorAll('[data-visibility]').forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle('is-selected', selected);
          candidate.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        if (previewPrivacy) previewPrivacy.textContent = visibility === 'public' ? 'Public · anyone can join' : 'Private · room code required';
      });
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const nameInput = document.querySelector('#create-display-name');
      const creatorName = getName(nameInput);
      if (!creatorName) return;
      const roomName = String(roomNameInput?.value || '').trim().replace(/\s+/g, ' ').slice(0, 48);
      if (!roomName) {
        toast('Give your room a name first.', true);
        roomNameInput?.focus();
        return;
      }

      const submit = document.querySelector('#create-room-final');
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Creating your room…';
      }

      try {
        const response = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roomName, visibility, creatorName }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not create the room.');
        await fadeAndGo(data.roomCode);
      } catch (error) {
        toast(error.message || 'Could not create the room.', true);
        if (submit) {
          submit.disabled = false;
          submit.innerHTML = `Create room ${icon.arrow}`;
        }
      }
    });

    roomNameInput?.focus({ preventScroll: true });
  }

  function renderJoinCode() {
    stopBrowseRefresh();
    app.innerHTML = `
      <div class="shell landing-shell lobby-shell lobby-custom-screen lobby-centered-screen">
        <div class="lobby-topbar">
          <button class="lobby-brand-button" id="lobby-home">${brandMarkup()}</button>
          <button class="lobby-back" id="lobby-back">${icon.back}<span>Back</span></button>
        </div>
        <section class="card lobby-code-card">
          <div class="lobby-lock-hero">${icon.lock}</div>
          <div class="eyebrow">Join with a code</div>
          <h1>Jump into the room.</h1>
          <p>If a room is private, this is the way in. Your display name is remembered for next time.</p>
          <form id="join-code-form" class="lobby-code-form">
            <label class="form-label" for="code-display-name">What should we call you?</label>
            <input id="code-display-name" class="input" maxlength="28" autocomplete="nickname" placeholder="Your display name" value="${esc(savedName())}" />
            <label class="form-label" for="join-code-input">Room code</label>
            <input id="join-code-input" class="input room-code-input lobby-code-input" maxlength="6" autocomplete="off" placeholder="ABC123" />
            <button class="btn btn-primary" type="submit">Join room ${icon.arrow}</button>
          </form>
        </section>
      </div>`;

    const goHome = () => location.assign('/');
    document.querySelector('#lobby-home')?.addEventListener('click', goHome);
    document.querySelector('#lobby-back')?.addEventListener('click', goHome);
    document.querySelector('#join-code-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = getName(document.querySelector('#code-display-name'));
      if (!name) return;
      const codeInput = document.querySelector('#join-code-input');
      const code = cleanCode(codeInput?.value);
      if (code.length < 4) {
        toast('Enter a valid room code.', true);
        codeInput?.focus();
        return;
      }
      try {
        const response = await fetch(`/api/rooms/${code}`);
        if (!response.ok) throw new Error('That room code is not active.');
        await fadeAndGo(code);
      } catch (error) {
        toast(error.message || 'Could not join that room.', true);
      }
    });
    document.querySelector('#join-code-input')?.focus({ preventScroll: true });
  }

  function roomCard(room) {
    const isPrivate = room.visibility === 'private';
    const people = Number(room.participants) || 0;
    const privacyIcon = isPrivate ? icon.lock : icon.globe;
    const now = room.currentTitle ? esc(room.currentTitle) : 'Waiting for the first song';
    const action = isPrivate
      ? `<button class="btn lobby-room-action private" data-private-id="${esc(room.browseId || '')}" data-private-name="${esc(room.roomName)}">Enter code ${icon.lock}</button>`
      : `<button class="btn lobby-room-action public" data-public-code="${esc(room.roomCode || '')}">Join room ${icon.arrow}</button>`;

    return `<article class="lobby-room-card ${isPrivate ? 'is-private' : 'is-public'}">
      <div class="lobby-room-glow"></div>
      <div class="lobby-room-card-top">
        <span class="lobby-privacy-badge ${isPrivate ? 'private' : 'public'}">${privacyIcon}${isPrivate ? 'Private' : 'Public'}</span>
        <span class="lobby-listener-count">${icon.users}<strong>${people}</strong> ${people === 1 ? 'listener' : 'listeners'}</span>
      </div>
      <div class="lobby-room-main">
        <div class="lobby-room-avatar">${icon.music}</div>
        <div>
          <h3>${esc(room.roomName || 'Untitled room')}</h3>
          <p>${isPrivate ? 'Code required to enter' : `Started by ${esc(room.creatorName || 'someone')}`}</p>
        </div>
      </div>
      <div class="lobby-now-playing"><span>Now playing</span><strong>${now}</strong></div>
      ${action}
    </article>`;
  }

  function emptyRoomsMarkup() {
    return `<div class="lobby-empty-rooms">
      <div class="lobby-empty-icon">${icon.music}</div>
      <h3>No rooms are live yet.</h3>
      <p>Be the first one on aux. Create a room and it will show up here instantly.</p>
      <button class="btn btn-primary" id="empty-create-room">Create the first room ${icon.arrow}</button>
    </div>`;
  }

  async function loadRooms(showLoader = false) {
    const grid = document.querySelector('#browse-room-grid');
    if (!grid) return;
    const requestId = ++browseRequest;
    if (showLoader) grid.innerHTML = `<div class="lobby-room-loader"><span></span><span></span><span></span><small>Finding active sessions…</small></div>`;

    try {
      const response = await fetch('/api/rooms/browse', { headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load rooms.');
      if (requestId !== browseRequest || !document.querySelector('#browse-room-grid')) return;
      const rooms = Array.isArray(data.rooms) ? data.rooms : [];
      grid.innerHTML = rooms.length ? rooms.map(roomCard).join('') : emptyRoomsMarkup();
      document.querySelector('#browse-count')?.replaceChildren(document.createTextNode(`${rooms.length} active ${rooms.length === 1 ? 'room' : 'rooms'}`));
      bindRoomCards();
      document.querySelector('#empty-create-room')?.addEventListener('click', renderCreateRoom);
    } catch (error) {
      if (requestId !== browseRequest || !document.querySelector('#browse-room-grid')) return;
      grid.innerHTML = `<div class="lobby-empty-rooms"><h3>Couldn’t load the room list.</h3><p>${esc(error.message || 'Try again in a moment.')}</p><button class="btn btn-secondary" id="browse-retry">Try again</button></div>`;
      document.querySelector('#browse-retry')?.addEventListener('click', () => loadRooms(true));
    }
  }

  function openPrivatePrompt(browseId, roomName) {
    document.querySelector('.lobby-private-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'lobby-private-modal';
    modal.innerHTML = `<div class="card lobby-private-dialog">
      <button class="lobby-modal-close" type="button" aria-label="Close">×</button>
      <div class="lobby-lock-hero small">${icon.lock}</div>
      <div class="eyebrow">Private room</div>
      <h2>${esc(roomName || 'Locked room')}</h2>
      <p>This room is visible in the browser, but the code stays private. Enter it to join.</p>
      <form id="private-room-form">
        <label class="form-label" for="private-room-code">Room code</label>
        <input id="private-room-code" class="input room-code-input lobby-code-input" maxlength="6" autocomplete="off" placeholder="ABC123" />
        <button class="btn btn-primary" type="submit">Unlock room ${icon.arrow}</button>
      </form>
    </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.lobby-modal-close')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    modal.querySelector('#private-room-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = getName(document.querySelector('#browse-display-name'));
      if (!name) {
        close();
        return;
      }
      const input = modal.querySelector('#private-room-code');
      const code = cleanCode(input?.value);
      if (code.length < 4) return toast('Enter the room code.', true);
      try {
        const response = await fetch(`/api/rooms/${code}`);
        const state = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('That room code is not active.');
        if (browseId && state.browseId && state.browseId !== browseId) throw new Error('That code belongs to a different room.');
        await fadeAndGo(code);
      } catch (error) {
        toast(error.message || 'Could not unlock that room.', true);
        input?.select();
      }
    });
    modal.querySelector('#private-room-code')?.focus({ preventScroll: true });
  }

  function bindRoomCards() {
    document.querySelectorAll('[data-public-code]').forEach((button) => {
      button.addEventListener('click', async () => {
        const name = getName(document.querySelector('#browse-display-name'));
        if (!name) return;
        await fadeAndGo(button.dataset.publicCode);
      });
    });
    document.querySelectorAll('[data-private-id]').forEach((button) => {
      button.addEventListener('click', () => openPrivatePrompt(button.dataset.privateId, button.dataset.privateName));
    });
  }

  function renderBrowseRooms() {
    stopBrowseRefresh();
    app.innerHTML = `
      <div class="shell landing-shell lobby-shell lobby-custom-screen lobby-browse-screen">
        <div class="lobby-topbar">
          <button class="lobby-brand-button" id="lobby-home">${brandMarkup()}</button>
          <div class="lobby-topbar-actions">
            <button class="lobby-back" id="lobby-back">${icon.back}<span>Back</span></button>
            <button class="btn btn-secondary lobby-top-create" id="browse-create">Create room</button>
          </div>
        </div>
        <section class="lobby-browse-header">
          <div>
            <div class="eyebrow">Live right now</div>
            <h1>Browse <span class="gradient-text">active rooms.</span></h1>
            <p>Public rooms are one click away. Private rooms still appear here, but the room code stays between you and the host.</p>
          </div>
          <div class="card lobby-browser-name">
            <label class="form-label" for="browse-display-name">What should we call you in the room?</label>
            <input id="browse-display-name" class="input" maxlength="28" autocomplete="nickname" placeholder="Your display name" value="${esc(savedName())}" />
            <small>Saved on this device for next time.</small>
          </div>
        </section>
        <div class="lobby-browser-toolbar">
          <div><span class="live-dot"></span><strong id="browse-count">Loading rooms…</strong></div>
          <button id="browse-refresh" class="lobby-refresh" type="button">${icon.refresh}<span>Refresh</span></button>
        </div>
        <section id="browse-room-grid" class="lobby-room-grid"></section>
      </div>`;

    const goHome = () => location.assign('/');
    document.querySelector('#lobby-home')?.addEventListener('click', goHome);
    document.querySelector('#lobby-back')?.addEventListener('click', goHome);
    document.querySelector('#browse-create')?.addEventListener('click', renderCreateRoom);
    document.querySelector('#browse-refresh')?.addEventListener('click', () => loadRooms(true));
    document.querySelector('#browse-display-name')?.addEventListener('change', (event) => {
      const value = String(event.currentTarget.value || '').trim().replace(/\s+/g, ' ').slice(0, 28);
      if (value) localStorage.setItem(NAME_KEY, value);
    });

    loadRooms(true);
    browseTimer = setInterval(() => loadRooms(false), 5000);
  }

  async function decorateRoomHeader() {
    const shell = document.querySelector('.room-shell');
    const topbar = shell?.querySelector('.room-topbar');
    if (!shell || !topbar || topbar.querySelector('.room-session-title') || shell.dataset.lobbyDecorating === '1') return;
    const match = location.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})\/?$/);
    if (!match) return;
    shell.dataset.lobbyDecorating = '1';
    try {
      const response = await fetch(`/api/rooms/${cleanCode(match[1])}`);
      const state = await response.json().catch(() => ({}));
      if (!response.ok || !document.querySelector('.room-shell')) return;
      const identity = document.createElement('div');
      identity.className = 'room-session-title';
      identity.innerHTML = `<div><span>Room</span><strong>${esc(state.roomName || `Room ${match[1].toUpperCase()}`)}</strong></div><span class="room-visibility-badge ${state.visibility === 'public' ? 'public' : 'private'}">${state.visibility === 'public' ? icon.globe : icon.lock}${state.visibility === 'public' ? 'Public' : 'Private'}</span>`;
      const brand = topbar.querySelector('.room-brand');
      brand?.insertAdjacentElement('afterend', identity);
    } finally {
      shell.dataset.lobbyDecorating = '0';
    }
  }

  const observer = new MutationObserver(() => {
    patchHomeLanding();
    decorateRoomHeader();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  patchHomeLanding();
  decorateRoomHeader();
})();
