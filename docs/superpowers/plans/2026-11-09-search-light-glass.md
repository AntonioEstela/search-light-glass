# Search Light Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the upstream Search Light extension into "Search Light Glass": real-blur rounded glass panel, automatic light/dark theme, and a single-column sectioned results list (apps as rows), for GNOME 48–50.

**Architecture:** A new `glass.js` module owns a separate glass actor (wallpaper and window clones + `Shell.BlurEffect` + a rounded-corner/saturation/tint `Shell.GLSLEffect`) that sits below the panel in the chrome layer and mirrors the panel's geometry and animations. A pure `theme.js` module resolves the palette from the system color scheme and user overrides. A `results.js` module restyles GNOME's borrowed search results while Search Light owns them and restores them on release. Verification runs inside a nested GNOME Shell driven by a probe extension that writes screenshots and a JSON report.

**Tech Stack:** GJS (ES modules), St/Clutter/Shell/Meta (GNOME 48–50, mutter 16–18), GLSL via Cogl snippets, GSettings, `gnome-shell --devkit` (mutter-dev-bin), Node only for `node --check` syntax checks.

**Spec:** `docs/superpowers/specs/2026-11-09-search-light-glass-design.md`

## Global Constraints

- UUID `search-light-glass@antonioestela.github.com`; schema `org.gnome.shell.extensions.search-light-glass` (path `/org/gnome/shell/extensions/search-light-glass/`); gettext domain `search-light-glass`; url `https://github.com/AntonioEstela/search-light-glass`; `shell-version` `["48", "49", "50"]`; `version` `1`.
- Only APIs present in GNOME 48, 49 and 50. Do not use `Clutter.ShaderEffect` with `Clutter.ShaderType` (undefined on 50); use `Shell.GLSLEffect` + `add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, decl, code, false)`.
- No ImageMagick or other external tools. No GPU work while the panel is closed.
- No leftover debug code (`if (false)`, diagnostic `console.log`).
- No Apple names or trademarks ("Liquid Glass", "Spotlight") anywhere in the repo's shipped files or UI.
- GPL-3.0 and the original copyright stay. README credits icedman, plus Blur my Shell if its shader is adapted.
- All repo content (code, comments, docs, commit messages) in English. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never touch `~/.local/share/gnome-shell/extensions/search-light@icedman.github.com`.
- After every nested-shell run, `rm -f /run/user/1000/gnome-shell-disable-extensions`.
- Panel height is `entry.height + 4*scale` and ignores `StEntry` margins: never add margin or padding to the entry's container.

## Review Focus

1. **Normal overview after using the panel.** Opening the overview (Super) after closing Search Light must show GNOME's stock layout: an app icon grid and the two-column provider rows. Covered by the `overview-restored` check in Task 6 and the `overview-apps-grid` check in Task 7.
2. **Height change while typing.** The glass must follow the panel as results appear and disappear, with no stale rectangle. Covered by the `glass-tracks-panel-after-typing` check in Task 4.
3. **Window opened while the panel is open.** Upstream hides the panel (`opacity = 0`) on `window-created`; the glass must hide too. Covered by the `glass-hidden-on-window-created` check in Task 4.
4. **Disable/enable cycle.** No leaked glass actors or effects after `disable()`; re-enable works. Covered by the `no-leak-after-disable` check in Task 4.
5. **Theme switch while open.** Changing `color-scheme` with the panel open retints it live. Covered by the `live-theme-switch` check in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `tests/nested/run.sh` (new) | Install the working tree and the probe into a temp `XDG_DATA_HOME`, start a nested shell, enable both, wait for the report, clean up. |
| `tests/nested/probe@search-light-glass.test/` (new, not shipped) | Probe extension: drives Search Light through scenarios, takes screenshots, writes `report.json`. |
| `tests/unit/test_theme.js` (new) | `gjs -m` unit tests for `theme.js`. |
| `theme.js` (new) | Pure palette resolution. No `gi://` imports. |
| `glass.js` (new) | `GlassEffect` shader and `GlassLayer` actor lifecycle and tracking. |
| `results.js` (new) | `ResultsRestyler`: sections layout and app rows, apply/restore. |
| `extension.js` | Wire the modules in, remove the ImageMagick blur, apply theme CSS. |
| `stylesheet.css` | New glass and results styles (replace the upstream result styles). |
| `metadata.json`, `schemas/*.gschema.xml`, `preferences/keys.js`, `prefs.js`, `ui/*.ui`, `Makefile`, `README.md` | Fork identity, defaults, copy. |
| `effects/*.js` | Port to `Shell.GLSLEffect` if broken on 50 (Task 8). |

