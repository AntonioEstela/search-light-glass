import {PALETTES, schemeFromColorScheme, resolvePalette} from '../../theme.js';

function assertEq(actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`assertEq failed: got ${a}, expected ${e}`);
}

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
