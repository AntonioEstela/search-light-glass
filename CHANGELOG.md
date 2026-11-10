## ROADMAP

## 1 - Search Light Glass

* fork of Search Light 38 with its own UUID, schema and stylesheet class
* real backdrop blur (wallpaper and window clones, blur, rounded corners, saturation, tint), on by default; the ImageMagick wallpaper blur is removed
* rounded outer panel shadow, with a faint outline in light mode
* automatic light/dark theme from the system color scheme, with live switching; user colors override it
* new defaults: blur on, radius 28px, border 1px
* single-column sectioned results with section titles, 28px icons, subtitles and a translucent selection pill; applications shown as rows
* fix: shell crash when hiding the panel
* fix: show during hide race
* fix: application rows not launching
* fix: window-created handler was lost after the first hide
* add nested GNOME Shell test harness and unit tests

## release 38

* fork gnome 48 from 47
* add multi-user support
* add fade-in animation
* add blurred background
* add panel icon (with color settings)

## release 16

* add web search (scrapped)
* add unit conversion (scrapped)
* add currency conversion (scrapped)

## release 15

* fix monitor preference

## release 14

* port to gnome 45
* remove blur background (permanently?)
* remove panel icon (temporarily?)

## release 11

* fix close on enter/click

## release 9

* add panel search icon
* fix close on escape

## release 8

* fix follow cursor, preferred monitor

## release 7

* improve background blurring
* add custom text color
* fix scroll issue
* fix fullscreen issue

## release 5

* add window borders
* add background blur
* add font-size settings

## release 4

* takes gnome's search outside of overview
* custom search window size
* bind to super+custom keys
* bind to preferred monitor or to cursor
