(function (K) {
  K.reflection = {
    plane: SceneOptics.plane,
    reflectedView: SceneOptics.reflectedView,
    captureView: SceneOptics.captureView,
    material(base, plane, options) {
      return SurfaceLook.material(base, { layers: { mirror: { ...options, type: 'planarReflection', plane } } });
    }
  };
  K.ripple = { field: RippleField.field, sampleFrame: RippleField.sampleFrame, glsl: RippleField.glsl };
  K.atmosphere = {
    fog: SceneOptics.fog,
    sphere: SceneOptics.sphere,
    box: SceneOptics.box,
    shaft: SceneOptics.shaft,
    field: SceneOptics.field,
    lighting: SceneOptics.lighting,
    occluder: SceneOptics.occluder,
    history: SceneOptics.volumeHistory,
    prepare: SceneOptics.prepareVolumes,
    trace: SceneOptics.trace
  };
})(KIT);
