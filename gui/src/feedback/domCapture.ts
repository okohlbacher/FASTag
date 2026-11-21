// The DOM rasteriser fallback (skill gui-feedback 2, method 2):
// @zumer/snapdom (pinned) draws the visible viewport of the page, open
// dialogs and portals included (they are in the body). It embeds no web
// fonts and fetches nothing from the network (no proxy, no fallback URLs;
// only the page's own bundled images), and password fields and anything
// marked data-feedback-mask are hidden. The browser and e2e builds use it;
// in the desktop app it runs only when the webview's own snapshot failed.

import { snapdom } from '@zumer/snapdom'
import { capped } from './image'

export const MASK = 'input[type="password"], [data-feedback-mask], [data-feedback-ui]'

export async function domCapture(root: HTMLElement = document.body): Promise<HTMLCanvasElement> {
  const bg = getComputedStyle(document.body).backgroundColor || getComputedStyle(document.documentElement).backgroundColor
  const r = await snapdom(root, {
    clip: 'viewport',
    scale: window.devicePixelRatio || 1,
    embedFonts: false,
    exclude: [MASK],
    excludeMode: 'hide',
    backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : null,
    placeholders: true
  })
  return capped(await r.toCanvas())
}

/// The view holds what a webview snapshot may leave out (WebGL, video).
export function holdsAcceleratedContent(doc: Document = document): boolean {
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  }
  return Array.from(doc.querySelectorAll('video, canvas[data-webgl]')).some(visible)
}