---

### Task 1: Nested-shell test harness

**Files:**
- Create: `tests/nested/run.sh`
- Create: `tests/nested/probe@search-light-glass.test/metadata.json`
- Create: `tests/nested/probe@search-light-glass.test/extension.js`
- Modify: `Makefile` (add `test-nested` and `test-unit` targets; exclude `tests/` from `publish`, which it already does by listing files explicitly)

**Interfaces:**
- Produces: `tests/nested/run.sh <scenario> [out_dir]` → exit 0 when `report.json` has `"ok": true`, non-zero otherwise. Prints each check line as `PASS name` / `FAIL name: detail`. Writes `out_dir/*.png` and `out_dir/report.json`. Default `out_dir` is `$(mktemp -d)`.
- Produces: probe scenario registry `SCENARIOS: {[name: string]: async (ctx) => void}` in the probe's `extension.js`, where `ctx = {ext /* Main.overview.searchLight */, check(name: string, cond: boolean, detail?: string), shot(file: string): Promise<void>, wait(ms: number): Promise<void>, setScheme('light'|'dark'): void, type(text: string): void}`. Later tasks add scenarios here.
- Consumes: the extension under test exposes itself as `Main.overview.searchLight` (upstream already does).

- [ ] **Step 1: Write the probe with a `smoke` scenario**

The probe reads env `PROBE_SCENARIO` and `PROBE_OUT`, waits 1500 ms after enable, runs the scenario, writes `report.json` = `{scenario, ok, checks: [{name, ok, detail}]}`, then logs `[probe] done`. `shot()` uses `Shell.Screenshot().screenshot(false, stream)`. `setScheme()` writes `org.gnome.desktop.interface color-scheme` (`prefer-dark` / `default`). `type()` calls `Main.overview.searchEntry.set_text(text)`.

```js
SCENARIOS.smoke = async ctx => {
  ctx.check('extension-present', !!ctx.ext);
  ctx.ext.show();
  await ctx.wait(800);
  ctx.check('panel-visible', ctx.ext.mainContainer.visible && ctx.ext._visible === true);
  await ctx.shot('smoke.png');
  ctx.ext.hide();
};
```

- [ ] **Step 2: Write `run.sh`**

Copy the working tree's shipped files (same list as `make publish`) into `$TMP/data/gnome-shell/extensions/<uuid from metadata.json>/`, run `glib-compile-schemas` there, and copy the probe alongside. Export an absolute `XDG_DATA_HOME`, `GSETTINGS_BACKEND=memory` and the `PROBE_*` vars. Inside `dbus-run-session`: start `gnome-shell --devkit --wayland --no-x11 --wayland-display=slg-test-0`, wait for `org.gnome.Shell` on the bus, launch `WAYLAND_DISPLAY=slg-test-0 gnome-text-editor` so there is a window behind the panel, enable the extension under test, then the probe, via `gdbus call ... org.gnome.Shell.Extensions.EnableExtension`. Poll for `report.json` for up to 30 s. Kill the shell, `rm -f /run/user/1000/gnome-shell-disable-extensions` in a `trap ... EXIT`, print the checks, and exit by `ok`. Save the shell log to `out_dir/shell.log`.

- [ ] **Step 3: Run the smoke scenario against upstream**

Run: `tests/nested/run.sh smoke /tmp/slg-smoke`
Expected: `PASS extension-present`, `PASS panel-visible`, exit 0, `/tmp/slg-smoke/smoke.png` exists, and `/run/user/1000/gnome-shell-disable-extensions` does not exist afterwards.

- [ ] **Step 4: Commit**

```bash
git add tests/nested Makefile
git commit -m "test: add nested GNOME Shell harness and probe extension"
```

---

### Task 2: Fork identity

