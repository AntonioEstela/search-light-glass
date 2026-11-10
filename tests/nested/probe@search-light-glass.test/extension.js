import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Keep these imports referenced so scenario code added by later tasks can use
// them directly without touching the header.
void Clutter;
void St;

const SCENARIOS = {};

// Disabling/enabling the extension under test makes the shell re-enable this
// probe too; the scenario must run only once per shell.
let scenarioStarted = false;

// ---- scenarios (later tasks append `SCENARIOS.<name> = async ctx => {...}`) ----

SCENARIOS.smoke = async ctx => {
  ctx.check('extension-present', !!ctx.ext);
  ctx.ext.show();
  await ctx.wait(800);
  ctx.check(
    'panel-visible',
    ctx.ext.mainContainer.visible && ctx.ext._visible === true
  );
  await ctx.shot('smoke.png');
  ctx.ext.hide();
  await ctx.wait(1000);
};

SCENARIOS.hidecycle = async ctx => {
  ctx.ext.show();
  await ctx.wait(800);
  ctx.ext.hide();
  await ctx.wait(1000);
  ctx.check('survived-hide', true);
  ctx.ext.show();
  await ctx.wait(800);
  ctx.check('reshown', ctx.ext._visible === true);
  ctx.ext.hide();
  await ctx.wait(1000);
};

// window-created must still hide the panel after a hide/show cycle
// (_remove_events() disconnects every global.display handler on hide).
SCENARIOS.windowcreated = async ctx => {
  ctx.ext.show(); await ctx.wait(800);
  ctx.ext.hide(); await ctx.wait(1000);
  ctx.ext.show(); await ctx.wait(800);
  const p = ctx.ext.mainContainer;
  ctx.check('wc-panel-opaque-before', p.opacity > 0, `op=${p.opacity}`);
  global.display.emit('window-created', global.display.list_all_windows()[0]);
  await ctx.wait(300);
  ctx.check('wc-hidden-after-cycle', p.opacity === 0, `op=${p.opacity} shown=${ctx.ext._visible}`);
  ctx.ext.hide(); await ctx.wait(1000);
};

SCENARIOS.identity = async ctx => {
  const ext = Main.extensionManager.lookup(
    'search-light-glass@antonioestela.github.com'
  );
  ctx.check('uuid-active', ext?.state === 1 /* ACTIVE */, `state=${ext?.state}`);
  ctx.check(
    'schema-id',
    ctx.ext._settings.schema_id === 'org.gnome.shell.extensions.search-light-glass'
  );
};

SCENARIOS.glass = async ctx => {
  ctx.ext._settings.set_boolean('blur-background', true);
  await ctx.wait(300);
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
  const wins = global.display.list_all_windows();
  global.display.emit('window-created', wins[0]); await ctx.wait(300);
  ctx.check('glass-hidden-on-window-created', g && (g.opacity === 0 || !g.visible), `g=${!!g} op=${g?.opacity} vis=${g?.visible} panel=${p.opacity} shown=${ctx.ext._visible}`);
  ctx.ext.hide(); await ctx.wait(1000);
  ctx.check('glass-gone-after-hide', ctx.ext._glass?.actor == null);
};

SCENARIOS.effects = async ctx => {
  ctx.ext._settings.set_boolean('blur-background', true);
  ctx.ext._settings.set_value('window-effect-color', new GLib.Variant('(dddd)', [1, 0.2, 0.2, 0.5]));
  ctx.ext.show(); await ctx.wait(800);
  for (const idx of [1, 2, 3]) {
    let err = null;
    try { ctx.ext._settings.set_int('window-effect', idx); } catch (e) { err = e; }
    await ctx.wait(300);
    ctx.check(`window-effect-${idx}`, !err && !!ctx.ext.windowEffect, `${err}`);
    await ctx.shot(`effect-${idx}.png`);
  }
  ctx.ext._settings.set_int('window-effect', 0);
  await ctx.wait(300);
  ctx.check('window-effect-0', !ctx.ext.windowEffect);
  ctx.ext.hide(); await ctx.wait(500);
};

