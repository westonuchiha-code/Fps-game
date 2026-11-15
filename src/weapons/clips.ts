import { Clip, k, ev, hand, type ClipDef } from './anim';
import type { WeaponClass } from './items';

/**
 * Hand-authored animation clips for each weapon class.
 *
 * Axes (view space): +X right, +Y up, -Z forward. Rotations in degrees:
 *   +X pitches the muzzle up, +Y swings the muzzle left, +Z rolls the top of the gun to the left.
 * Offsets are relative to each part's rest pose.
 *
 * Events: sfx:<name> plays a sound, 'ammo' fills the magazine, 'shell' loads one shell,
 * 'eject' throws a casing, 'hit' lands a melee strike, 'detonate' / 'throw' drive the mines.
 */

export type ClipName =
  | 'idle'
  | 'draw'
  | 'holster'
  | 'fire'
  | 'fireLast'
  | 'dry'
  | 'reload'
  | 'reloadEmpty'
  | 'reloadStart'
  | 'reloadShell'
  | 'reloadEnd'
  | 'reloadEndPump'
  | 'melee'
  | 'inspect'
  | 'watch'
  | 'throw';

export type ClipSet = Partial<Record<ClipName, Clip>>;

const sfx = (t: number, name: string) => ev(t, 'sfx', name);

// ---- shared left-hand gestures (same for every gun; `rest` is the support socket) ----

function watchClip(rest: string, oneHandDip: [number, number, number], dipRot: [number, number, number]): ClipDef {
  return {
    name: 'watch',
    dur: 0.78,
    tracks: {
      gun: [k(0), k(0.14, oneHandDip, dipRot, 'outCubic'), k(0.52, oneHandDip, dipRot), k(0.78, [0, 0, 0], [0, 0, 0], 'inOut')],
    },
    left: [hand(0, rest), hand(0.02, 'watch', { blend: 0.2, pose: 'relax', arc: 0.03 }), hand(0.27, 'watch', { blend: 0.05, pose: 'fist' }), hand(0.52, rest, { blend: 0.22, pose: 'fore' })],
    right: [hand(0, 'grip')],
    events: [sfx(0.04, 'cloth'), sfx(0.24, 'watch_beep'), ev(0.3, 'detonate')],
  };
}

function throwClip(rest: string, oneHandDip: [number, number, number], dipRot: [number, number, number]): ClipDef {
  return {
    name: 'throw',
    dur: 0.66,
    tracks: {
      gun: [k(0), k(0.12, oneHandDip, dipRot, 'outCubic'), k(0.4, oneHandDip, dipRot), k(0.66, [0, 0, 0], [0, 0, 0], 'inOut')],
    },
    left: [
      hand(0, rest),
      hand(0.01, 'throwBack', { blend: 0.15, pose: 'pinch' }),
      hand(0.17, 'throwFwd', { blend: 0.1, pose: 'open' }),
      hand(0.4, rest, { blend: 0.22, pose: 'fore' }),
    ],
    right: [hand(0, 'grip')],
    events: [sfx(0.02, 'cloth'), ev(0.22, 'throw'), sfx(0.2, 'mine_throw')],
  };
}

// ------------------------------------------------------------------------------------------ pistol

