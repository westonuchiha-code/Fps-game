import type { Game } from '../game';

/** The one game instance. Set once at boot; modules read it at run time (never at import time). */
export let G: Game;
export function setGame(g: Game) {
  G = g;
}