SCENARIOS.edge = async ctx => {
  for (const scheme of ['light', 'dark']) {
    ctx.setScheme(scheme); await ctx.wait(2200);
    ctx.ext.show(); await ctx.wait(400); ctx.type('settings'); await ctx.wait(1500);
    await ctx.shot(`edge-${scheme}.png`);
    ctx.ext.hide(); await ctx.wait(500);
  }
  ctx.setScheme('light'); await ctx.wait(2200);
  ctx.ext._settings.set_boolean('blur-background', false);
  ctx.ext.show(); await ctx.wait(400); ctx.type('settings'); await ctx.wait(1500);
  ctx.check('shadow-without-blur', !!ctx.ext._shadow?.actor && ctx.ext._glass?.actor == null);
  await ctx.shot('edge-light-noblur.png');
  ctx.ext.hide(); await ctx.wait(500);
  ctx.check('shadow-gone-after-hide', ctx.ext._shadow == null);
  ctx.ext._settings.set_boolean('blur-background', true);
  ctx.ext.show(); await ctx.wait(600);
  ctx.check('shadow-with-blur', !!ctx.ext._shadow?.actor && !!ctx.ext._glass?.actor);
  ctx.ext.hide(); await ctx.wait(500);
  ctx.check('edge-done', true);
};

SCENARIOS.leak = async ctx => {
  const uuid = 'search-light-glass@antonioestela.github.com';
  const count = () => Main.layoutManager.uiGroup.get_children().length;
  ctx.ext._settings.set_boolean('blur-background', true);
  await ctx.wait(300);
  ctx.ext.show(); await ctx.wait(800); ctx.ext.hide(); await ctx.wait(800);
  const before = count();
  Main.extensionManager.disableExtension(uuid); await ctx.wait(500);
  Main.extensionManager.enableExtension(uuid); await ctx.wait(1500);
  ctx.check('no-leak-after-disable', count() === before, `${before} -> ${count()}`);
  Main.overview.searchLight._settings.set_boolean('blur-background', true);
  await ctx.wait(300);
  Main.overview.searchLight.show(); await ctx.wait(800);
  ctx.check('reenable-works', !!Main.overview.searchLight._glass?.actor);
  Main.overview.searchLight.hide(); await ctx.wait(1000);
};

// Disabling the extension while the panel is open (text typed) and while a
// hide animation is running must restore the shell's own widgets.
SCENARIOS['disable-open'] = async ctx => {
  const uuid = 'search-light-glass@antonioestela.github.com';
  const entry = Main.overview.searchEntry;
  const controller = Main.overview.searchController;
  const entryParent = entry.get_parent();
  const controllerParent = controller.get_parent();
  const origToggle = Main.overview.constructor.prototype.toggle;
  const origHide = Main.overview.constructor.prototype.hide;
  const count = () => Main.layoutManager.uiGroup.get_children().length;
  const before = count();
  ctx.ext._settings.set_boolean('blur-background', true);
  await ctx.wait(300);
  for (const phase of ['open', 'hiding']) {
    ctx.ext = Main.overview.searchLight;
    ctx.ext._useAnimations = true;
    ctx.ext.show(); await ctx.wait(600); ctx.type('settings'); await ctx.wait(1000);
    ctx.check(`${phase}: panel-open`, ctx.ext._visible === true);
    if (phase === 'hiding') { ctx.ext.hide(); await ctx.wait(20); }
    Main.extensionManager.disableExtension(uuid); await ctx.wait(800);
    ctx.check(`${phase}: entry-back-in-stock-parent`, entry.get_parent() === entryParent, `${entry.get_parent()}`);
    ctx.check(`${phase}: controller-back-in-stock-parent`, controller.get_parent() === controllerParent);
    ctx.check(`${phase}: searchLight-undefined`, Main.overview.searchLight === undefined);
    ctx.check(`${phase}: overview-methods-restored`,
      Main.overview.toggle === origToggle && Main.overview.hide === origHide);
    ctx.check(`${phase}: panel-actors-removed`, count() === before - 1, `${before} -> ${count()}`);
    let threw = null;
    try { Main.overview.hide(); } catch (e) { threw = e; }
    ctx.check(`${phase}: overview-hide-ok`, !threw, `${threw}`);
    Main.extensionManager.enableExtension(uuid); await ctx.wait(1500);
    const e2 = Main.overview.searchLight;
    ctx.check(`${phase}: reenabled`, !!e2);
    ctx.check(`${phase}: no-leak-after-reenable`, count() === before, `${before} -> ${count()}`);
    e2.show(); await ctx.wait(800);
    ctx.check(`${phase}: show-after-reenable`, e2._visible === true && e2.mainContainer.visible);
    e2.hide(); await ctx.wait(1000);
    ctx.check(`${phase}: hide-after-reenable`, e2._visible === false);
  }
};

