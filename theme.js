// Light/dark glass palette resolver. Pure JS: no gi:// imports, so it can run
// under plain `gjs -m` in unit tests.

export const PALETTES = {
  dark: {
    tint: [0.110, 0.129, 0.204, 0.55],
    border: [1, 1, 1, 0.18],
    text: [1, 1, 1, 1],
  },
  light: {
    tint: [1, 1, 1, 0.72],
    border: [1, 1, 1, 0.60],
    text: [0.114, 0.114, 0.122, 1],
  },
};

export function schemeFromColorScheme(value) {
  return value === 'prefer-dark' ? 'dark' : 'light';
}

// Same luminance formula upstream uses in _updateCss.
function isLightColor(c) {
  return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] >= 0.5;
}

export function resolvePalette({scheme, overrides}) {
  const base = PALETTES[scheme] ?? PALETTES.light;
  const tint = overrides.background_color ?? base.tint;
  const border = overrides.border_color ?? base.border;
  const isLight = isLightColor(tint);
  const text =
    overrides.text_color ?? (isLight ? PALETTES.light.text : PALETTES.dark.text);
  const entryText = overrides.entry_text_color ?? text;
  return {tint, border, text, entryText, isLight};
}
