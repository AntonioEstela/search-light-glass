// Glass layer: a real backdrop blur with antialiased rounded corners, drawn as
// a sibling directly below the floating panel. See the design spec, section 5.2.
//
// The layer is larger than the panel by GLASS_PAD on every side so the blur
// samples real pixels at the panel edges. It holds clones of the wallpaper and
// of every visible window, offset so the area under the panel lines up with the
// screen. Effects, outermost first: GlassEffect (corner mask, saturation,
// tint), then Shell.BlurEffect (applied first).

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const GLASS_PAD = 40;
export const GLASS_SATURATION = 1.8;

const PANEL_SIGNALS = [
  'notify::x',
  'notify::y',
  'notify::width',
  'notify::height',
  'notify::opacity',
  'notify::scale-x',
  'notify::scale-y',
  'notify::translation-x',
  'notify::translation-y',
  'notify::visible',
];

const GLSL_DECL = `
uniform float width;
uniform float height;
uniform float pad;
uniform float radius;
uniform float saturation;
uniform vec4 tint;
float roundedBox(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + vec2(r);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
`;

// Non-replace snippet: cogl_color_out already holds the sampled texel.
const GLSL_CODE = `
vec2 uv = cogl_tex_coord_in[0].xy;
vec2 pos = uv * vec2(width, height);
vec2 size = vec2(width, height) - vec2(2.0 * pad);
vec2 local = pos - vec2(pad) - size * 0.5;
float d = roundedBox(local, size * 0.5, radius);
float cov = 1.0 - smoothstep(-0.75, 0.75, d);
vec4 c = cogl_color_out;
vec3 rgb = c.a > 0.0 ? c.rgb / c.a : c.rgb;
float g = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
rgb = clamp(mix(vec3(g), rgb, saturation), 0.0, 1.0);
rgb = mix(rgb, tint.rgb, tint.a);
cogl_color_out = vec4(rgb, 1.0) * cov;
`;

export const GlassEffect = GObject.registerClass(
  class GlassEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
      this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, GLSL_DECL, GLSL_CODE, false);
    }

    _setFloat(name, values) {
      this.set_uniform_float(this.get_uniform_location(name), values.length, values);
    }

    setUniforms({ width, height, pad, radius, saturation, tint }) {
      this._setFloat('width', [width]);
      this._setFloat('height', [height]);
      this._setFloat('pad', [pad]);
      this._setFloat('radius', [radius]);
      this._setFloat('saturation', [saturation]);
      this._setFloat('tint', tint);
    }
  },
);

export class GlassLayer {
  constructor() {
    this._panel = null;
    this._actor = null;
    this._scene = null;
    this._glass = null;
    this._blur = null;
    this._style = {
      radius: 28,
      tint: [0.11, 0.13, 0.2, 0.55],
      blurRadius: 30,
      brightness: 1.0,
    };
  }

  get actor() {
    return this._actor;
  }

  attach(panel) {
    if (this._actor) this.detach();
    this._panel = panel;

    this._actor = new St.Widget({ name: 'searchLightGlass', reactive: false });
    this._actor.clip_to_allocation = true;
    this._actor.set_pivot_point(0, 0);
    this._scene = new Clutter.Actor();
    this._actor.add_child(this._scene);

    this._glass = new GlassEffect();
    this._blur = new Shell.BlurEffect({
      radius: this._style.blurRadius,
      brightness: this._style.brightness,
      mode: Shell.BlurMode.ACTOR,
    });
    // The innermost effect is added last: blur first, then the glass shader.
    this._actor.add_effect_with_name('glass', this._glass);
    this._actor.add_effect_with_name('blur', this._blur);

    Main.layoutManager.addChrome(this._actor, {
      affectsStruts: false,
      trackFullscreen: false,
    });
    Main.layoutManager.uiGroup.set_child_below_sibling(this._actor, panel);

    panel.connectObject(...PANEL_SIGNALS.flatMap(s => [s, () => this.sync()]), this);

    this.sync();
  }

  setStyle({ radius, tint, blurRadius, brightness }) {
    this._style = { radius, tint, blurRadius, brightness };
    if (!this._actor) return;
    this._blur.radius = blurRadius;
    this._blur.brightness = brightness;
    this._updateUniforms();
  }

  rebuildScene() {
    if (!this._scene) return;
    this._scene.destroy_all_children();

    for (const bg of Main.layoutManager._backgroundGroup.get_children()) {
      this._scene.add_child(this._clone(bg));
    }
    for (const wa of global.get_window_actors()) {
      if (wa.visible !== true) continue;
      if (wa.meta_window?.minimized) continue;
      this._scene.add_child(this._clone(wa));
    }
  }

  _clone(source) {
    return new Clutter.Clone({
      source,
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
    });
  }

  sync() {
    const panel = this._panel;
    const actor = this._actor;
    if (!panel || !actor) return;

    const sx = panel.scale_x;
    const sy = panel.scale_y;
    actor.set_position(
      panel.x + panel.translation_x - GLASS_PAD * sx,
      panel.y + panel.translation_y - GLASS_PAD * sy,
    );
    actor.set_size(panel.width + 2 * GLASS_PAD, panel.height + 2 * GLASS_PAD);
    actor.set_scale(sx, sy);
    actor.opacity = panel.opacity;
    actor.visible = panel.visible;

    this._scene.set_position(-actor.x, -actor.y);
    this._updateUniforms();
  }

  _updateUniforms() {
    const actor = this._actor;
    if (!actor) return;
    this._glass.setUniforms({
      width: actor.width,
      height: actor.height,
      pad: GLASS_PAD,
      radius: this._style.radius,
      saturation: GLASS_SATURATION,
      tint: this._style.tint,
    });
  }

  detach() {
    if (this._panel) this._panel.disconnectObject(this);
    this._panel = null;
    if (this._actor) {
      Main.layoutManager.removeChrome(this._actor);
      this._actor.destroy();
    }
    this._actor = null;
    this._scene = null;
    this._glass = null;
    this._blur = null;
  }
}