SCENARIOS.theme = async ctx => {
  ctx.setScheme('dark'); ctx.ext.show(); await ctx.wait(400); ctx.type('settings'); await ctx.wait(1500);
  ctx.check('dark-class', !ctx.ext.container.has_style_class_name('light'));
  ctx.check('blur-default-on', ctx.ext._settings.get_boolean('blur-background') === true);
  await ctx.shot('theme-dark.png');
  ctx.setScheme('light'); await ctx.wait(800);
  ctx.check('live-theme-switch', ctx.ext.container.has_style_class_name('light'));
  await ctx.wait(2200);
  await ctx.shot('theme-light.png');
  ctx.ext._settings.set_boolean('blur-background', false); await ctx.wait(500);
  ctx.check('no-glass-when-blur-off', ctx.ext._glass?.actor == null);
  await ctx.shot('theme-noblur.png');
  ctx.ext.hide(); await ctx.wait(1000);
};

// A user-set text-color must reach titles, subtitles, section titles.
SCENARIOS.textcolor = async ctx => {
  const lists = () => ctx.ext._searchResults._providers.map(p => p.display)
    .filter(d => d && d._container && d.providerInfo);
  const red = c => c.red === 255 && c.green === 0 && c.blue === 0;
  const fg = a => a.get_theme_node().get_foreground_color();
  const settings = ctx.ext._settings;
  const walk = (a, f) => { f(a); a.get_children?.().forEach(k => walk(k, f)); };
  settings.set_value('text-color', new GLib.Variant('(dddd)', [1, 0, 0, 1]));
  await ctx.wait(300);
  ctx.ext.show(); await ctx.wait(400); ctx.type('settings'); await ctx.wait(1500);
  const row = lists()[0]?._content.get_child_at_index(0);
  const title = row?.label_actor;
  ctx.check('title-red', title && red(fg(title)), title && fg(title).to_string());
  // Every visible label in the results (titles, subtitles, section titles,
  // including those under .list-search-result-title) must be red.
  const notRed = [];
  let nLabels = 0;
  walk(ctx.ext._searchResults, a => {
    if (a instanceof St.Label && a.mapped && a.get_text()) {
      nLabels++;
      if (!red(fg(a))) notRed.push(`${a.get_text()}:${fg(a).to_string()}`);
    }
  });
  ctx.check('all-result-labels-red', nLabels > 0 && notRed.length === 0, `${nLabels} labels; not red: ${notRed.slice(0, 4).join(', ')}`);
  const desc = row?._descriptionLabel;
  ctx.check('subtitle-red', desc && red(fg(desc)), desc && fg(desc).to_string());
  let secTitle = null;
  walk(ctx.ext.container, a => { if (!secTitle && a.has_style_class_name?.('slg-section-title')) secTitle = a; });
  ctx.check('section-title-red', secTitle && red(fg(secTitle)), secTitle && fg(secTitle).to_string());
  await ctx.shot('textcolor.png');
  ctx.ext.hide(); await ctx.wait(800);
  settings.reset('text-color');
  await ctx.wait(300);
};