**Files:**
- Modify: `metadata.json`, `preferences/keys.js:5`, `prefs.js:9,78-90,125`, `ui/general.ui:19`, `Makefile` (all `search-light@icedman.github.com` → new UUID; zip name)
- Rename: `schemas/org.gnome.shell.extensions.search-light.gschema.xml` → `schemas/org.gnome.shell.extensions.search-light-glass.gschema.xml` (update `id` and `path`), regenerate `schemas/gschemas.compiled`
- Modify: `extension.js:909` (`custom-search-light` → `custom-search-light-glass`)
- Modify: `README.md` (fork notice at top: what it is, link to upstream, credit icedman, GPL-3.0; note "tested on GNOME 50 only; 48 and 49 untested")

**Interfaces:**
- Produces: the identity values from Global Constraints, used by `run.sh` (it reads the UUID from `metadata.json`).

- [ ] **Step 1: Add an `identity` scenario to the probe**

```js
SCENARIOS.identity = async ctx => {
  const ext = Main.extensionManager.lookup('search-light-glass@antonioestela.github.com');
  ctx.check('uuid-active', ext?.state === 1 /* ACTIVE */, `state=${ext?.state}`);
  ctx.check('schema-id', ctx.ext._settings.schema_id === 'org.gnome.shell.extensions.search-light-glass');
};
```

- [ ] **Step 2: Run it and see it fail**

Run: `tests/nested/run.sh identity`
Expected: `FAIL uuid-active` (the old UUID is installed).

- [ ] **Step 3: Apply the renames listed under Files.** In `prefs.js`, issue and source links point to the new repo, the license link points to the new repo's `LICENSE`, and the Buy-me-a-coffee link and QR image are removed. In `ui/general.ui`, the thank-you label names Search Light Glass and credits icedman's original, with no donation link.

- [ ] **Step 4: Verify**

Run: `glib-compile-schemas --strict --targetdir=schemas/ schemas && grep -rn "search-light@icedman\|extensions\.search-light'\|'search-light'" --include=*.js --include=*.json --include=*.ui --include=Makefile . ; tests/nested/run.sh identity`
Expected: schema compiles, grep prints nothing, both checks PASS.

- [ ] **Step 5: Commit**

```bash
git add -A metadata.json schemas preferences prefs.js ui Makefile extension.js README.md
git commit -m "chore: rename fork to Search Light Glass"
```

---

### Task 3: Theme resolver

**Files:**
- Create: `theme.js`
- Test: `tests/unit/test_theme.js` (run with `gjs -m tests/unit/test_theme.js`; it exits non-zero on the first failed assertion)

**Interfaces:**
- Produces, in `theme.js`:
  - `PALETTES = { dark: {tint: [0.110, 0.129, 0.204, 0.55], border: [1, 1, 1, 0.18], text: [1, 1, 1, 1]}, light: {tint: [1, 1, 1, 0.72], border: [1, 1, 1, 0.60], text: [0.114, 0.114, 0.122, 1]} }` (colors are `[r, g, b, a]` in 0–1)
  - `schemeFromColorScheme(value: string): 'light' | 'dark'` → `'dark'` only for `'prefer-dark'`
  - `resolvePalette({scheme, overrides}): {tint, border, text, entryText, isLight}`, where `overrides = {background_color, border_color, text_color, entry_text_color}`, each `[r,g,b,a] | null` (null = user never set it)
  - Rules: each override replaces its field when non-null. When `text_color` is null, `text` comes from the final tint's luminance: `0.3r + 0.59g + 0.11b >= 0.5` → light text palette's dark text, else white. That is the same formula upstream uses in `_updateCss`. `entryText` = `entry_text_color ?? text`. `isLight` = that luminance test on the final tint.

- [ ] **Step 1: Write the failing tests**

