import Clutter from 'gi://Clutter';
import St from 'gi://St';

const SECTION_CLASS = 'slg-section';
const ROW_ICON_SIZE = 28;

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
    };

    for (const provider of view._providers ?? []) this._style(provider.display);
  }

  restore() {
    const view = this._view;
    if (!view || !this._origEnsure) return;

    if (this._hadOwnEnsure) view._ensureProviderDisplay = this._origEnsure;
    else delete view._ensureProviderDisplay;
    this._origEnsure = null;

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