SCENARIOS['show-interrupts-hide'] = async ctx => {
  ctx.ext.show(); await ctx.wait(800);
  ctx.ext.hide(); await ctx.wait(30);
  ctx.ext.show(); await ctx.wait(1000);
  ctx.check('panel-visible', ctx.ext.mainContainer.visible && ctx.ext._visible === true);
  ctx.check('glass-alive', !!ctx.ext._glass?.actor);
  ctx.ext.hide(); await ctx.wait(1000);
};

SCENARIOS.sections = async ctx => {
  const lists = () => ctx.ext._searchResults._providers.map(p => p.display)
    .filter(d => d && d._container && d.providerInfo);
  ctx.ext.show(); await ctx.wait(400); ctx.type('settings'); await ctx.wait(1500);
  ctx.check('has-list-sections', lists().length > 0);
  ctx.check('sections-vertical', lists().every(d =>
    d._container.orientation === Clutter.Orientation.VERTICAL && d.has_style_class_name('slg-section')));
  const row = lists()[0]?._content.get_child_at_index(0);
  const rowIcon = row?.get_child().get_first_child().get_first_child();
  ctx.check('row-icon-size', rowIcon && rowIcon.icon_size >= 26, rowIcon?.icon_size);
  ctx.check('row-subtitle-stacked', row && row._descriptionLabel &&
    row._descriptionLabel.get_parent() === row.label_actor.get_parent() &&
    row.label_actor.get_parent().orientation === Clutter.Orientation.VERTICAL);
  await ctx.shot('sections.png');
  ctx.ext.hide(); await ctx.wait(800);
  Main.overview.show(); await ctx.wait(1200); ctx.type('settings'); await ctx.wait(1500);
  ctx.check('overview-restored', lists().every(d =>
    d._container.orientation === Clutter.Orientation.HORIZONTAL && !d.has_style_class_name('slg-section')));
  const r2 = lists()[0]?._content.get_child_at_index(0);
  ctx.check('overview-row-restored', r2 && r2.label_actor.get_parent() === r2.get_child().get_first_child() &&
    r2._descriptionLabel.get_parent() === r2.get_child() &&
    r2.get_child().get_first_child().get_first_child().icon_size === 24);
  await ctx.shot('overview.png');
  Main.overview.hide();
};

SCENARIOS.appsreopen = async ctx => {
  const appsProv = () => ctx.ext._searchResults._providers.find(p => !p.appInfo);
  ctx.ext.show(); await ctx.wait(400); ctx.type('text'); await ctx.wait(1500);
  const view = ctx.ext._searchResults;
  // Closing normally clears the entry; to reproduce a reopen with the terms
  // still in place, cycle the restyler directly (what hide()/show() do).
  const res = ctx.ext._restyler;
  const old = appsProv().display;
  res.restore(); res.apply(); await ctx.wait(1000);
  let d = appsProv()?.display;
  ctx.check('reapply-new-display', d !== old && d?.constructor?.name === 'AppRowResults');
  ctx.check('reapply-apps-have-rows', d?._rows.get_n_children() > 0, d?._rows.get_n_children());
  let def = view._defaultResult;
  ctx.check('reapply-default-is-live-row', !!def && def.get_parent() === d?._rows && !!def.get_stage());
  await ctx.shot('apps-reapply.png');
  // real hide/show: text cleared, retyping must work with a fresh display
  ctx.ext.hide(); await ctx.wait(1000);
  ctx.ext.show(); await ctx.wait(400); ctx.type('text'); await ctx.wait(1500);
  d = appsProv()?.display;
  ctx.check('reopen-apps-have-rows', d?.constructor?.name === 'AppRowResults' && d._rows.get_n_children() > 0);
  def = view._defaultResult;
  ctx.check('reopen-default-is-live-row', !!def && def.get_parent() === d?._rows && !!def.get_stage());
  await ctx.shot('apps-reopen.png');
  // a hide within ~150ms of typing must not touch destroyed displays
  ctx.type('tex'); await ctx.wait(30); ctx.ext.hide(); await ctx.wait(1000);
  ctx.check('quick-hide-survives', true);
  ctx.ext.show(); await ctx.wait(400); ctx.type('text'); await ctx.wait(1500);
  ctx.check('activate-default-hides', (() => { view.activateDefault(); return true; })());
  await ctx.wait(1500);
  ctx.check('panel-hidden-after-activate', ctx.ext._visible === false || ctx.ext.mainContainer.opacity === 0,
    `visible=${ctx.ext._visible} opacity=${ctx.ext.mainContainer.opacity}`);
  if (ctx.ext._visible) { ctx.ext.hide(); await ctx.wait(800); }
};

