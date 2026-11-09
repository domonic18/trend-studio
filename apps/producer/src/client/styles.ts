/**
 * 面板样式：随浏览器半注入一次，颜色全部走 currentColor / 半透明边框，
 * 因此明暗两套主题下都不需要另写一份。
 */

const STYLE_ID = 'trend-producer-panel-style'

const PANEL_CSS = `
.tp-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px; font-size: 13px; line-height: 1.6; }
.tp-card { border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px; padding: 10px 12px; }
.tp-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.tp-card-title { font-weight: 600; margin: 0; font-size: 13px; }
.tp-row { display: flex; gap: 8px; align-items: baseline; justify-content: space-between; }
.tp-label { opacity: 0.66; white-space: nowrap; }
.tp-value { text-align: right; word-break: break-all; }
.tp-muted { opacity: 0.6; }
.tp-hint { margin: 6px 0 0; opacity: 0.66; }
.tp-error { margin: 6px 0 0; color: #d9534f; }
.tp-notice { margin: 6px 0 0; }
.tp-button { border: 1px solid rgba(128, 128, 128, 0.4); background: transparent; color: inherit; border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; }
.tp-button:hover:not(:disabled) { border-color: rgba(128, 128, 128, 0.75); }
.tp-button:disabled { opacity: 0.5; cursor: default; }
.tp-select { width: 100%; background: transparent; color: inherit; border: 1px solid rgba(128, 128, 128, 0.35); border-radius: 6px; padding: 4px 6px; font: inherit; }
.tp-section { border-top: 1px solid rgba(128, 128, 128, 0.2); padding: 8px 0 0; margin-top: 8px; }
.tp-section:first-of-type { border-top: none; margin-top: 0; }
.tp-section-title { font-weight: 600; margin: 0 0 4px; }
.tp-steps { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 4px 0 0; padding: 0; list-style: none; }
.tp-step { border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 999px; padding: 1px 8px; font-size: 12px; white-space: nowrap; }
.tp-step-done { border-color: rgba(64, 160, 96, 0.75); }
.tp-step-running { border-color: rgba(64, 128, 220, 0.8); }
.tp-step-failed, .tp-step-blocked { border-color: rgba(200, 72, 72, 0.85); }
.tp-counts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; opacity: 0.8; }
.tp-verdict-approve { color: #4a9c62; }
.tp-verdict-reject { color: #c84848; }
`

/** 面板样式随浏览器半注入一次即可；重复调用不重复挂载。 */
export function ensurePanelStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = PANEL_CSS
  document.head.appendChild(style)
}