```js
import {PALETTES, schemeFromColorScheme, resolvePalette} from '../../theme.js';
const none = {background_color: null, border_color: null, text_color: null, entry_text_color: null};
assertEq(schemeFromColorScheme('prefer-dark'), 'dark');
assertEq(schemeFromColorScheme('default'), 'light');
assertEq(schemeFromColorScheme('prefer-light'), 'light');
const d = resolvePalette({scheme: 'dark', overrides: none});
assertEq(d.tint, PALETTES.dark.tint); assertEq(d.text, [1, 1, 1, 1]); assertEq(d.isLight, false);
const l = resolvePalette({scheme: 'light', overrides: none});
assertEq(l.tint, PALETTES.light.tint); assertEq(l.text, PALETTES.light.text); assertEq(l.isLight, true);
const o = resolvePalette({scheme: 'light', overrides: {...none, background_color: [0, 0, 0, 0.5]}});
assertEq(o.tint, [0, 0, 0, 0.5]); assertEq(o.text, [1, 1, 1, 1]); assertEq(o.isLight, false);
const t = resolvePalette({scheme: 'dark', overrides: {...none, text_color: [1, 0, 0, 1], entry_text_color: [0, 1, 0, 1]}});
assertEq(t.text, [1, 0, 0, 1]); assertEq(t.entryText, [0, 1, 0, 1]);
assertEq(resolvePalette({scheme: 'dark', overrides: {...none, border_color: [1, 0, 0, 1]}}).border, [1, 0, 0, 1]);
```

`assertEq` is a 5-line deep-equality helper at the top of the file that throws with both values on mismatch.

- [ ] **Step 2: Run and see it fail**

Run: `gjs -m tests/unit/test_theme.js`
Expected: fails to import `../../theme.js`.

- [ ] **Step 3: Implement `theme.js`** per the Interfaces block.

- [ ] **Step 4: Run and see it pass**

Run: `gjs -m tests/unit/test_theme.js && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add theme.js tests/unit/test_theme.js Makefile
git commit -m "feat: add light/dark palette resolver"
```

---

### Task 4: Glass layer

**Files:**
- Create: `glass.js`
- Modify: `extension.js`: `_setupBackground`, `_updateBlurredBackground` (delete), `show()`, `hide()`, `_layout()`, the `text-changed` handler in `_acquire_ui`, the `window-created` handler, the `background-color`/`blur-background` settings cases, the `picture-uri` listener (delete), `disable()`
- Modify: probe, adding scenarios `glass` and `leak`

**Interfaces:**
- Produces, in `glass.js`:
  - `GLASS_PAD = 40`, `GLASS_SATURATION = 1.8`
  - `class GlassLayer { constructor(); attach(panel: Clutter.Actor): void; setStyle({radius: number, tint: number[4], blurRadius: number, brightness: number}): void; rebuildScene(): void; sync(): void; detach(): void; get actor(): St.Widget | null }`
  - `attach()` creates the actor with `Main.layoutManager.addChrome(actor, {affectsStruts: false, trackFullscreen: false})`, puts it directly below `panel` (`Main.layoutManager.uiGroup.set_child_below_sibling`), adds effects in the order *GlassEffect then BlurEffect* (see the spec, §5.2), and connects `notify::x/y/width/height/opacity/scale-x/scale-y/translation-x/translation-y/visible` on `panel` to `sync()`. `detach()` disconnects, removes the chrome and destroys the actor and clones. After `detach()`, `actor` is `null`.
  - `sync()` sets, with `s = panel.scale_x` (scale_y analogous): `actor.x = panel.x + panel.translation_x - GLASS_PAD * s`, `actor.y` likewise; `actor.width = panel.width + 2 * GLASS_PAD`, `actor.height` likewise; `actor.scale_x = s`, `actor.scale_y = panel.scale_y`, pivot `(0, 0)`; `actor.opacity = panel.opacity`; `actor.visible = panel.visible`. It also moves the scene to `(-actor.x, -actor.y)` (clones sit at stage coordinates, so this lines the scene up with the screen when scale is 1; slight drift during the 0.9→1.0 open animation is acceptable) and updates the shader's `width/height` uniforms.
  - `rebuildScene()` destroys the old clones and clones every child of `Main.layoutManager._backgroundGroup` and every `global.get_window_actors()` entry with `visible === true` and `!meta_window.minimized`, each at its `x/y/width/height`.
  - `class GlassEffect extends Shell.GLSLEffect` with `setUniforms({width, height, pad, radius, saturation, tint})`. The fragment code is the spike shader in spec §5.2 (non-replace snippet).
- Consumes: `resolvePalette` (Task 3) for `tint`; `rads[border_radius]` for `radius`.
- Extension wiring: `this._glass` is a `GlassLayer` that exists **only while the panel is shown and `blur_background` is true**: `attach` + `rebuildScene` in `show()` before the animation starts, and `detach()` in `hide()`'s `onComplete` (or immediately when animations are off). The `window-created` handler sets the panel's opacity to 0, so `sync()` must propagate that. Remove `_bgActor` and the ImageMagick path. `_background` stays as the tint/border actor (CSS only, no effects).

