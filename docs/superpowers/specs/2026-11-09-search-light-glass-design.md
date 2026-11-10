# Search Light Glass: design

Date: 2026-11-09
Author: Antonio Estela (with Claude)
Base: fork of [icedman/search-light](https://github.com/icedman/search-light), commit `4e93e0e` (v101), GPL-3.0.

## 1. Intent

Search Light moves the GNOME overview search into a floating panel. This fork gives it the look of a modern macOS-style search bar: a **translucent glass panel with real blur** of whatever is behind it, strongly rounded corners, and a clean results list.

Why: with real blur, the background turns into soft color and **text stays highly legible over anything**. That is the quality the author likes most in the macOS reference. Search Light falls short in two ways today:

- The original "blur" is a static, ImageMagick-blurred copy of the wallpaper, not a blur of what is actually behind the panel.
- Earlier attempts at real blur on GNOME 50 failed: content behind the panel stayed sharp and one corner rendered square.

The fork will be published on GitHub as **Search Light Glass** (`github.com/AntonioEstela/search-light-glass`).

## 2. Goals

1. **Real blur** of the content behind the panel (windows and wallpaper), **on by default**.
2. **All 4 corners truly rounded**, including the blur layer.
3. **Automatic theme**: light or dark glass following the system light/dark preference.
4. **Single-column results list with sections** (option "A", see §5.3).
5. Works on **GNOME 48, 49 and 50**, like the original.
6. Installable side by side with the original Search Light, using its own identifiers.

## 3. Non-goals

- Changing **which** results appear or **in what order** (e.g. a "top hit"). Ordering stays as GNOME's provider order (Settings → Search). Deferred to later.
- Publishing on extensions.gnome.org (may come later).
- Redesigning the preferences window beyond what §5.5 requires.

## 4. Anti-goals (a failure even if it "works")

- Breaking existing features: shortcuts, preferred monitor, animations, activating results with Enter or click, Escape to close.
- Spending GPU on the blur **while the panel is closed**.
- Depending on ImageMagick or other external tools for the main effect.
- Leaving debug code or test hacks behind (`if (false)`, diagnostic `console.log`).
- Using Apple names or trademarks ("Liquid Glass", "Spotlight") in the fork's name, description or UI.

## 5. Decisions

### 5.1 Fork identity

| Field | Value |
|---|---|
| Display name | Search Light Glass |
| UUID | `search-light-glass@antonioestela.github.com` |
| Settings schema | `org.gnome.shell.extensions.search-light-glass` (path `/org/gnome/shell/extensions/search-light-glass/`) |
| Gettext domain | `search-light-glass` |
| `url` in metadata | `https://github.com/AntonioEstela/search-light-glass` |
| `shell-version` | `["48", "49", "50"]` |
| `version` | `1` |

Every reference must be renamed: `metadata.json`, the `.gschema.xml` file and its id, the `Makefile` (install, publish, zip name), `prefs.js`, the `.ui` files and any `search-light@icedman` in the JS. The README must state it is a fork, link the original, credit icedman (and Blur my Shell for the corner-shader idea, if its code is adapted), and keep GPL-3.0.

### 5.2 Glass: technical approach (validated by a spike on GNOME 50.1)

A throwaway spike in a nested shell (`gnome-shell --devkit`) confirmed this approach works on GNOME 50. Root causes of the earlier failure:

1. **`offscreen_redirect = ALWAYS`** on the panel container (`SearchLight._init`). The whole panel is painted into its own buffer, so a `Shell.BlurEffect` in `BACKGROUND` mode inside it blurs an empty buffer.
2. `Shell.BlurEffect` has **no corner radius** (only `radius`, `brightness`, `mode`), so it always paints a rectangle.
3. On GNOME 50, a `Clutter.Clone` of `global.window_group` is 0×0 and paints nothing.
4. On GNOME 50, `Clutter.ShaderEffect` no longer takes `Clutter.ShaderType` (`undefined`). What works is `Shell.GLSLEffect` with `vfunc_build_pipeline()` + `add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, decl, code, false)`, the same pattern as GNOME Shell's `lightbox.js`.

What worked:

- A **separate glass layer** (`St.Widget`) added with `Main.layoutManager.addChrome` **directly below** the panel, as a sibling and **not** as a child of the redirected container.
- The layer is **larger than the panel** by a margin (`PAD`, ~40px per side) so the blur has real pixels at the edges and does not darken them. It has `clip_to_allocation = true`.
- Inside it, a "scene": a `Clutter.Clone` of each child of `Main.layoutManager._backgroundGroup` and of each visible `global.get_window_actors()` entry, with its `x/y/width/height`. The scene is offset so the area under the panel lines up with the real screen.
- Effects on the layer, in this `add_effect` order:
  1. a custom `Shell.GLSLEffect` (outer) that rounds the corners of the inner rectangle (excluding `PAD`) with antialiasing, boosts saturation (~1.8) and mixes in the tint;
  2. `Shell.BlurEffect({ mode: ACTOR, radius: ~60, brightness: 1.0 })` (inner: applied first).
- The spike's shader is a reference only and may be rewritten. Its fragment code, for reference:

  ```glsl
  // declarations
  uniform float width, height, pad, radius, saturation;
  uniform vec4 tint;
  float roundedBox(vec2 p, vec2 h, float r) {
    vec2 q = abs(p) - h + vec2(r);
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
  }
  // code (non-replace snippet: cogl_color_out already holds the sampled texel)
  vec2 uv = cogl_tex_coord_in[0].xy;
  vec2 pos = uv * vec2(width, height);
  vec2 size = vec2(width, height) - vec2(2.0 * pad);
  float d = roundedBox(pos - vec2(pad) - size * 0.5, size * 0.5, radius);
  float cov = 1.0 - smoothstep(-0.75, 0.75, d);
  vec4 c = cogl_color_out;
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : c.rgb;
  float g = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = clamp(mix(vec3(g), rgb, saturation), 0.0, 1.0);
  rgb = mix(rgb, tint.rgb, tint.a);
  cogl_color_out = vec4(rgb, 1.0) * cov;
  ```

The layer must **track the panel** at all times:

- position and size, including height as results appear or disappear (`text-changed`, `_layout()`);
- open/close animations (opacity, scale, translation);
- show and hide.

While the panel is closed, the layer and its clones are **destroyed or emptied**: no cloned windows are repainted in the background. If a window opens or closes while the panel is open, the scene may go stale; the minimum acceptable behaviour is rebuilding it on every `show()`.

The original static ImageMagick blur (`_updateBlurredBackground`, `desktop_background_blurred`) is **removed**.

### 5.3 Results list: option A ("sections")

Approved mockup: a single column, like the dark macOS reference screenshot.

- Search field at the top with a magnifier icon, then a **thin divider** spanning almost the full width.
- Each provider is a **section**: small grey title (~12px, semibold, 55% white in dark) with a thin line under it.
- Each result is a **row**: icon (~26–32px) + name + one-line grey subtitle with ellipsis (path or description).
- **Selection:** translucent pill (~14% white) with a **thin bright inner border** (~28% white), radius ~12px. No solid blue.
- GNOME's two-column layout (provider name on the left, results on the right) is removed. The provider name or icon becomes the section title.
- No per-provider background cards.
- **Applications are rows too** (author's decision). The apps provider, which GNOME draws as a horizontal icon grid (`.overview-tile` / `GridSearchResults`), uses the same row format as everything else: icon, name and, as subtitle, the app description (`app.get_description()`) when present. Keep the number of apps GNOME shows. Keyboard navigation (arrows, Tab), Enter, click, and drag-to-dock (if GNOME supports it today) must keep working on 48–50. This is the riskiest part. If some version cannot do it cleanly, tell the author before falling back to the grid.

### 5.4 Panel look

- Corner radius ~26–28px by default.
- 1px translucent white border: ~18% in dark, ~60% in light.
- Subtle specular highlight at the top (`inset 0 1px 0`, ~25–35% white) and a soft outer shadow.
- **Dark tint** ≈ `rgba(28,33,52,~0.55)` (slate blue), white text, subtitles at ~55–70%.
- **Light tint** ≈ white with more alpha than the spike's 0.45, which was too weak over dark windows. Near-black text (`#1d1d1f`).
- Visual reference: the two macOS screenshots (light and dark) supplied by the author. Very strong blur, background color bleeding through, highly legible text.

### 5.5 Defaults and settings

- `blur-background`: **`true`** by default. It now means "real blur", and its preferences text no longer mentions ImageMagick.
- `blur-sigma` and `blur-brightness` are reused as radius and brightness of the new blur, with defaults matching §5.2.
- `border-radius`, `border-thickness` and `border-color` default to the values in §5.4.
- The theme follows `org.gnome.desktop.interface color-scheme` (`prefer-dark` → dark, `prefer-light`/`default` → light) and reacts live to changes.
- *(Claude's call)* User colors vs. automatic theme: the theme decides tint, border and text color. `background-color`, `border-color`, `text-color` and `entry-text-color` only **override** the theme when the user has changed them, detected with `settings.get_user_value(key) !== null`. No new keys and no "unset" sentinel are needed, so the per-theme values from §5.4 live in code rather than in schema defaults. With `blur-background` off, the panel uses the same theme tint (or the user's color, if changed) without blur.
- *(Claude's call)* The `unit-converter` and `currency-converter` switches already do nothing upstream (there is no converter code). They are left as they are, not reimplemented.

## 6. Constraints

- **GPL-3.0**: the license and the original copyright notice are kept.
- **GNOME 48, 49 and 50**: only APIs available in all three. Testing is only possible on GNOME 50.1 (Ubuntu, Wayland) on the author's machine. **48 and 49 remain unverified** unless a VM becomes available; the README must say so.
- **Test loop**: on Wayland, extension JS does not hot-reload. Test in a nested shell: `dbus-run-session -- gnome-shell --devkit --wayland`, with `XDG_DATA_HOME` pointing at a copy (must be an absolute path), `GSETTINGS_BACKEND=memory`, and the extension enabled over D-Bus (`org.gnome.Shell.Extensions.EnableExtension`). Screenshots are taken from inside with `Shell.Screenshot`.
- **Careful:** a nested shell killed before ~60s leaves `/run/user/1000/gnome-shell-disable-extensions`, which **disables the user's extensions on their next login**. Delete it after every test run.
- **Height calculation:** the panel height is `entry.height + 4*scale` and **does not include `StEntry` margins**. Margins or padding on the container make the field overflow the panel.
- **Repository:** `~/Documents/Projects/search-light-glass` is a `git clone` of upstream (HEAD `4e93e0e`) with icedman's history. Work is committed on top of that history. To publish, `origin` is repointed to `github.com/AntonioEstela/search-light-glass` and upstream is kept as the `upstream` remote. GitHub's "Fork" button is not used, because it would force the name `search-light`.
- **Language:** all repository content (code comments, docs, commit messages) is in English.
- The author's existing install (`~/.local/share/gnome-shell/extensions/search-light@icedman.github.com`) has uncommitted local changes from an earlier session. **Do not touch it.**

## 7. Left to the builder

- Code structure: a new module for the glass (e.g. `glass.js`) vs. integrating it into `extension.js`.
- Whether to reuse Blur my Shell's `corner.glsl` (GPL-3.0, compatible) or write a custom shader.
- How the results list styling is rewritten: CSS on GNOME's classes (`.list-search-result`, `.search-section-content`, etc.) or manipulating the actor hierarchy. It must look like §5.3 on 48–50.
- Exact tint, alpha, saturation and radius values within the §5.4 ranges, tuned by looking at light and dark screenshots.
- Whether to rebuild the scene when windows open or close while the panel is open.
- The existing window effects (`window-effect`: tint, monochrome, blur) use `Clutter.ShaderEffect`. Check whether they work on GNOME 50 and, if not, port them to the same `Shell.GLSLEffect` pattern.
