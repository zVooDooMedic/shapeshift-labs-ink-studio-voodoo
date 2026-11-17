// PixelHard knight: a rigged character with a sword, driven by the kit's own attack clip.
// ink-studio render lab/knight.js      (sheet of the swung frames: --from 0 --to 2 --n 12)
module.exports = kit => {
  let ch = null,
    W = null,
    t0 = 0,
    atkAt = 0.9;
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
        height: 1.9,
        speed: 2.4,
        atk: 'slash',
        gait: 'walk',
        pts: {
          hip: [0, 0.86, 0],
          chest: [0, 1.24, 0],
          hem: [0, 0.66, 0],
          neck: [0, 1.46, 0],
          sock: [0, 0.24, 0],
          ank: [0, 0.08, 0],
          sho: [0.26, 1.38, 0],
          hand: [0.30, 1.02, 0]
        },
        sculpt(S, T) {
          // legs
          S.box([-0.10, 0.44, 0], [0.09, 0.42, 0.10], { r: [3, 4, 5] }, T('legL'));
          S.box([0.10, 0.44, 0], [0.09, 0.42, 0.10], { r: [3, 4, 5] }, T('legR'));
          // boots
          S.box([-0.11, 0.06, 0.03], [0.10, 0.07, 0.14], { r: [2, 3, 4] }, T('legL'));
          S.box([0.11, 0.06, 0.03], [0.10, 0.07, 0.14], { r: [2, 3, 4] }, T('legR'));
          // tabard / skirt
          S.lathe([0, 0.78, 0], 0.20, [0.26, 0.90], { r: [16, 17, 18] }, T('hem'));
          // cuirass
          S.ball([0, 1.22, 0], [0.26, 0.30, 0.22], { r: [4, 5, 7] }, T('chest'));
          S.box([0, 1.06, 0], [0.24, 0.08, 0.20], { r: [20, 21, 22] }, T('chest'));
          // pauldrons
          S.ball([-0.28, 1.40, 0], 0.13, { r: [5, 7, 9] }, T('chest'));
          S.ball([0.28, 1.40, 0], 0.13, { r: [5, 7, 9] }, T('chest'));
          // helmet: bascinet dome + visor slot + crest
          S.ball([0, 1.62, 0], [0.15, 0.17, 0.15], { r: [7, 9, 11] }, T('head'));
          S.box([0, 1.60, 0.13], [0.11, 0.02, 0.02], { r: [1, 2, 3] }, T('head'));
          S.box([0, 1.80, 0], [0.02, 0.10, 0.14], { r: [17, 18, 19] }, T('head'));
          S.box([0, 1.42, 0], [0.09, 0.06, 0.08], { r: [3, 4, 5] }, T('neck'));
          // sword arm + blade + crossguard, all on the hand bone
          S.box([0.30, 1.18, 0], [0.06, 0.16, 0.06], { r: [4, 5, 6] }, T('sho'));
          S.box([0.30, 1.36, 0], [0.15, 0.02, 0.03], { r: [20, 21, 22] }, T('sho'));
          S.box([0.30, 1.62, 0], [0.025, 0.26, 0.012], { r: [9, 11, 12] }, T('sho'));
        },
        world: { height: () => 0 }
      };
      ch = K.character(B, spec, 0);
      // a floor so the knight reads on a stage, like the dioramas
      const S = Mk.makeSculpt(B);
      S.ground({ r: [1, 2, 3, 4] }, { rad: 3.4, res: 0.14 });
      S.bake();
      W = B.finish({
        cam: { target: [0, 0.95, 0], dist: 8.4, pitch: 0.13, yaw: 0.35, sway: 0.12 },
        detail: 16,
        palName: 'Knight',
        dither: 0.28,
        radius: 5
      });
      ch.bind(W, W.count - ch.total);
      W.anim = {
        stateful: true,
        update(dt, t) {
          t0 += dt;
          let attacking = false;
          if (t0 > atkAt) {
            t0 = 0;
            attacking = true;
            atkAt = 0.9 + (Math.sin(t * 3.1) * 0.5 + 0.5) * 0.6;
          }
          ch.update(dt, { move: 0, mz: 0, run: false, attack: attacking, face: 0.4 }, t);
        }
      };
      W.anim.update(0, 0);
      return W;
    },
  };
};