- [ ] **Step 1: Add probe scenarios**

```js
SCENARIOS.glass = async ctx => {
  ctx.ext.show(); await ctx.wait(800);
  const g = ctx.ext._glass?.actor, p = ctx.ext.mainContainer;
  ctx.check('glass-exists', !!g);
  ctx.check('glass-below-panel', g && g.get_parent() === p.get_parent() &&
    g.get_parent().get_children().indexOf(g) < g.get_parent().get_children().indexOf(p));
  const near = (a, b) => Math.abs(a - b) <= 1;
  ctx.check('glass-aligned', g && near(g.x + 40, p.x) && near(g.y + 40, p.y) && near(g.width - 80, p.width));
  ctx.check('effects', g && !!g.get_effect('glass') && !!g.get_effect('blur'));
  await ctx.shot('glass-empty.png');
  ctx.type('settings'); await ctx.wait(1500);
  ctx.check('glass-tracks-panel-after-typing', g && near(g.height - 80, p.height) && p.height > ctx.ext.initial_height);
  await ctx.shot('glass-typed.png');
  global.display.emit('window-created', global.display.focus_window); await ctx.wait(300);
  ctx.check('glass-hidden-on-window-created', g && (g.opacity === 0 || !g.visible));
  ctx.ext.hide(); await ctx.wait(1000);
  ctx.check('glass-gone-after-hide', ctx.ext._glass?.actor == null);
};
SCENARIOS.leak = async ctx => {
  const uuid = 'search-light-glass@antonioestela.github.com';
  const count = () => Main.layoutManager.uiGroup.get_children().length;
  ctx.ext.show(); await ctx.wait(800); ctx.ext.hide(); await ctx.wait(800);
  const before = count();
  Main.extensionManager.disableExtension(uuid); await ctx.wait(500);
  Main.extensionManager.enableExtension(uuid); await ctx.wait(1500);
  ctx.check('no-leak-after-disable', count() === before, `${before} -> ${count()}`);
  Main.overview.searchLight.show(); await ctx.wait(800);
  ctx.check('reenable-works', !!Main.overview.searchLight._glass?.actor);
};
```

- [ ] **Step 2: Run and see them fail**

Run: `tests/nested/run.sh glass; tests/nested/run.sh leak`
Expected: `FAIL glass-exists` and later checks fail.

- [ ] **Step 3: Implement `glass.js` and the wiring** per the Interfaces block. `setStyle` is called from `_updateCss()` whenever the palette or radius changes.

- [ ] **Step 4: Run and see them pass; inspect the screenshots**

Run: `tests/nested/run.sh glass /tmp/slg-glass; tests/nested/run.sh leak`
Expected: all PASS. In `/tmp/slg-glass/glass-typed.png` the editor window behind the panel is visibly blurred (no readable code text inside the panel), all 4 corners are round, and the edges show no dark fringe.

- [ ] **Step 5: Commit**

```bash
git add glass.js extension.js tests/nested
git commit -m "feat: real backdrop blur with rounded glass layer"
```

---

### Task 5: Panel look, theme and defaults

**Files:**
- Modify: `extension.js` `_updateCss()` (use `resolvePalette`; drop the old luminance/`light` class logic in favor of `isLight`), `enable()` (listen to `org.gnome.desktop.interface` `changed::color-scheme` → `_updateCss()`; disconnect in `disable()`)
- Modify: `schemas/org.gnome.shell.extensions.search-light-glass.gschema.xml` defaults: `blur-background` `true`, `blur-sigma` `60`, `blur-brightness` `1.0`, `border-radius` `6` (index into `[0,16,18,20,22,24,28,32]` → 28 px), `border-thickness` `1`
- Modify: `ui/appearance.ui:269` subtitle → `"Blur whatever is behind the panel."`; any other mention of ImageMagick removed
- Modify: `stylesheet.css`: replace the upstream panel styles with the glass look from spec §5.4 (thin border, `inset 0 1px 0` highlight, soft outer shadow, divider under the entry). Light and dark variants keyed on the `light` style class that `_updateCss` sets from `isLight`.
- Modify: probe, adding scenario `theme`

