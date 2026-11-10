import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {
  GridSearchResults,
  ListSearchResult,
} from 'resource:///org/gnome/shell/ui/search.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const SECTION_CLASS = 'slg-section';
const ROW_ICON_SIZE = 28;
// GNOME's MAX_LIST_SEARCH_RESULTS_ROWS.
const MAX_APP_ROWS = 5;

// A row of the apps provider. The provider has no activateResult(): the
// stock grid activates through AppIcon, so do the same here (launch or raise
// the app, ctrl for a new window; system actions such as Power Off too).
const AppRow = GObject.registerClass(
class AppRow extends ListSearchResult {
  activate() {
    const id = this.metaInfo.id;
    const app = id.endsWith('.desktop')
      ? Shell.AppSystem.get_default().lookup_app(id)
      : null;
    if (app) {
      const event = Clutter.get_current_event();
      const ctrl = ((event?.get_state() ?? 0) & Clutter.ModifierType.CONTROL_MASK) !== 0;
      if (ctrl && app.can_open_new_window() && app.state === Shell.AppState.RUNNING)
        app.open_new_window(-1);
      else app.activate();
    } else {
      SystemActions.getDefault().activateAction(id);
    }
    Main.overview.hide();
  }
});

// The apps provider, shown as rows under a section title instead of
// GNOME's icon grid. Reuses GridSearchResults' provider plumbing, so focus
// navigation, the default result and activation behave as stock.
const AppRowResults = GObject.registerClass(
class AppRowResults extends GridSearchResults {
  _init(provider, resultsView) {
    super._init(provider, resultsView);

    this._rows = new St.BoxLayout({
      style_class: 'list-search-results',
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
    });
    const title = new St.Label({
      text: _('Applications'),
      style_class: 'slg-section-title',
      x_align: Clutter.ActorAlign.START,
    });
    const section = new St.BoxLayout({
      style_class: 'search-section-content',
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
    });
    section.add_child(title);
    section.add_child(this._rows);
    this._resultDisplayBin.child = section;
    this.add_style_class_name(SECTION_CLASS);
  }

  _onDestroy() {
    // Stop an in-flight metas request and make late updateSearch() calls
    // no-ops: the rows are about to be gone.
    this._dead = true;
    this._cancellable.cancel();
    super._onDestroy();
  }

  // The grid re-runs the search whenever its width changes to refit its
  // columns; the row count is fixed, so skip that and use the base logic.
  async updateSearch(...args) {
    if (this._dead) return;
    const base = Object.getPrototypeOf(GridSearchResults).prototype;
    if (base?.updateSearch) await base.updateSearch.apply(this, args);
    else await super.updateSearch(...args);
  }

  _getMaxDisplayedResults() {
    const max = this.provider.maxResults ?? -1;
    return max < 0 ? MAX_APP_ROWS : Math.min(max, MAX_APP_ROWS);
  }

  _createResultDisplay(meta) {
    const app = Shell.AppSystem.get_default().lookup_app(meta.id);
    return new AppRow(
      this.provider,
      {...meta, description: app?.get_description() ?? ''},
      this._resultsView
    );
  }

  _addItem(display) {
    if (!this._dead) this._rows.add_child(display);
  }

  _clearResultDisplay() {
    if (!this._dead) this._rows.remove_all_children();
  }

  getFirstResult() {
    return this._dead ? null : this._rows.get_n_children() > 0
      ? this._rows.get_child_at_index(0)
      : null;
  }
});

// Restyles the list-style search sections of GNOME's search results view
// into a single-column list with a title per section, and puts back the
// stock layout on restore().
export class ResultsRestyler {
  constructor(view) {
    this._view = view;
    // display -> {orientation, iconVisible, icon, destroyId}
    this._saved = new Map();
    // row -> {icon, iconSize, title, description, textBox, destroyId}
    this._rows = new Map();
    this._hadOwnEnsure = false;
    this._origEnsure = null;
    // original grid display -> AppRowResults standing in for it
    this._appRows = new Map();
  }

  apply() {
    const view = this._view;
    if (!view || this._origEnsure) return;

    this._hadOwnEnsure = Object.prototype.hasOwnProperty.call(
      view,
      '_ensureProviderDisplay'
    );
    this._origEnsure = view._ensureProviderDisplay;
    const orig = this._origEnsure;
    view._ensureProviderDisplay = provider => {
      orig.call(view, provider);
      this._style(provider.display);
      this._swapAppsForRows(provider);
    };

    for (const provider of view._providers ?? []) {
      this._style(provider.display);
      this._swapAppsForRows(provider);
    }
  }

  restore() {
    const view = this._view;
    if (!view || !this._origEnsure) return;

    if (this._hadOwnEnsure) view._ensureProviderDisplay = this._origEnsure;
    else delete view._ensureProviderDisplay;
    this._origEnsure = null;

    for (const grid of [...this._appRows.keys()]) this._restoreApps(grid);
    for (const row of [...this._rows.keys()]) this._restoreRow(row);

    for (const [display, saved] of this._saved) {
      display.disconnect(saved.destroyId);
      if (saved.hadOwnAddItem) display._addItem = saved.origAddItem;
      else delete display._addItem;
      display._container.orientation = saved.orientation;
      if (saved.icon) saved.icon.visible = saved.iconVisible;
      if (saved.content) {
        saved.content.x_align = saved.contentXAlign;
        saved.content.x_expand = saved.contentXExpand;
      }
      display.providerInfo.x_align = saved.xAlign;
      display.providerInfo.x_expand = saved.xExpand;
      display.remove_style_class_name(SECTION_CLASS);
    }
    this._saved.clear();
  }

