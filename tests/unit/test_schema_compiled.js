// Fails if the tracked schemas/gschemas.compiled is stale relative to the
// gschema XML. Run with `gjs -m tests/unit/test_schema_compiled.js`.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const dir = GLib.path_get_dirname(
  GLib.filename_from_uri(import.meta.url)[0],
);
const root = GLib.build_filenamev([dir, '..', '..']);
const schemas = GLib.build_filenamev([root, 'schemas']);
const tmp = GLib.dir_make_tmp('slg-schema-XXXXXX');

const proc = Gio.Subprocess.new(
  ['glib-compile-schemas', '--strict', `--targetdir=${tmp}`, schemas],
  Gio.SubprocessFlags.STDERR_MERGE | Gio.SubprocessFlags.STDOUT_PIPE,
);
const [, out] = proc.communicate_utf8(null, null);
if (!proc.get_successful()) {
  console.error(`FAIL: glib-compile-schemas failed:\n${out}`);
  System.exit(1);
}

const read = p => GLib.file_get_contents(p)[1];
const fresh = read(GLib.build_filenamev([tmp, 'gschemas.compiled']));
const tracked = read(GLib.build_filenamev([schemas, 'gschemas.compiled']));
GLib.unlink(GLib.build_filenamev([tmp, 'gschemas.compiled']));
GLib.rmdir(tmp);

const same =
  fresh.length === tracked.length && fresh.every((b, i) => b === tracked[i]);
if (!same) {
  console.error(
    'FAIL: schemas/gschemas.compiled is stale. Run: ' +
      'glib-compile-schemas --strict --targetdir=schemas/ schemas',
  );
  System.exit(1);
}
console.log('PASS: schemas/gschemas.compiled matches the gschema XML');