**Interfaces:**
- Consumes: `schemeFromColorScheme`, `resolvePalette` (Task 3); `GlassLayer.setStyle` (Task 4).
- User overrides come from `this._settings.get_user_value(key) !== null ? this[key_underscored] : null`.

- [ ] **Step 1: Add the probe scenario**

```js
SCENARIOS.theme = async ctx => {
  ctx.setScheme('dark'); ctx.ext.show(); ctx.type('files'); await ctx.wait(1500);
  ctx.check('dark-class', !ctx.ext.container.has_style_class_name('light'));
  ctx.check('blur-default-on', ctx.ext._settings.get_boolean('blur-background') === true);
  await ctx.shot('theme-dark.png');
  ctx.setScheme('light'); await ctx.wait(800);
  ctx.check('live-theme-switch', ctx.ext.container.has_style_class_name('light'));
  await ctx.shot('theme-light.png');
  ctx.ext._settings.set_boolean('blur-background', false); await ctx.wait(500);
  ctx.check('no-glass-when-blur-off', ctx.ext._glass?.actor == null);
  await ctx.shot('theme-noblur.png');
  ctx.ext.hide();
};
```

- [ ] **Step 2: Run and see it fail**

Run: `tests/nested/run.sh theme`
Expected: `FAIL blur-default-on` at least.

- [ ] **Step 3: Implement** per Files and Interfaces. Toggling `blur-background` while the panel is open attaches or detaches the glass immediately.

- [ ] **Step 4: Run, pass, and compare against the reference**

Run: `tests/nested/run.sh theme /tmp/slg-theme`
Expected: all PASS. In `theme-dark.png` and `theme-light.png`, text is clearly legible over the blurred editor window. The light tint reads as milky white, not grey; if it reads grey, raise `PALETTES.light.tint[3]` (stay ≤ 0.85) and update the unit test. `theme-noblur.png` shows the tinted panel without blur and with round corners.

- [ ] **Step 5: Commit**

```bash
git add extension.js schemas ui/appearance.ui stylesheet.css tests/nested
git commit -m "feat: automatic light/dark glass theme and new defaults"
```

---

### Task 6: Results as sections (option A)

**Files:**
- Create: `results.js`
- Modify: `extension.js` `_acquire_ui()` → `this._restyler = new ResultsRestyler(this._searchResults); this._restyler.apply();`; `_release_ui()` → `this._restyler?.restore(); this._restyler = null;`
- Modify: `stylesheet.css`, adding results styles scoped under `#searchLight`
- Modify: probe, adding scenario `sections`

**Interfaces:**
- Produces, in `results.js`: `class ResultsRestyler { constructor(view /* SearchResultsView */); apply(): void; restore(): void }`.
  - `apply()` walks `view._providers` (and hooks `view._ensureProviderDisplay` so displays created later are handled). For each `ListSearchResults` display: set `display._container.orientation = Clutter.Orientation.VERTICAL`, hide the `providerInfo` icon (the first child of `providerInfo._content`), and add style class `slg-section` to `display`. Remember every change so `restore()` puts back the exact original orientation, visibility and classes.
  - CSS (spec §5.3): `.slg-section` title text ~12px semibold, 55% of the text color, with a 1px divider below; rows `.list-search-result` get a ~26–32px icon, title, and one-line ellipsized description; `:selected`/`:focus`/`:hover` → pill `rgba(255,255,255,0.14)` with `inset 0 0 0 1px rgba(255,255,255,0.28)`, radius 12px; no solid blue; no per-provider card background.
- Consumes: nothing from earlier tasks besides the extension hooks.

- [ ] **Step 1: Add the probe scenario**

```js
SCENARIOS.sections = async ctx => {
  const lists = () => ctx.ext._searchResults._providers.map(p => p.display)
    .filter(d => d && d._container && d.providerInfo);
  ctx.ext.show(); ctx.type('settings'); await ctx.wait(1500);
  ctx.check('has-list-sections', lists().length > 0);
  ctx.check('sections-vertical', lists().every(d =>
    d._container.orientation === Clutter.Orientation.VERTICAL && d.has_style_class_name('slg-section')));
  await ctx.shot('sections.png');
  ctx.ext.hide(); await ctx.wait(800);
  Main.overview.show(); await ctx.wait(1200); ctx.type('settings'); await ctx.wait(1500);
  ctx.check('overview-restored', lists().every(d =>
    d._container.orientation === Clutter.Orientation.HORIZONTAL && !d.has_style_class_name('slg-section')));
  await ctx.shot('overview.png');
  Main.overview.hide();
};
```

