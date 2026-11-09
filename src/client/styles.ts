/** Scoped styles for the paper reader; every token falls back to a readable default. */
export const CSS = String.raw`
.pr-root {
  --pr-bg: var(--dsw-alias-bg-base, #fff);
  --pr-layer: var(--dsw-alias-bg-layer-1, #f7f7f8);
  --pr-layer-2: var(--dsw-alias-bg-layer-2, #fff);
  --pr-text: var(--dsw-alias-label-primary, #1f2329);
  --pr-muted: var(--dsw-alias-label-secondary, #5f6672);
  --pr-faint: var(--dsw-alias-label-tertiary, #8b919c);
  --pr-border: var(--dsw-alias-border-l2, rgba(0, 0, 0, .12));
  --pr-hover: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05));
  --pr-accent: var(--dsw-alias-state-business-primary, #4d6bfe);
  --pr-danger: var(--dsw-alias-state-error-primary, #d33b3b);
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--pr-text);
  background: var(--pr-bg);
  font: var(--dsw-font-xs-13, 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
.pr-root *, .pr-root *::before, .pr-root *::after { box-sizing: border-box; }
.pr-root button, .pr-root textarea, .pr-root input { font: inherit; color: inherit; }
.pr-toolbar {
  z-index: 8;
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  min-height: 46px;
  padding: 6px 8px;
  border-bottom: .5px solid var(--pr-border);
  background: var(--pr-bg);
}
.pr-brand-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; color: var(--pr-muted); }
.pr-heading { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; padding: 0 2px; }
.pr-heading-title { overflow: hidden; font-weight: 550; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.pr-heading-sub { overflow: hidden; color: var(--pr-faint); font-size: 11px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.pr-icon-button {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--pr-muted);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
}
.pr-icon-button:hover:not(:disabled) { color: var(--pr-text); background: var(--pr-hover); }
.pr-icon-button:disabled { color: var(--pr-faint); cursor: default; opacity: .5; }
.pr-icon-button-active { color: var(--pr-accent); background: color-mix(in srgb, var(--pr-accent) 10%, transparent); }
.pr-icon-button-warn { color: var(--dsw-alias-state-warning-primary, #c07a12); background: rgba(255, 174, 62, .14); }
.pr-badge {
  position: absolute;
  top: 1px;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  background: var(--pr-accent);
  border-radius: 999px;
}
.pr-library { flex: 1; min-height: 0; padding: 16px 14px 28px; overflow: auto; }
.pr-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 26px 16px 22px;
  text-align: center;
  background: linear-gradient(180deg, color-mix(in srgb, var(--pr-accent) 4%, transparent), transparent 70%), var(--pr-layer);
  border: 1px dashed color-mix(in srgb, var(--pr-muted) 28%, transparent);
  border-radius: 14px;
}
.pr-hero-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-bottom: 2px;
  color: var(--pr-accent);
  background: color-mix(in srgb, var(--pr-accent) 10%, transparent);
  border-radius: 12px;
}
.pr-hero h2 { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; }
.pr-hero p { max-width: 36em; margin: 0; color: var(--pr-muted); font-size: 12px; line-height: 1.55; }
.pr-hero .pr-button { margin-top: 6px; }
.pr-hint { color: var(--pr-faint); font-size: 11px; }
.pr-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 12px;
  color: var(--pr-text);
  background: var(--pr-layer-2);
  border: .5px solid var(--pr-border);
  border-radius: 8px;
  cursor: pointer;
}
.pr-button:hover:not(:disabled) { background: var(--pr-hover); }
.pr-button:disabled { cursor: default; opacity: .55; }
.pr-button-primary { color: #fff; background: var(--pr-accent); border-color: transparent; }
.pr-button-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--pr-accent) 88%, #000); }
.pr-list-section { margin-top: 20px; }
.pr-section-head { margin: 0 2px 8px; color: var(--pr-muted); font-size: 11px; font-weight: 600; letter-spacing: .02em; }
.pr-paper-list { display: flex; flex-direction: column; gap: 2px; }
.pr-paper-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px 8px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  outline: none;
}
.pr-paper-row:hover, .pr-paper-row:focus-visible { background: var(--pr-hover); }
.pr-paper-art {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 40px;
  color: #c94040;
  background: color-mix(in srgb, #e25555 11%, transparent);
  border-radius: 7px;
}
.pr-paper-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 2px; }
.pr-paper-title { overflow: hidden; font-size: 12.5px; font-weight: 550; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.pr-paper-meta { overflow: hidden; color: var(--pr-faint); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.pr-delete { opacity: 0; }
.pr-paper-row:hover .pr-delete, .pr-paper-row:focus-within .pr-delete { opacity: 1; }
.pr-reader { position: relative; display: flex; flex: 1; flex-direction: column; min-height: 0; }
.pr-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 12px 12px 58px;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--dsw-alias-bg-document-preview, #eceef1);
  scrollbar-gutter: stable;
}
.pr-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: max-content;
  min-width: 100%;
  white-space: normal;
}
.pr-page {
  position: relative;
  display: flex;
  flex: none;
  justify-content: center;
  /* Let the browser skip layout and paint for pages far outside the scrollport. */
  content-visibility: auto;
  contain-intrinsic-size: auto 820px;
}
.pr-page-number {
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 3;
  padding: 1px 5px;
  color: var(--pr-faint);
  font-size: 9px;
  line-height: 1.4;
  background: color-mix(in srgb, var(--pr-bg) 76%, transparent);
  border-radius: 4px;
  pointer-events: none;
}
.pr-surface {
  position: relative;
  flex: none;
  overflow: hidden;
  contain: layout paint;
  background: #fff;
  box-shadow: var(--dsw-elevation-prominent, 0 1px 8px rgba(0, 0, 0, .16));
}
.pr-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; background: #fff; }
.pr-annotations { position: absolute; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; }
.pr-annotation {
  position: absolute;
  background: rgba(255, 205, 56, .34);
  border-radius: 2px;
}
.pr-annotation-note { background: rgba(255, 165, 64, .38); }
.pr-annotation-flash { animation: pr-annotation-pulse 1.5s ease; }
/* Hover affordance for the paragraph being translated: one soft block with a
   left accent bar, so it reads as a paragraph mark rather than a text
   selection (blue fill) or a stack of row bands. */
.pr-paragraph-active {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(90deg,
    color-mix(in srgb, #ffce54 22%, transparent) 0%,
    color-mix(in srgb, #ffce54 10%, transparent) 68%,
    color-mix(in srgb, #ffce54 5%, transparent) 100%);
  border-left: 2px solid color-mix(in srgb, #d6a32c 85%, transparent);
  border-radius: 3px;
}
@keyframes pr-annotation-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 180, 0, 0); }
  30% { box-shadow: 0 0 0 3px rgba(255, 180, 0, .55); }
}
.pr-page-status {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pr-muted);
  pointer-events: none;
}
.pr-page-status .pr-link { pointer-events: auto; }
.pr-link { padding: 0; color: var(--pr-accent); background: none; border: 0; cursor: pointer; }
/* PDF.js derives every span box from these custom properties. Omitting
   --text-scale-factor / --min-font-size-inv left the spans at the inherited
   font size with no transform, so hit-testing landed on the wrong lines. */
.pr-text { position: absolute; inset: 0; z-index: 2; overflow: clip; }
.pr-text.textLayer {
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
  position: absolute;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  text-align: initial;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  color-scheme: only light;
}
.pr-text.textLayer :is(span, br) { position: absolute; color: transparent; white-space: pre; cursor: text; transform-origin: 0% 0%; user-select: text; }
.pr-text.textLayer > :not(.markedContent), .pr-text.textLayer .markedContent span:not(.markedContent) {
  --font-height: 0;
  --scale-x: 1;
  --rotate: 0deg;
  z-index: 1;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.pr-text.textLayer .markedContent { display: contents; }
.pr-text.textLayer span[role="img"] { user-select: none; cursor: default; }
.pr-text.textLayer ::selection { color: transparent; background: var(--dsw-alias-bg-document-selection, rgba(59, 130, 246, .3)); }
.pr-text.textLayer br::selection { background: transparent; }
.pr-pdf-status { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 180px; padding: 28px 18px; color: var(--pr-muted); text-align: center; font-size: 12px; }
.pr-pdf-status p { margin: 0; }
.pr-spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid color-mix(in srgb, var(--pr-muted) 20%, transparent); border-top-color: var(--pr-accent); border-radius: 50%; animation: pr-spin .8s linear infinite; }
.pr-spinner-small { width: 14px; height: 14px; border-width: 1.5px; }
@keyframes pr-spin { to { transform: rotate(360deg); } }
.pr-pagebar {
  position: absolute;
  bottom: 10px;
  left: 50%;
  z-index: 7;
  display: flex;
  align-items: center;
  gap: 1px;
  max-width: calc(100% - 20px);
  padding: 3px 5px;
  background: var(--pr-layer-2);
  border: .5px solid var(--pr-border);
  border-radius: 10px;
  box-shadow: var(--dsw-elevation-prominent, 0 4px 16px rgba(0, 0, 0, .16));
  transform: translateX(-50%);
}
.pr-pagebar .pr-icon-button { width: 26px; height: 26px; border-radius: 6px; }
.pr-page-label { min-width: 72px; padding: 0 4px; color: var(--pr-muted); font-size: 11px; text-align: center; white-space: nowrap; }
.pr-zoom-label { min-width: 34px; color: var(--pr-muted); font-size: 11px; text-align: center; }
.pr-divider { width: 1px; height: 16px; margin: 0 3px; background: var(--pr-border); }
.pr-notes {
  position: absolute;
  right: 8px;
  bottom: 52px;
  left: 8px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  max-height: 55%;
  overflow: hidden;
  background: var(--pr-layer-2);
  border: .5px solid var(--pr-border);
  border-radius: 12px;
  box-shadow: var(--dsw-elevation-prominent, 0 8px 28px rgba(0, 0, 0, .18));
}
.pr-notes-head { display: flex; flex: none; align-items: center; gap: 6px; padding: 7px 8px 6px 12px; font-size: 12px; font-weight: 600; border-bottom: .5px solid var(--pr-border); }
.pr-notes-head .pr-icon-button { margin-left: auto; width: 24px; height: 24px; }
.pr-count { color: var(--pr-faint); font-size: 10px; font-weight: 500; }
.pr-notes-empty { margin: 0; padding: 20px 16px; color: var(--pr-muted); font-size: 11.5px; line-height: 1.55; text-align: center; }
.pr-notes-list { display: flex; flex-direction: column; gap: 1px; padding: 5px; overflow: auto; }
.pr-note-card { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 8px; cursor: pointer; outline: none; }
.pr-note-card:hover, .pr-note-card:focus-visible { background: var(--pr-hover); }
.pr-note-meta { display: flex; align-items: center; gap: 6px; color: var(--pr-faint); font-size: 10px; }
.pr-note-actions { display: inline-flex; gap: 1px; margin-left: auto; }
.pr-note-actions .pr-icon-button { width: 22px; height: 22px; }
.pr-tag { padding: 1px 5px; color: var(--pr-accent); font-size: 9px; font-weight: 600; background: color-mix(in srgb, var(--pr-accent) 10%, transparent); border-radius: 4px; }
.pr-tag-note { color: #b66a00; background: rgba(255, 174, 62, .16); }
.pr-note-quote { display: -webkit-box; overflow: hidden; margin: 0; padding-left: 7px; color: var(--pr-muted); font-size: 11px; line-height: 1.5; border-left: 2px solid rgba(255, 190, 48, .65); -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.pr-note-text { margin: 0; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.pr-selection-menu {
  position: fixed;
  z-index: 10020;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 3px;
  background: var(--pr-layer-2, #fff);
  border: .5px solid rgba(0, 0, 0, .14);
  border-radius: 9px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .2);
}
.pr-translation {
  position: fixed;
  z-index: 10025;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--dsw-alias-label-primary, #1f2329);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 9%, transparent) 0%,
      transparent 42%),
    var(--dsw-alias-bg-layer-2, #fff);
  border: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .14));
  border-radius: 12px;
  box-shadow: var(--dsw-elevation-prominent, 0 12px 38px rgba(0, 0, 0, .22));
  font: var(--dsw-font-xs-13, 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  pointer-events: auto;
  cursor: auto;
  user-select: text;
  animation: pr-tooltip-in .16s ease-out both;
}
.pr-translation-head {
  box-sizing: border-box;
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 9px 12px 7px;
  color: var(--dsw-alias-label-secondary, #5f6672);
  font-size: 10px;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 30%, transparent),
    transparent 74%) bottom left / 100% 1px no-repeat;
}
.pr-translation-scroll {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  padding: 0 12px 10px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.pr-translation-scroll::-webkit-scrollbar { width: 7px; }
.pr-translation-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #8b919c) 32%, transparent); border-radius: 99px; }
.pr-translation-scroll::-webkit-scrollbar-track { background: transparent; }
.pr-translation-fade {
  position: absolute;
  right: 1px;
  bottom: 41px;
  left: 1px;
  height: 26px;
  background: linear-gradient(to bottom, transparent, var(--dsw-alias-bg-layer-2, #fff) 82%);
  pointer-events: none;
}
.pr-translation-actions {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  height: 40px;
  padding: 0 12px;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .08));
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 4%, transparent),
    transparent);
}
.pr-translation-ask {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  color: var(--dsw-alias-state-business-primary, #4d6bfe);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  white-space: nowrap;
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 15%, transparent),
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 7%, transparent));
  border: .5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 28%, transparent);
  border-radius: 7px;
  cursor: pointer;
}
.pr-translation-ask:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 18%, transparent);
}
.pr-translation-ask svg { flex: none; opacity: .85; }
@keyframes pr-tooltip-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .pr-translation { animation: none; }
}
.pr-translation-tag {
  padding: 1px 6px;
  color: var(--dsw-alias-state-business-primary, #4d6bfe);
  font-size: 9px;
  font-weight: 600;
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 18%, transparent),
    color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 8%, transparent));
  border-radius: 5px;
}
.pr-translation-page { margin-left: auto; }
.pr-translation-body { margin: 0; color: var(--dsw-alias-label-primary, #1f2329); font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.pr-translation-pending { color: var(--dsw-alias-label-tertiary, #8b919c); font-style: normal; }
.pr-translation-source {
  display: -webkit-box;
  flex: none;
  margin: 0;
  padding-top: 6px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #8b919c);
  font-size: 10.5px;
  line-height: 1.45;
  word-break: break-word;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .08));
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.pr-math { white-space: normal; }
.pr-math math { font-size: 1.06em; }
.pr-math-display { display: block; margin: 5px 0; overflow-x: auto; overflow-y: hidden; }
.pr-math-error { color: var(--dsw-alias-label-tertiary, #8b919c); }
.pr-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  color: #1f2329;
  font-size: 11.5px;
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.pr-menu-item:hover { background: rgba(0, 0, 0, .06); }
.pr-menu-item svg { flex: none; opacity: .8; }
.pr-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: color-mix(in srgb, var(--pr-bg) 84%, transparent);
  pointer-events: none;
}
.pr-drop-card { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 24px; color: var(--pr-accent); font-size: 12px; font-weight: 550; background: var(--pr-layer-2); border: 1px dashed var(--pr-accent); border-radius: 14px; }
.pr-toast {
  position: absolute;
  right: 12px;
  bottom: 54px;
  left: 12px;
  z-index: 10030;
  width: fit-content;
  max-width: calc(100% - 24px);
  margin: 0 auto;
  padding: 7px 12px;
  color: #fff;
  font-size: 11.5px;
  line-height: 1.45;
  text-align: center;
  background: rgba(32, 36, 44, .94);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .2);
}
.pr-toast-error { background: rgba(160, 40, 40, .96); }
.pr-modal-backdrop { position: fixed; inset: 0; z-index: 10040; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, .38); backdrop-filter: blur(2px); }
.pr-modal { --pr-bg: var(--dsw-alias-bg-base, #fff); --pr-layer: var(--dsw-alias-bg-layer-1, #f7f7f8); --pr-layer-2: var(--dsw-alias-bg-layer-2, #fff); --pr-text: var(--dsw-alias-label-primary, #1f2329); --pr-muted: var(--dsw-alias-label-secondary, #5f6672); --pr-faint: var(--dsw-alias-label-tertiary, #8b919c); --pr-border: var(--dsw-alias-border-l2, rgba(0, 0, 0, .12)); --pr-hover: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); --pr-accent: var(--dsw-alias-state-business-primary, #4d6bfe); display: flex; flex-direction: column; gap: 10px; width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 64px); padding: 14px; overflow: auto; color: var(--pr-text, #1f2329); background: var(--pr-layer-2, #fff); border: .5px solid rgba(0, 0, 0, .14); border-radius: 14px; box-shadow: 0 18px 60px rgba(0, 0, 0, .28); font: var(--dsw-font-xs-13, 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
.pr-modal-wide { width: min(520px, calc(100vw - 32px)); }
.pr-modal-head { display: flex; align-items: center; gap: 8px; }
.pr-modal-head h2 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; line-height: 1.4; }
.pr-modal-head .pr-icon-button { color: #5f6672; }
.pr-quote { max-height: 132px; margin: 0; padding: 8px 10px; overflow: auto; color: #5f6672; font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; background: rgba(0, 0, 0, .035); border-left: 3px solid rgba(255, 190, 48, .8); border-radius: 0 7px 7px 0; }
.pr-textarea { width: 100%; min-height: 96px; padding: 9px 10px; color: #1f2329; line-height: 1.55; background: #fff; border: 1px solid rgba(0, 0, 0, .15); border-radius: 8px; outline: none; resize: vertical; }
.pr-textarea:focus { border-color: var(--pr-accent, #4d6bfe); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent, #4d6bfe) 14%, transparent); }
.pr-modal .pr-hint, .pr-modal .pr-error { margin: 0; }
.pr-error { color: #c0392b; font-size: 11.5px; }
.pr-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
.pr-chip { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; color: inherit; }
.pr-chip svg { flex: none; }
.pr-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  .pr-spinner { animation-duration: 2s; }
  .pr-annotation-flash { animation: none; }
  .pr-pagebar, .pr-toast { transition: none; }
}
`
