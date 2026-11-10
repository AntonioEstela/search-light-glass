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
