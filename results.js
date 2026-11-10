import Clutter from 'gi://Clutter';

const SECTION_CLASS = 'slg-section';

// Restyles the list-style search sections of GNOME's search results view
// into a single-column list with a title per section, and puts back the
// stock layout on restore().
export class ResultsRestyler {
  constructor(view) {
    this._view = view;
    // display -> {orientation, iconVisible, icon, destroyId}
    this._saved = new Map();
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

    for (const [display, saved] of this._saved) {
      display.disconnect(saved.destroyId);
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
}
