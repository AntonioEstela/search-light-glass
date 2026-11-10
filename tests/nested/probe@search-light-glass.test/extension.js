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
  global.display.emit('window-created', global.display.list_all_windows()[0]); await ctx.wait(300);
  ctx.check('glass-hidden-on-window-created', g && (g.opacity === 0 || !g.visible));
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
