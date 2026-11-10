/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Graphene from 'gi://Graphene';

import { Timer } from './timer.js';
import { Style } from './style.js';

import { GlassLayer, PanelShadow } from './glass.js';
import { resolvePalette, schemeFromColorScheme } from './theme.js';
import { TintEffect } from './effects/tint_effect.js';
import { MonochromeEffect } from './effects/monochrome_effect.js';
import { BlurEffect } from './effects/blur_effect.js';

import { schemaId, SettingsKeys } from './preferences/keys.js';
import { KeyboardShortcuts } from './keybinding.js';
import { ResultsRestyler } from './results.js';

import {
  Extension,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';

// Corner radius choices (px); the border-radius setting is an index into this.
const BORDER_RADII = [0, 16, 18, 20, 22, 24, 28, 32];
const DEFAULT_RADIUS = 28;

var SearchLight = GObject.registerClass(
  {},
  class SearchLight extends St.Widget {
    _init() {
      super._init();
      this.name = 'searchLight';
      this.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
      this.layout_manager = new Clutter.BinLayout();
    }
  },
);

export default class SearchLightExt extends Extension {
  enable() {
    Main.overview.graphene = Graphene;
    
    this._style = new Style();

    this._hiTimer = new Timer('hi-res timer');
    this._hiTimer.initialize(15);

    // for deferred or debounced runs
    this._loTimer = new Timer('lo-res timer');
    this._loTimer.initialize(750);

    this._settings = this.getSettings(schemaId);
    this._settingsKeys = SettingsKeys();

    this._settingsKeys.connectSettings(this._settings, (name, value) => {
      let n = name.replace(/-/g, '_');
      this[n] = value;
      switch (name) {
        case 'show-panel-icon':
          if (this._indicator) {
            this._indicator.visible = value;
          }
          break;
        case 'blur-background':
          this._updateGlassPresence();
          this._updateCss();
          break;
        case 'blur-sigma':
        case 'blur-brightness':
          this._updateGlassStyle();
          break;
        case 'background-color':
        case 'border-color':
        case 'border-thickness':
        case 'text-color':
        case 'entry-text-color':
        case 'panel-icon-color':
          this._updateCss();
          break;
        case 'use-animations':
          this._useAnimations = value;
          break;
        case 'animation-speed':
          this._animationSpeed = value;
          break;
        case 'border-radius':
          this._updateCss();
          break;
        case 'shortcut-search':
          this._updateShortcut();
          break;
        case 'secondary-shortcut-search':
          this._updateShortcut2();
          break;
        case 'window-effect': {
          this._updateWindowEffect();
          break;
        }
        case 'window-effect-color': {
          if (this.windowEffect) {
            this.windowEffect.color = this.window_effect_color;
          }
          break;
        }
      }
    });
    Object.keys(this._settingsKeys._keys).forEach((k) => {
      let key = this._settingsKeys.getKey(k);
      let name = k.replace(/-/g, '_');
      this[name] = key.value;
      if (key.options) {
        this[`${name}_options`] = key.options;
      }
      // console.log(`${name} ${key.value}`);
    });

    this._interfaceSettings = new Gio.Settings({
      schema_id: 'org.gnome.desktop.interface',
    });
    this._interfaceSettings.connectObject(
      'changed::color-scheme',
      () => {
        this._updateCss();
        // The wallpaper cross-fades to its other variant; re-clone it once
        // it has settled.
        this._loTimer?.runOnce(() => this._glass?.rebuildScene(), 1500);
      },
      this,
    );

    this.mainContainer = new SearchLight();
    this.mainContainer._delegate = this;
    this.container = new St.BoxLayout({
      name: 'searchLightBox',
      orientation: Clutter.Orientation.VERTICAL,
      reactive: true,
      track_hover: true,
      can_focus: true,
    });

    this.hide();
    this.container._delegate = this;

    Main.layoutManager.addChrome(this.mainContainer, {
      affectsStruts: false,
      trackFullscreen: false,
    });

    this.mainContainer.add_child(this.container);

    this._setupBackground();

    this.accel = new KeyboardShortcuts();
    this.accel.enable();
    this.accel2 = new KeyboardShortcuts();
    this.accel2.enable();

    this._updateShortcut();
    this._updateShortcut2();
    this._updateCss();

    this._useAnimations = this._settings.get_boolean('use-animations');
    this._animationSpeed = this._settings.get_double('animation-speed');

    Main.overview.connectObject(
      'overview-showing',
      this._onOverviewShowing.bind(this),
      'overview-hidden',
      this._onOverviewHidden.bind(this),
      this,
    );

    Shell.AppSystem.get_default().connectObject(
      'app-state-changed',
      this._onAppStateChanged.bind(this),
      this,
    );

    global.display.connectObject(
      'window-created',
      (display, win) => {
        if (this._visible) {
          this.mainContainer.opacity = 0;
        }
      },
      this,
    );

    this._loTimer.runOnce(() => {
      // this.show();
    }, 500);

    Main.overview.searchLight = this;

    let appInfo = Gio.DesktopAppInfo.new_from_filename(
      `${this.path}/apps/org.gnome.Calculator.desktop`,
    );

    let _providers = [];

    // deferred startup for providers
    let idx = 0;
    _providers.forEach((p) => {
      this._loTimer.runOnce(() => {
        p.initialize();
      }, idx * 5000);
    });

    this._loTimer.runOnce(() => {
      this._createIndicator();
    }, 1500);
    this._updateProviders();
    this._updateWindowEffect();
  }

  disable() {
    this._hiTimer?.shutdown();
    this._loTimer?.shutdown();
    this._hiTimer = null;
    this._loTimer = null;

    if (this._indicator) {
      this._indicator.disconnectObject(this);
      if (this._indicator.get_parent()) {
        this._indicator.get_parent().remove_child(this._indicator);
      }
      this._indicator = null;
    }

    this._style.unloadAll();
    this._style = null;

    this._settingsKeys.disconnectSettings();
    this._settings = null;

    this._interfaceSettings?.disconnectObject(this);
    this._interfaceSettings = null;

    this._destroyGlass();
    this._destroyShadow();

    if (this.accel) {
      this.accel.disable();
      delete this.accel;
      this.accel = null;
    }
    if (this.accel2) {
      this.accel2.disable();
      delete this.accel2;
      this.accel2 = null;
    }

    this._removeProviders();
    this._providers = null;

    if (this._background) {
      if (this._background.get_parent()) {
        this._background.get_parent().remove_child(this._background);
      }
      this._background = null;
    }

    Main.layoutManager.removeChrome(this.mainContainer);
    this.mainContainer = null;
  }

  _createIndicator() {
    if (this._indicator) return;
    this._indicator = new St.Button({
      style_class: 'panel-status-indicators-box',
    });
    let icon = new St.Icon({
      style_class: 'panel-status-indicator-icon',
      gicon: new Gio.ThemedIcon({ name: 'search-symbolic' }),
    });
    icon.style = 'margin-top: 6px !important; margin-bottom: 6px !important;';
    this._indicator.set_child(icon);
    this._indicator.connectObject(
      'button-press-event',
      this._toggle_search_light.bind(this),
      this,
    );
    try {
      Main.panel._rightBox.insert_child_at_index(this._indicator, 0);
      this._indicator.visible = this.show_panel_icon;
    } catch (err) {
      console.log(err);
    }
  }

  _createEffect(idx) {
    let effect = null;
    switch (idx) {
      case 1: {
        effect = new TintEffect({
          name: 'color',
          color: this.window_effect_color,
        });
        effect.preload(this.path);
        break;
      }
      case 2: {
        effect = new MonochromeEffect({
          name: 'color',
          color: this.window_effect_color,
        });
        effect.preload(this.path);
        break;
      }
      case 3: {
        effect = new BlurEffect({
          name: 'color',
          color: this.window_effect_color,
        });
        effect.preload(this.path);
        break;
      }
    }
    return effect;
  }

  _updateWindowEffect() {
    // this.window_effect = 2;
    // this.window_effect_color = [1, 0, 0, 0.5];
    this.container.remove_effect_by_name('window-effect');
    let effect = this._createEffect(this.window_effect);
    if (effect) {
      this.container.add_effect_with_name('window-effect', effect);
    }
    this.windowEffect = effect;
  }

  _updatePanelIcon(disable) {}

  _updateProviders() {
    this._removeProviders();
    this._providers = [];

    let _search = Main.overview.searchController;
    if (!_search) return;

    // add providers here

    if (_search.addProvider) {
      this._providers.forEach((p) => {
        _search.addProvider(p);
      });
    }
  }

  _removeProviders() {
    if (!this._providers) {
      return;
    }

    let _search = Main.overview.searchController;
    if (!_search) return;

    if (_search.removeProvider) {
      this._providers.forEach((p) => {
        _search.removeProvider(p);
      });
    }

    this._providers = null;
  }

  _setupBackground() {
    if (this._background && this._background.get_parent()) {
      this._background.get_parent().remove_child(this._background);
    }

    // Tint/border actor (CSS only). The blur lives in the glass layer.
    let background = new St.Widget({
      name: 'searchLightBlurredBackground',
      layout_manager: new Clutter.BinLayout(),
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });

    this.mainContainer.insert_child_below(background, this.container);
    this._background = background;
    this._background.opacity = 0;
    this._background.visible = false;
  }

  show() {
    if (Main.overview.visible) return;

    if (this._animSeq) {
      this._hiTimer.cancel(this._animSeq);
      this._animSeq = null;
    }
    // Invalidate a hide() animation that is still running.
    this._visSeq = (this._visSeq || 0) + 1;
    this.mainContainer.remove_all_transitions();
    this._acquire_ui();

    this._updateCss();
    this._layout();

    this._destroyGlass();
    this._destroyShadow();
    this._updateGlassPresence();

    global.compositor.disable_unredirect();

    this.mainContainer.show();
    this.container.show();
    this._add_events();

    // fixes the background size relative to text - after adjusting font size
    this._animSeq = this._hiTimer.runOnce(() => {
      this._animSeq = null;
      this._layout();
      // animate after adjust so width+height are correct
      if (this._useAnimations) {
        this.mainContainer.opacity = 0;
        this.mainContainer.scale_x = 0.9;
        this.mainContainer.scale_y = 0.9;
        this.mainContainer.translation_x = (this.width * 0.1) / 2;
        this.mainContainer.translation_y = (this.height * 0.1) / 2;
        this.mainContainer.ease({
          opacity: 255,
          scale_x: 1.0,
          scale_y: 1.0,
          translation_x: 0,
          translation_y: 0,
          duration: this._animationSpeed,
          mode: Clutter.AnimationMode.EASE_OUT,
        });
      } else {
        this.mainContainer.scale_x = 1.0;
        this.mainContainer.scale_y = 1.0;
        this.mainContainer.opacity = 255;
      }
    }, 100);
  }

  hide() {
    if (this._isDraggingIcon()) {
      return;
    }

    // Stop listening for key-focus changes first: taking the entry out of the
    // panel drops the stage key focus, which would re-enter hide() while
    // _release_ui() is still reparenting actors.
    this._remove_events();
    this._release_ui();

    const seq = (this._visSeq = (this._visSeq || 0) + 1);
    if (this._useAnimations) {
      this.mainContainer.ease({
        opacity: 0,
        scale_x: 0.9,
        scale_y: 0.9,
        translation_x: (this.width * 0.1) / 2,
        translation_y: (this.height * 0.1) / 2,
        duration: this._animationSpeed,
        mode: Clutter.AnimationMode.EASE_OUT,
        onComplete: () => {
          // show() ran in the meantime: this hide is stale.
          if (seq !== this._visSeq) return;
          this._visible = false;
          this.mainContainer.hide();
          this._destroyGlass();
          this._destroyShadow();
          global.compositor.enable_unredirect();
        },
      });
    } else {
      this.mainContainer.opacity = 0;
      this._visible = false;
      this.mainContainer.hide();
      this._destroyGlass();
      this._destroyShadow();
      global.compositor.enable_unredirect();
    }
    // this._hidePopups();
  }

  // The glass layer exists only while the panel is shown and blur is enabled.
  _updateGlassPresence() {
    // The drop shadow does not depend on blur.
    if (this._visible) {
      if (!this._shadow) {
        this._shadow = new PanelShadow();
        this._shadow.attach(this.mainContainer);
        this._updateGlassStyle();
      }
    } else {
      this._destroyShadow();
    }
    if (this._visible && this.blur_background) {
      if (!this._glass) {
        this._glass = new GlassLayer();
        this._glass.attach(this.mainContainer);
        this._updateGlassStyle();
        this._glass.rebuildScene();
      }
    } else {
      this._destroyGlass();
    }
  }

  _destroyShadow() {
    if (this._shadow) {
      this._shadow.detach();
      this._shadow = null;
    }
  }

  _destroyGlass() {
    if (this._glass) {
      this._glass.detach();
      this._glass = null;
    }
  }

  _glassRadius() {
    return BORDER_RADII[Math.floor(this.border_radius)] ?? DEFAULT_RADIUS;
  }

  _palette() {
    let overrides = {};
    for (let key of [
      'background_color',
      'border_color',
      'text_color',
      'entry_text_color',
    ]) {
      let name = key.replace(/_/g, '-');
      let user = this._settings?.get_user_value(name) ?? null;
      overrides[key] = user !== null ? this[key] : null;
    }
    let scheme = schemeFromColorScheme(
      this._interfaceSettings?.get_string('color-scheme'),
    );
    return resolvePalette({ scheme, overrides });
  }

  _updateGlassStyle() {
    this._shadow?.setStyle({
      radius: this._glassRadius(),
      isLight: this._palette().isLight,
    });
    if (!this._glass) return;
    this._glass.setStyle({
      radius: this._glassRadius(),
      tint: this._palette().tint,
      blurRadius: this.blur_sigma,
      brightness: this.blur_brightness,
    });
  }

  _isDraggingIcon() {
    // True while an icon of the stock overview's grid is being dragged.
    // The apps provider shows rows in Search Light, which are not
    // draggable, so there is nothing to find there.
    let result = false;
    try {
      const grid = this._searchResults?._content?.first_child?.first_child
        ?.child?.child;
      if (grid?.style_class === 'grid-search-results') {
        grid.get_children().forEach((c) => {
          if (c._draggable && c._draggable._dragState == 1 /* DRAGGING */) {
            result = true;
          }
        });
      }
    } catch (err) {
      console.log(err);
    }
    return result;
  }

  _layout() {
    this._queryDisplay();
    if (!this.monitor) return;

    // container size
    this.width =
      600 + ((this.sw * this.scaleFactor) / 2) * (this.scale_width || 0);
    this.height =
      400 + ((this.sh * this.scaleFactor) / 2) * (this.scale_height || 0);

    // initial height
    let font_size = 14;
    if (this.font_size) {
      font_size = this.font_size_options[this.font_size];
    }
    if (this.entry_font_size) {
      font_size = this.entry_font_size_options[this.entry_font_size];
    }

    // let padding = {
    //   14: 14 * 2.5,
    //   16: 16 * 2.4,
    //   18: 18 * 2.2,
    //   20: 20 * 2.0,
    //   22: 22 * 1.8,
    //   24: 24 * 1.6,
    // };
    // this.initial_height = padding[font_size] * this.scaleFactor;
    // this.initial_height += font_size * 2 * this.scaleFactor;
    // console.log(`${this.initial_height} ${this._entry.height}`);

    this.initial_height = this._entry.height + 4 * this.scaleFactor;

    // position
    let x = this.monitor.x + this.sw / 2 - this.width / 2;
    let y = this.monitor.y + this.sh / 2 - this.height / 2;
    this._visible = true;

    this.container.set_size(this.width, this.initial_height);
    this.mainContainer.set_size(this.width, this.initial_height);
    this.mainContainer.set_position(x, y);

    // background
    if (this._background) {
      this._background.set_position(0, 0);
      this._background.set_size(this.width, this.initial_height);
    }
  }

  _updateShortcut(disable) {
    this.accel.unlisten();

    let shortcut = '';
    try {
      shortcut = (this.shortcut_search || []).join('');
    } catch (err) {
      //
    }
    if (shortcut == '') {
      shortcut = '<Control><Super>Space';
    }

    if (!disable) {
      this.accel.listenFor(shortcut, this._toggle_search_light.bind(this));
    }
  }

  _updateShortcut2(disable) {
    this.accel2.unlisten();

    let shortcut = '';
    try {
      shortcut = (this.secondary_shortcut_search || []).join('');
    } catch (err) {
      //
    }
    if (shortcut == '') {
      shortcut = '<Control><Super>Space';
    }

    if (!disable) {
      this.accel2.listenFor(shortcut, this._toggle_search_light.bind(this));
    }
  }

  _queryDisplay() {
    let idx = this.preferred_monitor || 0;
    if (idx == 0) {
      idx = Main.layoutManager.primaryIndex;
    } else if (idx == Main.layoutManager.primaryIndex) {
      idx = 0;
    }
    this.monitor =
      Main.layoutManager.monitors[idx] || Main.layoutManager.primaryMonitor;

    if (this.popup_at_cursor_monitor) {
      let pointer = global.get_pointer();
      Main.layoutManager.monitors.forEach((m) => {
        if (
          pointer[0] >= m.x &&
          pointer[0] <= m.x + m.width &&
          pointer[1] >= m.y &&
          pointer[1] <= m.y + m.height
        ) {
          this.monitor = m;
        }
      });
    }

    this.sw = this.monitor.width;
    this.sh = this.monitor.height;

    if (this._last_monitor_count != Main.layoutManager.monitors.length) {
      this._settings.set_int(
        'monitor-count',
        Main.layoutManager.monitors.length,
      );
      this._last_monitor_count = Main.layoutManager.monitors.length;
    }
  }

  _acquire_ui() {
    if (this._entry) return;

    if (!Main.overview._toggle) {
      Main.overview._toggle = Main.overview.toggle;
    }
    Main.overview.toggle = () => {
      if (this._search && this._search.visible) {
        this._search._text.get_parent().grab_key_focus();
      }
    };
    if (!Main.overview._hide) {
      Main.overview._hide = Main.overview.hide;
    }
    Main.overview.hide = () => {
      this.mainContainer.opacity = 0;
      Main.overview._hide();
    };

    this._queryDisplay();

    this.scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

    this._entry = Main.overview.searchEntry;
    this._entryParent = this._entry.get_parent();
    this._entry.add_style_class_name('slc');

    this._search = Main.overview.searchController;

    this._search.hide();
    this._search.add_style_class_name('slc-results');
    this._searchResults = this._search._searchResults;
    this._searchParent = this._search.get_parent();
    this._restyler = new ResultsRestyler(this._searchResults);
    this._restyler.apply();

    if (!this._searchResults._activateDefault) {
      this._searchResults._activateDefault =
        this._searchResults.activateDefault;
    }
    this._searchResults.activateDefault = () => {
      // hide window immediately when activated
      this.mainContainer.opacity = 0;
      this._searchResults._activateDefault();
    };

    if (this._entry.get_parent()) {
      this._entry.get_parent().remove_child(this._entry);
    }
    this.container.add_child(this._entry);
    if (this._search.get_parent()) {
      this._search.get_parent().remove_child(this._search);
    }
    this.container.add_child(this._search);
    if (!this._search.__searchCancelled) {
      this._search.__searchCancelled = this._search._searchCancelled;
      this._search._searchCancelled = () => {};
    }
    this._search._text.get_parent().grab_key_focus();
    this._textChangedEventId = this._search._text.connect(
      'text-changed',
      () => {
        this.container.set_size(this.width, this.height);
        this.mainContainer.set_size(this.width, this.height);
        this._background?.set_size(this.width, this.height);
        if (this._corners) {
          this._corners[2].y = this.height - this._corners[1].height;
          this._corners[3].y = this.height - this._corners[1].height;
          this._edges[3].y = this.height - 2;
        }
        this._search.show();
      },
    );

    this._search._text.get_parent().grab_key_focus();
  }

  _release_ui() {
    if (this._entry) {
      if (this._entry.get_parent()) {
        this._entry.get_parent().remove_child(this._entry);
      }
      this._entryParent.add_child(this._entry);
      this._entry = null;
    }

    this._restyler?.restore();
    this._restyler = null;

    if (this._search) {
      this._removeProviders();
      this._search.hide();
      this._search.remove_style_class_name('slc-results');
      if (this._search.get_parent()) {
        this._search.get_parent().remove_child(this._search);
      }
      this._searchParent.add_child(this._search);
      if (this._textChangedEventId) {
        this._search._text.disconnect(this._textChangedEventId);
        this._textChangedEventId = null;
      }
      if (this._search.__searchCancelled) {
        this._search._searchCancelled = this._search.__searchCancelled;
        this._search.__searchCancelled = null;
      }
      this._search = null;

      if (this._searchResults._activateDefault) {
        this._searchResults.activateDefault =
          this._searchResults._activateDefault;
        this._searchResults._activateDefault = null;
      }
    }

    if (Main.overview._toggle) {
      Main.overview.toggle = Main.overview._toggle;
      Main.overview._toggle = null;
    }
    if (Main.overview._hide) {
      Main.overview.hide = Main.overview._hide;
      Main.overview._hide = null;
    }
  }

  _updateCss(disable) {
    const palette = this._palette();
    if (palette.isLight) {
      this.container.add_style_class_name('light');
    } else {
      this.container.remove_style_class_name('light');
    }

    this._background.visible = true;
    this._background.opacity = 200;

    let styles = [];
    {
      let ss = [];

      // With blur on, the glass layer paints the tint.
      if (!this.blur_background) {
        let clr = this._style.rgba(palette.tint);
        ss.push(`\n  background: rgba(${clr});`);
      }

      if (this.border_thickness) {
        let clr = this._style.rgba(palette.border);
        ss.push(`\n  border: ${this.border_thickness}px solid rgba(${clr});`);
      }

      styles.push(`#searchLight {${ss.join(' ')}}`);
      styles.push(`#searchLightBlurredBackground {${ss.join(' ')}}`);
    }

    this._background.style = '';
    this._updateGlassStyle();

    {
      if (this.border_radius !== null) {
        let r = this._glassRadius();
        if (r) {
          let st = `StBoxLayout.search-section-content { border-radius: ${r}px !important; }`;
          st = '#searchLightBlurredBackgroundImage,\n' + st; // has no effect
          st = '#searchLightBlurredBackground,\n' + st; // has no effect
          st = '#searchLightBox,\n' + st;
          st = '#searchLight,\n' + st;
          styles.push(st);
        }
      }
    }

    if (this.font_size !== null) {
      let f = this.font_size_options[this.font_size];
      if (f) {
        styles.push(`#searchLightBox * { font-size: ${f}pt !important; }`);
      }
      f = this.entry_font_size_options[this.entry_font_size];
      if (f) {
        styles.push(
          `#searchLightBox > StEntry, #searchLightBox > StEntry:focus { font-size: ${f}pt !important; }`,
        );
      }
    }

    styles.push(
      `#searchLightBox * { color: rgba(${this._style.rgba(palette.text)}) !important }`,
    );
    styles.push(
      `#searchLightBox > StEntry, #searchLightBox > StEntry:focus { color: rgba(${this._style.rgba(palette.entryText)}) !important }`,
    );

    // icon color
    {
      let ss = [];
      {
        let clr = this._style.rgba(this.panel_icon_color);
        if (this.panel_icon_color[3] > 0) {
          ss.push(`\n  color: rgba(${clr}) !important;`);
        }
      }
      styles.push(`.panel-status-indicator-icon {${ss.join(' ')}}`);
    }

    // console.log(styles);
    this._style.build('custom-search-light-glass', styles);
  }

  _toggle_search_light() {
    if (this._inOverview) return;
    if (!this._visible) {
      this.show();
      if (this._entry) {
        global.stage.set_key_focus(this._entry);
      }
    } else {
      global.stage.set_key_focus(null);
    }
  }

  _add_events() {
    global.stage.connectObject(
      'notify::key-focus',
      this._onKeyFocusChanged.bind(this),
      'key-press-event',
      this._onKeyPressed.bind(this),
      this,
    );

    global.display.connectObject(
      'notify::focus-window',
      this._onFocusWindow.bind(this),
      'in-fullscreen-changed',
      this._onFullScreen.bind(this),
      this,
    );
  }

  _remove_events() {
    global.display.disconnectObject(this);
    global.stage.disconnectObject(this);
    Main.overview.disconnectObject(this);
    Shell.AppSystem.get_default().disconnectObject(this);
  }

  _onOverviewShowing() {
    this._inOverview = true;
  }

  _onOverviewHidden() {
    this._inOverview = false;
  }

  _onAppStateChanged(st) {
    this._lastAppState = st;
    if (this._visible) {
      this.mainContainer.opacity = 0;
    }
  }

  _hidePopups() {
    let popup = this._lastPopup;
    this._lastPopup = null;
    try {
      if (!popup.close && popup._getTopMenu()) {
        popup = popup._getTopMenu();
      }

      // elaborate way of hiding the popup
      popup.opacity = 0;
      this._startupSeq = this._hiTimer.runSequence([
        {
          func: () => {
            popup.opacity = 0;
          },
          delay: 0,
        },
        {
          func: () => {
            popup._delegate.close(false);
          },
          delay: 250,
        },
      ]);
    } catch (err) {
      console.log(err);
    }
  }

  _onFocusWindow(w, e) {}

  _onKeyFocusChanged(previous) {
    if (!this._entry) return;
    let focus = global.stage.get_key_focus();
    let appearFocused =
      focus && (this._entry.contains(focus) || this._searchResults.contains(focus));

    if (!appearFocused) {
      // popups are not handled well.. hide immediately
      if (
        focus &&
        focus.style_class &&
        focus.style_class.includes('popup-menu')
      ) {
        this._lastPopup = focus;
        this._hidePopups();
      }

      this.hide();
    }

    // hide window immediately when activated
    if (focus && focus.activate) {
      if (!focus._activate) {
        focus._activate = focus.activate;
        focus.activate = () => {
          this.mainContainer.opacity = 0;
          focus._activate();
        };
      }
    }
  }

  _onKeyPressed(obj, evt) {
    if (!this._entry) return;
    let focus = global.stage.get_key_focus();
    if (!focus || !this._entry.contains(focus)) {
      if (evt.get_key_symbol() === Clutter.KEY_Escape) {
        this.hide();
        return Clutter.EVENT_STOP;
      }
      this._search._text.get_parent().grab_key_focus();
    }

    return Clutter.EVENT_STOP;
  }

  _onFullScreen() {
    this.hide();
  }
}
