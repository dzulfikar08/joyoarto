/**
 * Size budget of the floating tab bar, in dp (ported from JoyoRogo apps/native/src/lib/tab-bar-metrics.ts). Pure so the
 * footprint is unit tested.
 *
 * The bar is a solid rounded pill inset from the screen edges and lifted above the bottom inset. It floats over the
 * screens: content scrolls underneath, so every tab screen pads the end of its content by `tabContentInset` (the
 * `Screen` component does it). The Add button is raised out of the pill by `ADD_RAISE` and counts toward the footprint.
 */

export const TAB_ITEM_PADDING = 6;
export const TAB_ICON_SIZE = 24;
export const TAB_LABEL_SIZE = 11;
/** Fixed label line so the budget does not depend on the font's own metrics. */
export const TAB_LABEL_LINE = 14;
/** Above this the labels no longer fit a phone's width; the bar stays readable rather than growing with the setting. */
export const TAB_LABEL_MAX_SCALE = 1.3;

export const TAB_BAR_PADDING = 6;
export const TAB_BAR_BORDER = 1;
export const TAB_BAR_MARGIN_X = 16;
export const TAB_BAR_GAP_BOTTOM = 8;
/** iOS: how far the pill dips into the home indicator's safe area. */
export const TAB_BAR_IOS_INSET_TUCK = 12;
/** Widest the pill gets on a foldable or tablet. */
export const TAB_BAR_MAX_WIDTH = 480;

/** Add button: a filled primary circle inside a ring in the pill's colour that notches the pill. */
export const ADD_SIZE = 56;
export const ADD_RING = 4;
export const ADD_OUTER = ADD_SIZE + ADD_RING * 2;
export const ADD_RAISE = 20;
export const ADD_SLOT = ADD_OUTER + 8;

/** Space between the bar's top (Add button included) and the last item of a screen's content. */
export const TAB_BAR_CONTENT_GAP = 12;

export function tabLabelScale(fontScale: number): number {
  if (!Number.isFinite(fontScale)) return 1;
  return Math.min(Math.max(fontScale, 1), TAB_LABEL_MAX_SCALE);
}

export function tabItemHeight(fontScale: number): number {
  return Math.ceil(TAB_ITEM_PADDING * 2 + TAB_ICON_SIZE + TAB_LABEL_LINE * tabLabelScale(fontScale));
}

export function tabBarPillHeight(fontScale: number): number {
  return tabItemHeight(fontScale) + (TAB_BAR_PADDING + TAB_BAR_BORDER) * 2;
}

export function tabBarStripHeight(fontScale: number): number {
  return ADD_RAISE + tabBarPillHeight(fontScale);
}

function safeInset(bottomInset: number): number {
  return Math.max(0, Number.isFinite(bottomInset) ? bottomInset : 0);
}

/** Distance from the screen's bottom edge to the pill. */
export function tabBarBottomOffset(bottomInset: number, os: string): number {
  const inset = safeInset(bottomInset);
  if (os === "ios") return Math.max(inset - TAB_BAR_IOS_INSET_TUCK, TAB_BAR_GAP_BOTTOM);
  return inset + TAB_BAR_GAP_BOTTOM;
}

export function floatingTabBarFootprint(fontScale: number, bottomInset: number, os: string): number {
  return tabBarStripHeight(fontScale) + tabBarBottomOffset(bottomInset, os);
}

/** Bottom padding for the content of a tab screen so the last item scrolls clear of the bar. */
export function tabContentInset(fontScale: number, bottomInset: number, os: string): number {
  return floatingTabBarFootprint(fontScale, bottomInset, os) + TAB_BAR_CONTENT_GAP;
}
