(() => {
  let openingCreate = false;

  function openRequestedCreateScreen() {
    if (openingCreate) return;
    const params = new URLSearchParams(location.search);
    if (location.pathname !== '/' || params.get('create') !== '1') return;
    const button = document.querySelector('#lobby-create');
    if (!button) return;
    openingCreate = true;
    history.replaceState({}, '', '/');
    button.click();
  }

  document.addEventListener('click', (event) => {
    const createButton = event.target.closest?.('#create-room');
    if (!createButton || !location.pathname.startsWith('/room/')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign('/?create=1');
  }, true);

  const observer = new MutationObserver(openRequestedCreateScreen);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  openRequestedCreateScreen();
})();