SCENARIOS.apps = async ctx => {
  const appsProv = () => ctx.ext._searchResults._providers.find(p => !p.appInfo);
  ctx.ext.show(); await ctx.wait(400);
  const view = ctx.ext._searchResults; ctx.type('text'); await ctx.wait(1500);
  const d = appsProv()?.display;
  ctx.check('apps-are-rows', d?.constructor?.name === 'AppRowResults' && d._rows.get_n_children() > 0);
  ctx.check('apps-row-has-title', d && d._rows.get_child_at_index(0)?.has_style_class_name('list-search-result'));
  ctx.check('apps-first-result', !!view._defaultResult);
  const row = d?._rows.get_child_at_index(0);
  const icon = row?.get_child().get_first_child().get_first_child();
  ctx.check('apps-row-icon-28', icon && icon.icon_size === 28, icon?.icon_size);
  ctx.check('apps-row-description', row && row._descriptionLabel && row._descriptionLabel.text !== '');
  ctx.check('apps-in-view-order', view._content.get_children().indexOf(d) === view._providers.indexOf(appsProv()));
  ctx.check('apps-default-is-app-row', d && view._defaultResult?.get_parent() === d._rows);
  await ctx.shot('apps.png');
  // keyboard: Down from the default result, then onward from the focused actor, must reach list rows
  // (the header buttons of other sections are focusable too, so just walk).
  const seen = [];
  for (let i = 0; i < 8; i++) {
    if (i === 0) view.navigateFocus(St.DirectionType.DOWN);
    else view.navigate_focus(global.stage.key_focus, St.DirectionType.DOWN, false);
    await ctx.wait(150);
    const f = global.stage.key_focus;
    seen.push(f?.has_style_class_name?.('list-search-result') ? 'row' : (f?.constructor?.name ?? 'none'));
  }
  ctx.check('nav-down-reaches-rows', seen.includes('row'), seen.join(','));
  view.navigateFocus(St.DirectionType.UP); await ctx.wait(150);
  ctx.check('nav-up-moves-focus', !!global.stage.key_focus && global.stage.key_focus !== ctx.ext._entry, global.stage.key_focus?.constructor?.name);
  ctx.check('drag-check-safe', (() => { try { ctx.ext._isDraggingIcon(); return true; } catch { return false; } })());
  ctx.ext.hide(); await ctx.wait(800);
  Main.overview.show(); await ctx.wait(1200); ctx.type('text'); await ctx.wait(1500);
  ctx.check('overview-apps-grid', appsProv()?.display?.constructor?.name === 'GridSearchResults');
  ctx.check('overview-grid-visible', appsProv()?.display?.visible);
  await ctx.shot('apps-overview.png');
  Main.overview.hide();
};

// README screenshots (not part of `all`): light/dark, settings query.
SCENARIOS.shots = async ctx => {
  for (const scheme of ['dark', 'light']) {
    ctx.setScheme(scheme); await ctx.wait(2200);
    for (const [q, tag] of [['settings', 'settings']]) {
      ctx.ext.show(); await ctx.wait(500); ctx.type(q); await ctx.wait(1800);
      await ctx.shot(`shot-${scheme}-${tag}.png`);
      ctx.check(`shot-${scheme}-${tag}`, true);
      ctx.ext.hide(); await ctx.wait(800);
    }
  }
};

