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
  // NOTE: ext.hide() is deliberately not called here: on GNOME Shell 50.1 the
  // upstream hide() path aborts the nested shell (Clutter unrealize assertion
  // while reparenting the search controller). Revisit once the fork reworks it.
};

// ---- end scenarios ----

export default class ProbeExtension extends Extension {
  enable() {
    const name = GLib.getenv('PROBE_SCENARIO') || 'smoke';
    if (name === 'none') return;
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
