// Runs inside the game's page, before the game. It is added by tools/handheld.mjs, not by the game.
// The rig around the game posts the state of its on-screen controllers; here that becomes an
// ordinary standard-layout gamepad, so the game is driven exactly as by a real controller.
(() => {
  const pad = {
    id: 'Handheld test rig',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  addEventListener('message', (e) => {
    const m = e.source === parent && e.data && e.data.emgPad;
    if (!m) return;
    for (let i = 0; i < 4; i++) pad.axes[i] = +m.axes[i] || 0;
    for (let i = 0; i < 17; i++) {
      const v = +m.buttons[i] || 0;
      pad.buttons[i].value = v;
      pad.buttons[i].pressed = pad.buttons[i].touched = v > 0.5;
    }
    pad.timestamp = performance.now();
  });
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
})();
