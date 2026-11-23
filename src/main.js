const app = document.getElementById('app');
const status = document.getElementById('startup');
const title = document.getElementById('startupTitle');
const message = document.getElementById('startupMessage');
const retry = document.getElementById('startupRetry');

function showStatus(heading, detail, canRetry = false) {
  app.inert = true;
  app.setAttribute('aria-busy', 'true');
  title.textContent = heading;
  message.textContent = detail;
  retry.hidden = !canRetry;
  status.hidden = false;
  status.setAttribute('role', canRetry ? 'alert' : 'status');
  if (canRetry) retry.focus();
}

function ready() {
  app.inert = false;
  app.removeAttribute('aria-busy');
  status.hidden = true;
}

function failed(error) {
  console.error('Stern-To could not start or continue:', error);
  const graphics = /webgl|context|graphics|shader/i.test(String(error?.message || error));
  showStatus(
    graphics ? '3D graphics unavailable' : 'The game could not load',
    graphics
      ? 'Stern-To needs WebGL 2. Check that graphics acceleration is enabled, or try a current browser on another device.'
      : 'Check your connection and reload the game. Your saved preferences will be kept.',
    true
  );
}

retry.addEventListener('click', () => location.reload());

try {
  const { startGame } = await import('./game.js?v=20261124-diagrams');
  startGame({
    onReady: ready,
    onError: failed,
    onContextLost: () => showStatus(
      'Graphics interrupted',
      'The game is paused while graphics recover. Reload if this message remains.',
      true
    ),
    onContextRestored: ready
  });
} catch (error) {
  failed(error);
}