// Runs every scenario in sequence. Each one gets the live extension instance
// (the leak scenario replaces it, so it runs last), a clean settings state and
// a fresh show()/hide() cycle.
SCENARIOS.all = async ctx => {
  const names = Object.keys(SCENARIOS).filter(n => !['all', 'none', 'leak', 'shots', 'disable-open'].includes(n));
  const only = GLib.getenv('PROBE_ONLY');
  if (only) names.splice(0, names.length, ...only.split(','));
  else names.push('disable-open', 'leak');
  const baseline = {};
  const settings = () => Main.overview.searchLight._settings;
  for (const key of ['blur-background']) baseline[key] = settings().get_boolean(key);
  const checks = ctx.checks;
  for (const name of names) {
    ctx.ext = Main.overview.searchLight;
    ctx.setScheme('light');
    ctx.ext._settings.set_boolean('blur-background', baseline['blur-background']);
    ctx.ext._settings.set_int('window-effect', 0);
    ctx.ext.show(); await ctx.wait(600);
    ctx.ext.hide(); await ctx.wait(800);
    ctx.ext = Main.overview.searchLight;
    const before = checks.length;
    try {
      await SCENARIOS[name](ctx);
    } catch (e) {
      ctx.check('scenario-error', false, `${e}`);
    }
    for (let i = before; i < checks.length; i++) checks[i].name = `${name}/${checks[i].name}`;
    Main.overview.hide();
    await ctx.wait(500);
  }
};

// ---- end scenarios ----

export default class ProbeExtension extends Extension {
  enable() {
    const name = GLib.getenv('PROBE_SCENARIO') || 'smoke';
    if (name === 'none' || scenarioStarted) return;
    scenarioStarted = true;
    this._outDir = GLib.getenv('PROBE_OUT') || GLib.get_tmp_dir();
    this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
      this._timeout = 0;
      this._run(name);
      return GLib.SOURCE_REMOVE;
    });
  }

  disable() {
    if (this._timeout) GLib.source_remove(this._timeout);
    this._timeout = 0;
  }

  async _run(name) {
    const outDir = this._outDir;
    const checks = [];
    const wait = ms =>
      new Promise(resolve =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
          resolve();
          return GLib.SOURCE_REMOVE;
        })
      );
    const ctx = {
      checks,
      ext: Main.overview.searchLight,
      check(n, cond, detail = '') {
        checks.push({name: n, ok: !!cond, detail: String(detail)});
      },
      wait,
      async shot(file) {
        const f = Gio.File.new_for_path(`${outDir}/${file}`);
        const stream = f.replace(null, false, Gio.FileCreateFlags.NONE, null);
        try {
          await new Shell.Screenshot().screenshot(false, stream);
        } finally {
          stream.close(null);
        }
      },
      setScheme(scheme) {
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_string(
          'color-scheme',
          scheme === 'dark' ? 'prefer-dark' : 'default'
        );
      },
      type(text) {
        Main.overview.searchEntry.set_text(text);
      },
    };

    try {
      const fn = SCENARIOS[name];
      if (!fn) throw new Error(`unknown scenario '${name}'`);
      await fn(ctx);
    } catch (e) {
      checks.push({
        name: 'scenario-error',
        ok: false,
        detail: `${e}${e && e.stack ? `\n${e.stack}` : ''}`,
      });
    }

    const report = {
      scenario: name,
      ok: checks.length > 0 && checks.every(c => c.ok),
      checks,
    };
    // Write to a temp name then rename so the runner never reads a partial file.
    const tmp = Gio.File.new_for_path(`${outDir}/report.json.tmp`);
    tmp.replace_contents(
      new TextEncoder().encode(JSON.stringify(report, null, 2)),
      null,
      false,
      Gio.FileCreateFlags.NONE,
      null
    );
    tmp.move(
      Gio.File.new_for_path(`${outDir}/report.json`),
      Gio.FileCopyFlags.OVERWRITE,
      null,
      null
    );
    console.log('[probe] done');
  }
}