- [ ] **Step 2: Run and see it fail**

Run: `tests/nested/run.sh sections`
Expected: `FAIL sections-vertical`.

- [ ] **Step 3: Implement `results.js`, the hooks and the CSS.**

- [ ] **Step 4: Run, pass, and inspect**

Run: `tests/nested/run.sh sections /tmp/slg-sections`
Expected: all PASS. `sections.png` matches mockup A: a grey section title over a thin line, rows below, and the first row as a translucent pill. `overview.png` shows GNOME's stock two-column rows.

- [ ] **Step 5: Commit**

```bash
git add results.js extension.js stylesheet.css tests/nested
git commit -m "feat: single-column sectioned results list"
```

---

### Task 7: Applications as rows

**Files:**
- Modify: `results.js`, adding `AppRowResults` and extending `ResultsRestyler`
- Modify: `extension.js` `_isDraggingIcon()` (handle the row display; keep it from throwing)
- Modify: `Makefile`: add `test-nested-interactive` (runs `tests/nested/run.sh` with `PROBE_SCENARIO=none`; the probe does nothing and the devkit window stays open until closed)
- Modify: probe, adding scenario `apps`

**Interfaces:**
- Produces, in `results.js`: `const AppRowResults = GObject.registerClass(class AppRowResults extends GridSearchResults { ... })`, with `GridSearchResults` and `ListSearchResult` imported from `resource:///org/gnome/shell/ui/search.js`. Overrides:
  - `_createResultDisplay(meta)` → `new ListSearchResult(this.provider, {...meta, description: Shell.AppSystem.get_default().lookup_app(meta.id)?.get_description() ?? ''}, this._resultsView)`
  - a vertical `St.BoxLayout` `this._rows` (style class `list-search-results`) set as `this._resultDisplayBin.child`
  - `_addItem(d)` → `this._rows.add_child(d)`; `_clearResultDisplay()` → `this._rows.remove_all_children()`; `getFirstResult()` → first child of `_rows` or `null`; `_getMaxDisplayedResults()` → `this.provider.maxResults ?? -1` capped at 5 (GNOME's `MAX_LIST_SEARCH_RESULTS_ROWS`).
  - a section title `St.Label` ("Applications", translatable) styled like `.slg-section`'s title
- `ResultsRestyler.apply()`: for the provider whose display is a `GridSearchResults` (the apps provider: `!provider.appInfo`), create an `AppRowResults(provider, view)`, insert it at the same index in `view._content`, hide the original, and set `provider.display` to it. `restore()` destroys it, shows the original and sets `provider.display` back. Keyboard focus, `activateDefault` and click work through the inherited `SearchResultsBase` and `ListSearchResult`.
- Drag to dock: GNOME's dash only accepts `AppDisplay.AppIcon` sources. Try making rows draggable with a source exposing `.app`. **If the dock rejects them, do not hack around it.** Record it in the task report and tell the author. Do not fall back to the grid (spec §5.3).

- [ ] **Step 1: Add the probe scenario**

```js
SCENARIOS.apps = async ctx => {
  const appsProv = () => ctx.ext._searchResults._providers.find(p => !p.appInfo);
  ctx.ext.show(); ctx.type('text'); await ctx.wait(1500);
  const d = appsProv()?.display;
  ctx.check('apps-are-rows', d?.constructor?.name === 'AppRowResults' && d._rows.get_n_children() > 0);
  ctx.check('apps-row-has-title', d && d._rows.get_child_at_index(0)?.has_style_class_name('list-search-result'));
  ctx.check('apps-first-result', !!ctx.ext._searchResults._defaultResult);
  await ctx.shot('apps.png');
  ctx.ext.hide(); await ctx.wait(800);
  Main.overview.show(); await ctx.wait(1200); ctx.type('text'); await ctx.wait(1500);
  ctx.check('overview-apps-grid', appsProv()?.display?.constructor?.name === 'GridSearchResults');
  Main.overview.hide();
};
```

- [ ] **Step 2: Run and see it fail**

Run: `tests/nested/run.sh apps`
Expected: `FAIL apps-are-rows`.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run, pass, and inspect**

Run: `tests/nested/run.sh apps /tmp/slg-apps`
Expected: all PASS. `apps.png` shows Text Editor as a row (icon, name, description) under an "Applications" section title, styled like the other sections.

- [ ] **Step 5: Manual keyboard check in the nested shell** (`make test-nested-interactive`: `run.sh` with the probe disabled, leaving the devkit window open). Press the shortcut, type `text`, then Down/Up/Tab/Enter: the selection pill moves across sections and Enter launches Text Editor. Write the result in the commit body.

- [ ] **Step 6: Commit**

```bash
git add results.js extension.js tests/nested Makefile
git commit -m "feat: show applications as result rows"
```

---

### Task 8: Window effects on GNOME 50

**Files:**
- Modify (only if broken): `effects/tint_effect.js`, `effects/monochrome_effect.js`, `effects/blur_effect.js` and their `.glsl`
- Modify: probe, adding scenario `effects`

**Interfaces:**
- The `window-effect` setting (0 none, 1 tint, 2 monochrome, 3 blur) keeps its meaning. Ported effects keep their class names and constructor params (`{name, color}`) and `preload(path)`.

- [ ] **Step 1: Add the probe scenario**

```js
SCENARIOS.effects = async ctx => {
  for (const idx of [1, 2, 3]) {
    let err = null;
    try { ctx.ext._settings.set_int('window-effect', idx); } catch (e) { err = e; }
    await ctx.wait(300);
    ctx.check(`window-effect-${idx}`, !err && !!ctx.ext.windowEffect, `${err}`);
  }
  ctx.ext._settings.set_int('window-effect', 0);
};
```

- [ ] **Step 2: Run it**

Run: `tests/nested/run.sh effects; grep -i "ShaderType\|JS ERROR" /tmp/*/shell.log | tail`
Expected: if all PASS with no errors, skip to Step 5 and commit only the scenario. Otherwise, continue.

- [ ] **Step 3: Port** each failing effect to `Shell.GLSLEffect` (`vfunc_build_pipeline` + `add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, ...)`, uniforms via `get_uniform_location`/`set_uniform_float`), keeping the existing GLSL math.

- [ ] **Step 4: Run and pass**

Run: `tests/nested/run.sh effects`
Expected: all PASS, and no `JS ERROR` in `shell.log`.

- [ ] **Step 5: Commit**

```bash
git add effects tests/nested
git commit -m "fix: window effects on GNOME 50"
```

---

### Task 9: Docs, cleanup and full verification

**Files:**
- Modify: `README.md` (features, screenshots from the light/dark probe runs saved to `screenshots/`, install via `make install`, the GNOME 48/49 untested note, credits), `CHANGELOG.md` (new top entry `1 — Search Light Glass` listing the changes)
- Modify: probe, adding scenario `all` that runs every scenario in sequence (fresh `show()` per scenario)

- [ ] **Step 1: Leftover check**

Run: `grep -rnE "if \(false\)|console\.log\(|ImageMagick|convert -|Spotlight|Liquid Glass" --include=*.js --include=*.css --include=*.ui --include=*.xml --include=*.md . | grep -v "^./docs/\|^./tests/\|^./CHANGELOG"`
Expected: no output, except pre-existing upstream `console.log` calls in error-handling `catch` blocks (leave those).

- [ ] **Step 2: Syntax and unit checks**

Run: `for f in *.js effects/*.js preferences/*.js; do node --check "$f" || exit 1; done; gjs -m tests/unit/test_theme.js && echo UNIT-OK`
Expected: no syntax errors; `UNIT-OK`.

- [ ] **Step 3: Full nested run**

Run: `tests/nested/run.sh all /tmp/slg-all && ls /run/user/1000/gnome-shell-disable-extensions 2>&1`
Expected: every check PASS, exit 0, and `ls` reports "No such file or directory".

- [ ] **Step 4: Package check**

Run: `make publish && unzip -l search-light-glass@antonioestela.github.com.zip | grep -E "glass.js|theme.js|results.js|tests/" `
Expected: lists `glass.js`, `theme.js`, `results.js`; no `tests/`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md screenshots tests/nested
git commit -m "docs: README, changelog and screenshots for Search Light Glass"
```