  // Replaces the apps provider's icon grid with an AppRowResults placed at
  // the same position in the view.
  _swapAppsForRows(provider) {
    const grid = provider.display;
    const view = this._view;
    if (!grid || provider.appInfo || grid instanceof AppRowResults) return;
    if (!(grid instanceof GridSearchResults) || this._appRows.has(grid)) return;

    const rows = new AppRowResults(provider, view);
    const index = view._content.get_children().indexOf(grid);
    rows.connect('notify::focus-child', view._focusChildChanged.bind(view));
    rows.hide();
    view._content.add_child(rows);
    if (index >= 0) view._content.set_child_at_index(rows, index);
    const gridWasVisible = grid.visible;
    grid.hide();

    const origAddItem = rows._addItem;
    rows._addItem = row => {
      origAddItem.call(rows, row);
      this._styleRow(row);
    };

    const destroyId = rows.connect('destroy', () => this._appRows.delete(grid));
    this._appRows.set(grid, {rows, destroyId, provider, gridWasVisible});
    provider.display = rows;
    this._replaySearch(provider, rows);
  }

  // The view keeps its terms and results across Search Light being closed
  // and reopened, so a fresh display is filled from them instead of waiting
  // for a new search.
  _replaySearch(provider, display) {
    const view = this._view;
    const results = view._results?.[provider.id];
    if (!results || !(view._terms?.length > 0)) return;
    display
      .updateSearch(results, view._terms)
      .then(() => {
        if (display._dead) return;
        view._maybeSetInitialSelection();
        view._updateSearchProgress();
      })
      .catch(e => console.error(e));
  }

  _restoreApps(grid) {
    const st = this._appRows.get(grid);
    if (!st) return;
    this._appRows.delete(grid);
    st.rows.disconnect(st.destroyId);
    const view = this._view;
    const stale = view._defaultResult && st.rows.contains(view._defaultResult);
    // Rows are destroyed with their display; forget them first.
    for (const row of st.rows._rows.get_children()) this._restoreRow(row);
    st.rows.destroy();
    if (stale) view._defaultResult = null;
    st.provider.display = grid;
    grid.visible = st.gridWasVisible;
  }

  _style(display) {
    // Only list-style displays (those with a provider header) are restyled;
    // the app grid is left alone.
    if (!display || !display._container || !display.providerInfo) return;
    if (this._saved.has(display)) return;

    const icon = display.providerInfo._content?.get_first_child() ?? null;
    const saved = {
      orientation: display._container.orientation,
      icon,
      iconVisible: icon ? icon.visible : true,
      xAlign: display.providerInfo.x_align,
      xExpand: display.providerInfo.x_expand,
      content: display.providerInfo._content ?? null,
      contentXAlign: display.providerInfo._content?.x_align,
      contentXExpand: display.providerInfo._content?.x_expand,
      destroyId: display.connect('destroy', () => this._saved.delete(display)),
    };
    this._saved.set(display, saved);

    saved.hadOwnAddItem = Object.prototype.hasOwnProperty.call(display, '_addItem');
    saved.origAddItem = display._addItem;
    const origAddItem = display._addItem;
    display._addItem = row => {
      origAddItem.call(display, row);
      this._styleRow(row);
    };
    for (const row of display._content?.get_children() ?? []) this._styleRow(row);

    display._container.orientation = Clutter.Orientation.VERTICAL;
    // The header button spans the section so its divider does too.
    display.providerInfo.x_align = Clutter.ActorAlign.FILL;
    display.providerInfo.x_expand = true;
    if (saved.content) {
      saved.content.x_align = Clutter.ActorAlign.FILL;
      saved.content.x_expand = true;
    }
    icon?.hide();
    display.add_style_class_name(SECTION_CLASS);
  }

  // Row layout: icon on the left, name over a one-line subtitle on the right.
  _styleRow(row) {
    if (this._rows.has(row)) return;
    const content = row.get_child?.();
    const titleBox = content?.get_first_child?.();
    const title = row.label_actor;
    const description = row._descriptionLabel;
    if (!content || !titleBox || !title || title.get_parent() !== titleBox) return;

    const icon = titleBox.get_first_child() !== title ? titleBox.get_first_child() : null;
    const state = {
      content,
      titleBox,
      icon,
      iconSize: icon && 'icon_size' in icon ? icon.icon_size : null,
      title,
      titleXAlign: title.x_align,
      descXAlign: description?.x_align,
      description: description?.get_parent() === content ? description : null,
      textBox: new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      }),
      destroyId: row.connect('destroy', () => this._rows.delete(row)),
    };
    this._rows.set(row, state);

    if (state.iconSize !== null) icon.icon_size = ROW_ICON_SIZE;
    title.x_align = Clutter.ActorAlign.START;
    if (description) description.x_align = Clutter.ActorAlign.START;
    titleBox.remove_child(title);
    state.textBox.add_child(title);
    if (state.description) {
      content.remove_child(state.description);
      state.textBox.add_child(state.description);
    }
    content.add_child(state.textBox);
  }

  _restoreRow(row) {
    const st = this._rows.get(row);
    if (!st) return;
    this._rows.delete(row);
    row.disconnect(st.destroyId);
    st.title.x_align = st.titleXAlign;
    if (st.description) st.description.x_align = st.descXAlign;
    st.textBox.remove_child(st.title);
    st.titleBox.add_child(st.title);
    if (st.description) {
      st.textBox.remove_child(st.description);
      st.content.add_child(st.description);
    }
    st.content.remove_child(st.textBox);
    st.textBox.destroy();
    if (st.iconSize !== null) st.icon.icon_size = st.iconSize;
  }
}