function pistolClips(): ClipDef[] {
  const L = 'fore';
  const slideBack: [number, number, number] = [0, 0, 0.044];
  // the magazine travels along the raked grip axis
  const magOut: [number, number, number] = [0, -0.114, 0.037];
  const magAway: [number, number, number] = [-0.07, -0.36, 0.1];
  const tilt: [number, number, number] = [-0.035, 0.05, 0.03];
  const tiltR: [number, number, number] = [22, 14, -38];

  const reloadCore = (empty: boolean): ClipDef => ({
    name: empty ? 'reloadEmpty' : 'reload',
    dur: empty ? 1.52 : 1.36,
    tracks: {
      gun: [
        k(0),
        k(0.18, tilt, tiltR, 'outCubic'),
        k(0.3, [-0.035, 0.042, 0.03], [20, 14, -38], 'inOut'), // dip as the mag is stripped
        k(0.84, tilt, tiltR, 'inOut'),
        k(0.93, [-0.035, 0.064, 0.03], [27, 14, -38], 'snap'), // bump when the new mag seats
        k(1.06, tilt, [20, 12, -32], 'out'),
        ...(empty ? [k(1.16, [-0.006, 0.008, 0.012], [6, 5, -12], 'inOut'), k(1.22, [0, 0.004, -0.014], [-5, 0, 0], 'snap'), k(1.52, [0, 0, 0], [0, 0, 0], 'out')] : [k(1.36, [0, 0, 0], [0, 0, 0], 'inOut')]),
      ],
      mag: [
        k(0.22),
        k(0.33, magOut, [0, 0, 0], 'in'),
        k(0.5, magAway, [10, 0, 12], 'in'),
        k(0.62, [-0.06, -0.34, 0.09], [10, 0, 10], 'hold'),
        k(0.82, [0, -0.128, 0.041], [0, 0, 0], 'outCubic'),
        k(0.92, [0, 0, 0], [0, 0, 0], 'snap'),
      ],
      slide: empty ? [k(0, slideBack), k(1.17, slideBack), k(1.21, [0, 0, 0], [0, 0, 0], 'snap')] : [k(0)],
    },
    left: [hand(0, L), hand(0.05, 'mag', { blend: 0.17, pose: 'pinch', arc: 0.02 }), hand(0.98, L, { blend: 0.2, pose: 'grip' })],
    right: [hand(0, 'grip')],
    events: [sfx(0.02, 'cloth'), sfx(0.24, 'mag_out'), sfx(0.9, 'mag_in'), ev(0.93, 'ammo'), ...(empty ? [sfx(1.17, 'slide_release')] : [])],
  });

  return [
    { name: 'idle', dur: 1, loop: true, left: [hand(0, L)], right: [hand(0, 'grip')] },
    {
      name: 'draw',
      dur: 0.4,
      tracks: { gun: [k(0, [0.03, -0.24, 0.08], [-58, 12, 24]), k(0.26, [0, 0.01, 0], [5, 0, -2], 'outCubic'), k(0.4, [0, 0, 0], [0, 0, 0], 'inOut')] },
      left: [hand(0, 'away', { pose: 'relax' }), hand(0.12, L, { blend: 0.2, pose: 'grip' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.02, 'weapon_draw')],
    },
    {
      name: 'holster',
      dur: 0.22,
      tracks: { gun: [k(0), k(0.22, [0.03, -0.26, 0.08], [-55, 10, 22], 'in')] },
      left: [hand(0, L), hand(0, 'away', { blend: 0.16, pose: 'relax' })],
      right: [hand(0, 'grip')],
      events: [sfx(0, 'weapon_holster')],
    },
    {
      name: 'fire',
      dur: 0.19,
      tracks: {
        slide: [k(0), k(0.03, slideBack, [0, 0, 0], 'snap'), k(0.1, [0, 0, 0], [0, 0, 0], 'out')],
        trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')],
      },
      left: [hand(0, L)],
      right: [hand(0, 'grip')],
      events: [ev(0.025, 'eject')],
    },
    {
      name: 'fireLast',
      dur: 0.16,
      tracks: {
        slide: [k(0), k(0.03, slideBack, [0, 0, 0], 'snap'), k(0.16, slideBack)],
        trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')],
      },
      left: [hand(0, L)],
      right: [hand(0, 'grip')],
      events: [ev(0.025, 'eject')],
    },
    {
      name: 'dry',
      dur: 0.14,
      tracks: { trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')] },
      left: [hand(0, L)],
      right: [hand(0, 'grip')],
      events: [sfx(0.01, 'dry_fire')],
    },
    reloadCore(false),
    reloadCore(true),
    {
      name: 'melee',
      dur: 0.52,
      tracks: {
        gun: [k(0), k(0.1, [0.03, 0.04, 0.07], [12, -22, -10], 'outCubic'), k(0.19, [-0.15, -0.03, -0.2], [-18, 62, 28], 'snap'), k(0.3, [-0.12, -0.03, -0.14], [-12, 50, 22], 'out'), k(0.52, [0, 0, 0], [0, 0, 0], 'inOut')],
      },
      left: [hand(0, L), hand(0, 'away', { blend: 0.1, pose: 'fist' }), hand(0.34, L, { blend: 0.18, pose: 'grip' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.08, 'melee_swing'), ev(0.17, 'hit')],
    },
    {
      name: 'inspect',
      dur: 2.6,
      tracks: {
        gun: [
          k(0),
          k(0.4, [-0.07, 0.03, 0.03], [10, 62, -8], 'inOut'),
          k(1.1, [-0.07, 0.035, 0.03], [14, 66, -4], 'inOut'),
          k(1.5, [-0.05, 0.04, 0.03], [6, -42, 14], 'inOut'),
          k(2.2, [-0.05, 0.045, 0.03], [10, -46, 10], 'inOut'),
          k(2.6, [0, 0, 0], [0, 0, 0], 'inOut'),
        ],
        slide: [k(1.62), k(1.72, [0, 0, 0.03], [0, 0, 0], 'out'), k(1.98, [0, 0, 0.03]), k(2.03, [0, 0, 0], [0, 0, 0], 'snap')],
      },
      left: [hand(0, L), hand(0.05, 'away', { blend: 0.2, pose: 'relax' }), hand(1.5, 'slide', { blend: 0.2, pose: 'pinch', arc: 0.03 }), hand(2.08, L, { blend: 0.24, pose: 'grip' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.1, 'cloth'), sfx(1.64, 'slide_back'), sfx(2.0, 'slide_release'), sfx(2.2, 'cloth')],
    },
    watchClip(L, [0.02, -0.02, 0.02], [-4, -8, 4]),
    throwClip(L, [0.02, -0.03, 0.03], [-6, -10, 6]),
  ];
}

// ------------------------------------------------------------------------------------------ rifle

function rifleClips(): ClipDef[] {
  const L = 'fore';
  const cant: [number, number, number] = [-0.02, 0.018, 0.035];
  const cantR: [number, number, number] = [12, 12, -32];
  const boltBack: [number, number, number] = [0, 0, 0.075];
  const magRock: [number, number, number] = [0, -0.05, 0.012];
  const magOut: [number, number, number] = [0, -0.15, 0.02];
  const magAway: [number, number, number] = [-0.1, -0.42, 0.08];

  const reloadCore = (empty: boolean): ClipDef => ({
    name: empty ? 'reloadEmpty' : 'reload',
    dur: empty ? 2.12 : 1.68,
    tracks: {
      gun: [
        k(0),
        k(0.24, cant, cantR, 'outCubic'),
        k(0.36, [-0.02, 0.008, 0.035], [9, 12, -32], 'inOut'),
        k(1.04, cant, cantR, 'inOut'),
        k(1.16, [-0.02, 0.034, 0.035], [16, 12, -32], 'snap'),
        k(1.3, cant, [11, 11, -28], 'out'),
        ...(empty
          ? [
              k(1.44, [0.0, 0.012, 0.03], [6, -4, 16], 'inOut'), // roll the other way to show the charging handle
              k(1.56, [0.0, 0.006, 0.045], [8, -4, 18], 'out'),
              k(1.62, [0.0, 0.01, 0.012], [3, -3, 14], 'snap'),
              k(2.12, [0, 0, 0], [0, 0, 0], 'inOut'),
            ]
          : [k(1.68, [0, 0, 0], [0, 0, 0], 'inOut')]),
      ],
      mag: [
        k(0.28),
        k(0.36, magRock, [-16, 0, 0], 'in'),
        k(0.44, magOut, [-10, 0, 0], 'in'),
        k(0.62, magAway, [-10, 0, 16], 'in'),
        k(0.78, [-0.08, -0.4, 0.07], [-12, 0, 12], 'hold'),
        k(1.02, [0, -0.135, 0.018], [-12, 0, 0], 'outCubic'),
        k(1.09, magRock, [-14, 0, 0], 'inOut'),
        k(1.15, [0, 0, 0], [0, 0, 0], 'snap'),
      ],
      bolt: empty ? [k(1.44), k(1.56, boltBack, [0, 0, 0], 'out'), k(1.6, [0, 0, 0], [0, 0, 0], 'snap')] : [k(0)],
    },
    left: [
      hand(0, L),
      hand(0.07, 'mag', { blend: 0.2, pose: 'pinch', arc: 0.03 }),
      ...(empty ? [hand(1.24, 'bolt', { blend: 0.19, pose: 'pinch', arc: 0.05 }), hand(1.64, L, { blend: 0.24, pose: 'fore' })] : [hand(1.22, L, { blend: 0.24, pose: 'fore' })]),
    ],
    right: [hand(0, 'grip')],
    events: [sfx(0.03, 'cloth'), sfx(0.3, 'mag_out'), sfx(1.12, 'mag_in'), ev(1.16, 'ammo'), ...(empty ? [sfx(1.46, 'bolt_back'), sfx(1.59, 'bolt_forward')] : [])],
  });

  return [
    { name: 'idle', dur: 1, loop: true, left: [hand(0, L, { pose: 'fore' })], right: [hand(0, 'grip')] },
    {
      name: 'draw',
      dur: 0.5,
      tracks: { gun: [k(0, [0.06, -0.3, 0.12], [-48, 26, 30]), k(0.32, [0, 0.012, 0], [4, 0, -3], 'outCubic'), k(0.5, [0, 0, 0], [0, 0, 0], 'inOut')] },
      left: [hand(0, 'away', { pose: 'relax' }), hand(0.14, L, { blend: 0.24, pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.02, 'weapon_draw')],
    },
    {
      name: 'holster',
      dur: 0.26,
      tracks: { gun: [k(0), k(0.26, [0.06, -0.32, 0.12], [-46, 24, 28], 'in')] },
      left: [hand(0, L), hand(0, 'away', { blend: 0.18, pose: 'relax' })],
      right: [hand(0, 'grip')],
      events: [sfx(0, 'weapon_holster')],
    },
    {
      name: 'fire',
      dur: 0.1,
      tracks: {
        bolt: [k(0), k(0.025, boltBack, [0, 0, 0], 'snap'), k(0.08, [0, 0, 0], [0, 0, 0], 'out')],
        trigger: [k(0), k(0.015, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.09, [0, 0, 0], [0, 0, 0], 'out')],
      },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [ev(0.02, 'eject')],
    },
    {
      name: 'dry',
      dur: 0.14,
      tracks: { trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')] },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.01, 'dry_fire')],
    },
    reloadCore(false),
    reloadCore(true),
    {
      name: 'melee',
      dur: 0.56,
      tracks: {
        gun: [k(0), k(0.11, [0.05, 0.02, 0.08], [6, -24, -8], 'outCubic'), k(0.2, [-0.16, -0.02, -0.16], [14, 74, 24], 'snap'), k(0.32, [-0.13, -0.02, -0.11], [10, 62, 20], 'out'), k(0.56, [0, 0, 0], [0, 0, 0], 'inOut')],
      },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.09, 'melee_swing'), ev(0.18, 'hit')],
    },
    {
      name: 'inspect',
      dur: 2.8,
      tracks: {
        gun: [
          k(0),
          k(0.45, [-0.06, 0.05, 0.06], [16, 58, -14], 'inOut'),
          k(1.2, [-0.06, 0.055, 0.06], [20, 62, -10], 'inOut'),
          k(1.65, [-0.02, 0.05, 0.05], [10, -30, 30], 'inOut'),
          k(2.35, [-0.02, 0.055, 0.05], [12, -34, 26], 'inOut'),
          k(2.8, [0, 0, 0], [0, 0, 0], 'inOut'),
        ],
        bolt: [k(1.78), k(1.9, [0, 0, 0.05], [0, 0, 0], 'out'), k(2.14, [0, 0, 0.05]), k(2.18, [0, 0, 0], [0, 0, 0], 'snap')],
      },
      left: [hand(0, L, { pose: 'fore' }), hand(1.6, 'bolt', { blend: 0.2, pose: 'pinch', arc: 0.04 }), hand(2.24, L, { blend: 0.26, pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.1, 'cloth'), sfx(1.8, 'bolt_back'), sfx(2.16, 'bolt_forward'), sfx(2.4, 'cloth')],
    },
    watchClip(L, [0.03, -0.045, 0.04], [-9, -10, 8]),
    throwClip(L, [0.03, -0.05, 0.05], [-10, -12, 9]),
  ];
}

// ------------------------------------------------------------------------------------------ shotgun

function shotgunClips(): ClipDef[] {
  const L = 'pump';
  const pumpBack: [number, number, number] = [0, 0, 0.11];
  // port-up loading pose: rolled so the loading gate faces the camera
  const loadP: [number, number, number] = [-0.05, 0.05, 0.05];
  const loadR: [number, number, number] = [22, 14, -62];
  // shell offsets are relative to its parked spot below the gun
  const shellAway: [number, number, number] = [-0.08, -0.06, 0.1];
  const shellAtPort: [number, number, number] = [0, 0.262, -0.1];
  const shellIn: [number, number, number] = [0, 0.29, -0.2];

  const pumpTrack = (t0: number) => [k(t0), k(t0 + 0.13, pumpBack, [0, 0, 0], 'inOut'), k(t0 + 0.19, pumpBack), k(t0 + 0.3, [0, 0, 0], [0, 0, 0], 'snap')];

  return [
    { name: 'idle', dur: 1, loop: true, left: [hand(0, L, { pose: 'fore' })], right: [hand(0, 'grip')] },
    {
      name: 'draw',
      dur: 0.72,
      tracks: {
        gun: [k(0, [0.06, -0.32, 0.12], [-46, 26, 30]), k(0.3, [0, 0.012, 0], [4, 0, -3], 'outCubic'), k(0.42, [0, 0, 0.012], [3, 0, -2], 'inOut'), k(0.56, [0, 0, 0.02], [4, 0, -2]), k(0.72, [0, 0, 0], [0, 0, 0], 'out')],
        pump: [k(0.38), k(0.48, pumpBack, [0, 0, 0], 'inOut'), k(0.52, pumpBack), k(0.62, [0, 0, 0], [0, 0, 0], 'snap')],
      },
      left: [hand(0, 'away', { pose: 'relax' }), hand(0.12, L, { blend: 0.22, pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.02, 'weapon_draw'), sfx(0.4, 'pump_back'), sfx(0.56, 'pump_forward')],
    },
    {
      name: 'holster',
      dur: 0.26,
      tracks: { gun: [k(0), k(0.26, [0.06, -0.34, 0.12], [-44, 24, 28], 'in')] },
      left: [hand(0, L), hand(0, 'away', { blend: 0.18, pose: 'relax' })],
      right: [hand(0, 'grip')],
      events: [sfx(0, 'weapon_holster')],
    },
    {
      // shot, then rack the pump
      name: 'fire',
      dur: 0.74,
      tracks: {
        gun: [k(0), k(0.22, [0, 0, 0], [0, 0, 0]), k(0.34, [0.004, -0.008, 0.03], [5, -2, -4], 'inOut'), k(0.42, [0.004, -0.008, 0.03], [5, -2, -4]), k(0.54, [0, 0.004, -0.012], [-2, 0, 0], 'snap'), k(0.74, [0, 0, 0], [0, 0, 0], 'out')],
        pump: pumpTrack(0.22),
        trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')],
      },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.24, 'pump_back'), ev(0.34, 'eject'), sfx(0.46, 'pump_forward')],
    },
    {
      name: 'dry',
      dur: 0.14,
      tracks: { trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')] },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.01, 'dry_fire')],
    },
    {
      name: 'reloadStart',
      dur: 0.4,
      tracks: { gun: [k(0), k(0.34, loadP, loadR, 'outCubic'), k(0.4, loadP, loadR)], shell: [k(0, shellAway), k(0.4, shellAway)] },
      left: [hand(0, L, { pose: 'fore' }), hand(0.04, 'shell', { blend: 0.26, pose: 'pinch', arc: 0.02 })],
      right: [hand(0, 'grip')],
      events: [sfx(0.02, 'cloth')],
    },
    {
      name: 'reloadShell',
      dur: 0.5,
      tracks: {
        gun: [k(0, loadP, loadR), k(0.3, loadP, loadR), k(0.36, [-0.05, 0.058, 0.04], [24, 14, -62], 'snap'), k(0.5, loadP, loadR, 'out')],
        shell: [k(0, shellAway, [0, 20, 0]), k(0.24, shellAtPort, [12, 0, 0], 'outCubic'), k(0.35, shellIn, [0, 0, 0], 'in'), k(0.37, shellAway, [0, 20, 0], 'hold'), k(0.5, shellAway, [0, 20, 0])],
      },
      left: [hand(0, 'shell', { pose: 'pinch' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.3, 'shell_insert'), ev(0.34, 'shell')],
    },
    {
      name: 'reloadEnd',
      dur: 0.44,
      tracks: { gun: [k(0, loadP, loadR), k(0.44, [0, 0, 0], [0, 0, 0], 'inOut')], shell: [k(0, shellAway), k(0.44, [0, 0, 0])] },
      left: [hand(0, 'shell', { pose: 'pinch' }), hand(0.04, L, { blend: 0.26, pose: 'fore', arc: 0.02 })],
      right: [hand(0, 'grip')],
      events: [sfx(0.05, 'cloth')],
    },
    {
      // came back from empty: finish by chambering a round
      name: 'reloadEndPump',
      dur: 0.86,
      tracks: {
        gun: [k(0, loadP, loadR), k(0.4, [0, 0.004, 0.01], [3, 0, -2], 'inOut'), k(0.52, [0.004, -0.006, 0.03], [5, -2, -4], 'inOut'), k(0.68, [0, 0.004, -0.012], [-2, 0, 0], 'snap'), k(0.86, [0, 0, 0], [0, 0, 0], 'out')],
        pump: pumpTrack(0.38),
        shell: [k(0, shellAway), k(0.4, [0, 0, 0])],
      },
      left: [hand(0, 'shell', { pose: 'pinch' }), hand(0.04, L, { blend: 0.26, pose: 'fore', arc: 0.02 })],
      right: [hand(0, 'grip')],
      events: [sfx(0.05, 'cloth'), sfx(0.4, 'pump_back'), sfx(0.6, 'pump_forward')],
    },
    {
      name: 'melee',
      dur: 0.6,
      tracks: {
        gun: [k(0), k(0.12, [0.05, 0.02, 0.09], [6, -24, -8], 'outCubic'), k(0.21, [-0.16, -0.02, -0.16], [14, 74, 24], 'snap'), k(0.34, [-0.13, -0.02, -0.11], [10, 62, 20], 'out'), k(0.6, [0, 0, 0], [0, 0, 0], 'inOut')],
      },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.1, 'melee_swing'), ev(0.19, 'hit')],
    },
    {
      name: 'inspect',
      dur: 2.6,
      tracks: {
        gun: [k(0), k(0.45, [-0.06, 0.05, 0.06], [16, 58, -14], 'inOut'), k(1.2, [-0.06, 0.055, 0.06], [20, 62, -10], 'inOut'), k(1.65, [-0.04, 0.05, 0.05], [22, 14, -60], 'inOut'), k(2.2, [-0.04, 0.055, 0.05], [24, 12, -56], 'inOut'), k(2.6, [0, 0, 0], [0, 0, 0], 'inOut')],
      },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.1, 'cloth'), sfx(2.2, 'cloth')],
    },
    watchClip(L, [0.03, -0.05, 0.04], [-10, -10, 8]),
    throwClip(L, [0.03, -0.055, 0.05], [-11, -12, 9]),
  ];
}

// ------------------------------------------------------------------------------------------ sniper

function sniperClips(): ClipDef[] {
  const L = 'fore';
  const boltUp: [number, number, number] = [0, 0, 58];
  const boltPull: [number, number, number] = [0, 0, 0.1];
  // pushed forward and rolled so the bolt hand works out in front instead of filling the corner of the screen
  const cantP: [number, number, number] = [-0.06, 0.005, -0.08];
  const cantR: [number, number, number] = [4, 10, 28];

  /** Bolt cycle starting at t0. Returns the pieces to merge into a clip. */
  const cycle = (t0: number) => ({
    bolt: [
      k(t0 + 0.16),
      k(t0 + 0.25, [0, 0, 0], boltUp, 'out'),
      k(t0 + 0.38, boltPull, boltUp, 'inOut'),
      k(t0 + 0.44, boltPull, boltUp),
      k(t0 + 0.55, [0, 0, 0], boltUp, 'in'),
      k(t0 + 0.63, [0, 0, 0], [0, 0, 0], 'snap'),
    ],
    gun: [k(t0), k(t0 + 0.15, cantP, cantR, 'inOut'), k(t0 + 0.38, [-0.06, 0.0, -0.065], [6, 10, 29], 'inOut'), k(t0 + 0.55, [-0.06, 0.008, -0.09], [4, 10, 27], 'in'), k(t0 + 0.66, cantP, cantR), k(t0 + 0.88, [0, 0, 0], [0, 0, 0], 'inOut')],
    right: [hand(t0, 'grip'), hand(t0 + 0.03, 'handle', { blend: 0.14, pose: 'pinch', arc: 0.02 }), hand(t0 + 0.66, 'grip', { blend: 0.17, pose: 'grip', arc: 0.02 })],
    events: [sfx(t0 + 0.17, 'bolt_up'), sfx(t0 + 0.27, 'bolt_pull'), ev(t0 + 0.36, 'eject'), sfx(t0 + 0.46, 'bolt_push'), sfx(t0 + 0.6, 'bolt_down')],
    dur: 0.88,
  });

  const fireCycle = cycle(0.1);
  const reloadCore = (empty: boolean): ClipDef => {
    const c = cycle(1.5);
    const rollP: [number, number, number] = [-0.02, 0.02, 0.04];
    const rollR: [number, number, number] = [12, 12, -30];
    return {
      name: empty ? 'reloadEmpty' : 'reload',
      dur: empty ? 2.42 : 1.84,
      tracks: {
        gun: [
          k(0),
          k(0.26, rollP, rollR, 'outCubic'),
          k(1.1, rollP, rollR),
          k(1.2, [-0.02, 0.036, 0.04], [16, 12, -30], 'snap'),
          k(1.36, rollP, [11, 11, -26], 'out'),
          ...(empty ? c.gun.slice(1).map((key, i) => (i === 0 ? { ...key, t: 1.62 } : key)) : [k(1.84, [0, 0, 0], [0, 0, 0], 'inOut')]),
        ],
        mag: [k(0.3), k(0.42, [0, -0.11, 0], [0, 0, 0], 'in'), k(0.6, [-0.1, -0.4, 0.06], [0, 0, 16], 'in'), k(0.8, [-0.08, -0.38, 0.05], [0, 0, 12], 'hold'), k(1.06, [0, -0.12, 0], [0, 0, 0], 'outCubic'), k(1.18, [0, 0, 0], [0, 0, 0], 'snap')],
        bolt: empty ? c.bolt : [k(0)],
      },
      left: [hand(0, L, { pose: 'fore' }), hand(0.08, 'mag', { blend: 0.2, pose: 'pinch', arc: 0.03 }), hand(1.26, L, { blend: 0.26, pose: 'fore' })],
      right: empty ? [hand(0, 'grip'), ...c.right.slice(1)] : [hand(0, 'grip')],
      events: [sfx(0.03, 'cloth'), sfx(0.32, 'mag_out'), sfx(1.14, 'mag_in'), ev(1.19, 'ammo'), ...(empty ? c.events.filter((e) => e.type !== 'eject') : [])],
    };
  };

  return [
    { name: 'idle', dur: 1, loop: true, left: [hand(0, L, { pose: 'fore' })], right: [hand(0, 'grip')] },
    {
      name: 'draw',
      dur: 0.62,
      tracks: { gun: [k(0, [0.07, -0.34, 0.14], [-44, 28, 30]), k(0.4, [0, 0.014, 0], [4, 0, -3], 'outCubic'), k(0.62, [0, 0, 0], [0, 0, 0], 'inOut')] },
      left: [hand(0, 'away', { pose: 'relax' }), hand(0.18, L, { blend: 0.26, pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.02, 'weapon_draw')],
    },
    {
      name: 'holster',
      dur: 0.3,
      tracks: { gun: [k(0), k(0.3, [0.07, -0.36, 0.14], [-42, 26, 28], 'in')] },
      left: [hand(0, L), hand(0, 'away', { blend: 0.2, pose: 'relax' })],
      right: [hand(0, 'grip')],
      events: [sfx(0, 'weapon_holster')],
    },
    {
      name: 'fire',
      dur: 0.1 + fireCycle.dur,
      tracks: {
        gun: fireCycle.gun,
        bolt: fireCycle.bolt,
        trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')],
      },
      left: [hand(0, L, { pose: 'fore' })],
      right: fireCycle.right,
      events: fireCycle.events,
    },
    {
      // last round: no need to cycle, the reload will do it
      name: 'fireLast',
      dur: 0.3,
      tracks: { trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')] },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
    },
    {
      name: 'dry',
      dur: 0.14,
      tracks: { trigger: [k(0), k(0.02, [0, 0, 0.003], [-16, 0, 0], 'snap'), k(0.12, [0, 0, 0], [0, 0, 0], 'out')] },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.01, 'dry_fire')],
    },
    reloadCore(false),
    reloadCore(true),
    {
      name: 'melee',
      dur: 0.62,
      tracks: {
        gun: [k(0), k(0.13, [0.05, 0.02, 0.09], [6, -22, -8], 'outCubic'), k(0.23, [-0.16, -0.02, -0.14], [14, 70, 24], 'snap'), k(0.36, [-0.13, -0.02, -0.1], [10, 60, 20], 'out'), k(0.62, [0, 0, 0], [0, 0, 0], 'inOut')],
      },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.1, 'melee_swing'), ev(0.21, 'hit')],
    },
    {
      name: 'inspect',
      dur: 2.6,
      tracks: {
        gun: [k(0), k(0.5, [-0.05, 0.05, 0.08], [16, 54, -14], 'inOut'), k(1.3, [-0.05, 0.055, 0.08], [20, 58, -10], 'inOut'), k(1.8, [-0.02, 0.05, 0.06], [8, -24, 30], 'inOut'), k(2.2, [-0.02, 0.055, 0.06], [10, -28, 26], 'inOut'), k(2.6, [0, 0, 0], [0, 0, 0], 'inOut')],
      },
      left: [hand(0, L, { pose: 'fore' })],
      right: [hand(0, 'grip')],
      events: [sfx(0.1, 'cloth'), sfx(2.2, 'cloth')],
    },
    watchClip(L, [0.03, -0.055, 0.04], [-10, -10, 8]),
    throwClip(L, [0.03, -0.06, 0.05], [-11, -12, 9]),
  ];
}

const cache = new Map<WeaponClass, ClipSet>();

export function clipsFor(cls: WeaponClass): ClipSet {
  let set = cache.get(cls);
  if (set) return set;
  const defs = cls === 'pistol' ? pistolClips() : cls === 'rifle' ? rifleClips() : cls === 'shotgun' ? shotgunClips() : sniperClips();
  set = {};
  for (const d of defs) set[d.name as ClipName] = new Clip(d);
  cache.set(cls, set);
  return set;
}
