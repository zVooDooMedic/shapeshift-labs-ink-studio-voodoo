// PixelHard knight: a rigged character with a sword, driven by the kit's own attack clip.
// ink-studio render lab/knight.js      (sheet of the swung frames: --from 0 --to 2 --n 12)
module.exports = kit => {
  let ch = null,
    W = null,
    t0 = 0,
    played = false;
  // deterministic timing so a sheet can sample one exact clip window
  const CLIP = process.env.KNIGHT_CLIP || '';
  const CLIP_AT = 0.2;
  const ATK_PERIOD = process.env.KNIGHT_PERIOD ? +process.env.KNIGHT_PERIOD : 0.25 + 0.62;
  const FACE = process.env.KNIGHT_FACE ? +process.env.KNIGHT_FACE : 0.8;
  return {
    id: 'knight',
    name: 'PixelHard Knight',
    seed: 7,
    build(seed) {
      const K = kit.KIT, Mk = kit;
      const pal = [
        0x07080b, 0x121620, 0x1c2026, 0x2a2e36, 0x3a4048, 0x474d57, 0x5a6068, 0x6d747c, 0x8a9098, 0x9aa09c,
        0xb8bdb8, 0xd8dcd4, 0xf2f5f0, 0x1a1420, 0x2a1830, 0x3c1020, 0x5a1c22, 0x8f2a30, 0xc4444a, 0x6a4a12,
        0x8a6a1c, 0xc8a03c, 0xf0d478, 0x0f2418, 0x1c4a2a, 0x2a6a3a, 0x66a640, 0x140c08, 0x2a1a10, 0x4a2c18,
        0x7a4a24, 0xa86a34, 0xd89a5c, 0x202028, 0x303040, 0x505070, 0x7080b0, 0x101820, 0x18242e, 0x24343f
      ];
      const B = Mk.makeBuilder(seed, pal);
      const spec = {
        id: 'knight',
        height: 2.05,
        wind: 0.16,
        speed: 2.4,
        atk: process.env.KNIGHT_ATK || 'slash',
        gait: 'walk',
        // the rig's own dressing: a ring under the feet reads as a stage prop and
        // the built-in smear/streak is opaque enough to eat the silhouette.
        rings: false,
        shadow: false,
        streak: false,
        fx: false,
        pts: {
          hip: [0, 0.98, 0],
          chest: [0, 1.38, 0],
          hem: [0, 0.80, 0],
          neck: [0, 1.58, 0],
          sock: [0, 0.44, 0],
          ank: [0, 0.09, 0],
          sho: [0.25, 1.50, 0],
          hand: [0.29, 1.10, 0]
        },
        sculpt(S, T) {
          if (process.env.KNIGHT_NOSCULPT) return;
          // legs
          S.box([-0.10, 0.55, 0], [0.085, 0.46, 0.095], { r: [3, 4, 5] }, T('legL'));
          S.box([0.10, 0.55, 0], [0.085, 0.46, 0.095], { r: [3, 4, 5] }, T('legR'));
          // boots
          S.box([-0.11, 0.07, 0.04], [0.10, 0.075, 0.145], { r: [2, 3, 4] }, T('legL'));
          S.box([0.11, 0.07, 0.04], [0.10, 0.075, 0.145], { r: [2, 3, 4] }, T('legR'));
          // tabard / skirt
          // tabard: a boxed skirt, NOT a lathe — a flared lathe here renders as a
          // red mushroom base and reads as a stage prop, not a garment.
          S.box([0, 0.86, 0], [0.145, 0.17, 0.125], { r: [16, 16, 17] }, T('hem'));
          S.box([0, 1.02, 0], [0.165, 0.035, 0.14], { r: [20, 21, 22] }, T('chest'));
          // cuirass
          S.ball([0, 1.36, 0], [0.25, 0.29, 0.21], { r: [4, 5, 7] }, T('chest'));
          // pauldrons
          S.ball([-0.27, 1.52, 0], 0.125, { r: [5, 7, 9] }, T('chest'));
          S.ball([0.27, 1.52, 0], 0.125, { r: [5, 7, 9] }, T('chest'));
          // helmet: bascinet dome + visor slot + crest
          S.ball([0, 1.74, 0], [0.145, 0.165, 0.145], { r: [7, 9, 11] }, T('head'));
          S.box([0, 1.72, 0.13], [0.105, 0.02, 0.02], { r: [1, 2, 3] }, T('head'));
          S.box([0, 1.92, 0], [0.02, 0.095, 0.135], { r: [17, 18, 19] }, T('head'));
          S.box([0, 1.55, 0], [0.085, 0.06, 0.08], { r: [3, 4, 5] }, T('neck'));
          // sword arm + blade + crossguard, all on the hand bone
          // arm
          S.box([0.29, 1.28, 0], [0.058, 0.20, 0.058], { r: [4, 5, 6] }, T('sho'));
          // sword, five parts so it reads as a weapon and not a grey crescent:
          // pommel, grip, crossguard, blade, and a bright edge down the blade.
          S.box([0.29, 1.10, 0], [0.034, 0.034, 0.034], { r: [20, 21, 22] }, T('item'));
          S.box([0.29, 1.21, 0], [0.026, 0.085, 0.026], { r: [28, 29, 30] }, T('item'));
          S.box([0.29, 1.32, 0], [0.155, 0.021, 0.026], { r: [20, 21, 22] }, T('item'));
          S.box([0.29, 1.57, 0], [0.023, 0.245, 0.011], { r: [6, 8, 10] }, T('item'));
          S.box([0.29, 1.57, 0.012], [0.008, 0.235, 0.004], { r: [12, 12, 12] }, T('item'));
        },
        world: { height: () => 0 }
      };
      ch = K.character(B, spec, 0);
      // a floor so the knight reads on a stage, like the dioramas
      const S = Mk.makeSculpt(B);
      W = B.finish({
        cam: { target: [0, 1.02, 0], dist: 4.6, pitch: 0.10, yaw: 0.35, sway: 0.06 },
        detail: 15,
        palName: 'Knight',
        dither: 0.28,
        radius: 4.5
      });
      ch.bind(W, W.count - ch.total);
      W.ch = ch;
      if (ch.respawn) ch.respawn(0);
      W.spec = spec;
      W.anim = {
        stateful: true,
        update(dt, t) {
          t0 += dt;
          let attacking = false;
          if (!CLIP) {
            if (t0 >= ATK_PERIOD) {
              t0 = 0;
              attacking = true;
            }
          } else if (!played && t >= CLIP_AT) {
            played = true;
            ch.play(CLIP === 'death' ? 'defeat' : CLIP, { unit: CLIP === 'death' ? 1 : 1 });
          }
          ch.update(dt, { move: 0, mz: 0, run: false, attack: attacking, face: FACE }, t);
        }
      };
      for (let i = 0; i < 45; i++) W.anim.update(1 / 60, 0);
      W.anim.update(0, 0);
      return W;
    },
  };
};
