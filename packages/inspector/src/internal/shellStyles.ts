const STYLE_ELEMENT_ID = 'zenfg-inspector-shell-styles';

const INSPECTOR_SHELL_CSS = `
.zenfg-inspector-shell-dock {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    justify-content: flex-end;
    gap: 4px;
    padding: var(--zenfg-inspector-edge, 12px);
    pointer-events: none;
    z-index: 3;
    box-sizing: border-box;
}

.zenfg-inspector-shell-dock > .zenfg-inspector-shell {
    pointer-events: auto;
}

.zenfg-inspector-shell {
    position: static;
    width: fit-content;
    max-width: calc(100% - 2 * var(--zenfg-inspector-edge, 12px));
    z-index: 1;
    overflow: visible;
    border: 1px solid var(--zenfg-inspector-border, rgba(180, 190, 202, 0.16));
    border-radius: var(--zenfg-inspector-radius-sm, 4px);
    color: var(--zenfg-inspector-text, #e6edf3);
    background: var(--zenfg-inspector-background, rgba(15, 21, 29, 0.97));
    box-shadow: var(--zenfg-inspector-shadow-sm, 0 8px 24px rgba(0, 0, 0, 0.28));
    font-family: var(--zenfg-inspector-font-ui, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    color-scheme: var(--zenfg-inspector-color-scheme, dark);
}

.zenfg-inspector-shell.expanded {
    z-index: 10;
}

.zenfg-inspector-shell.collapsed {
    overflow: hidden;
}

.zenfg-inspector-shell-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 9px;
    border-bottom: 1px solid var(--zenfg-inspector-border, rgba(180, 190, 202, 0.16));
    cursor: pointer;
}

.zenfg-inspector-shell.collapsed .zenfg-inspector-shell-header {
    border-bottom: 0;
}

.zenfg-inspector-shell-title {
    min-width: 0;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.zenfg-inspector-shell-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    margin-left: auto;
}

.zenfg-inspector-shell-header-status {
    flex: 0 0 auto;
    font-family: var(--zenfg-inspector-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
}

.zenfg-inspector-shell-actions:empty {
    display: none;
}

.zenfg-inspector-shell-action,
.zenfg-inspector-shell-toggle {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--zenfg-inspector-border-strong, rgba(180, 190, 202, 0.28));
    border-radius: var(--zenfg-inspector-radius-sm, 4px);
    color: var(--zenfg-inspector-text, #e6edf3);
    background: var(--zenfg-inspector-surface-raised, #18222d);
    font: inherit;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
}

.zenfg-inspector-shell-action {
    width: auto;
    min-width: 24px;
    padding-inline: 6px;
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.zenfg-inspector-shell-action:hover:not(:disabled),
.zenfg-inspector-shell-toggle:hover:not(:disabled) {
    border-color: var(--zenfg-inspector-border-strong, rgba(180, 190, 202, 0.28));
    background: var(--zenfg-inspector-surface-hover, #1d2935);
}

.zenfg-inspector-shell-action:focus-visible,
.zenfg-inspector-shell-toggle:focus-visible {
    outline: 1px solid var(--zenfg-inspector-accent, #38bdf8);
    outline-offset: 1px;
}

.zenfg-inspector-shell-action.active,
.zenfg-inspector-shell-toggle.active {
    border-color: var(--zenfg-inspector-accent, #38bdf8);
    color: var(--zenfg-inspector-accent, #38bdf8);
    background: var(--zenfg-inspector-accent-soft, rgba(56, 189, 248, 0.12));
}

.zenfg-inspector-shell-action:disabled,
.zenfg-inspector-shell-toggle:disabled {
    cursor: default;
    opacity: 0.5;
}

.zenfg-inspector-shell-body {
    position: absolute;
    right: var(--zenfg-inspector-edge, 12px);
    bottom: var(
        --zenfg-inspector-trigger-clearance,
        calc(var(--zenfg-inspector-edge, 12px) + var(--zenfg-inspector-trigger-offset, 44px))
    );
    min-width: 0;
    min-height: 0;
    padding: 10px;
    overflow: auto;
    border: 1px solid var(--zenfg-inspector-border-strong, rgba(180, 190, 202, 0.28));
    border-radius: var(--zenfg-inspector-radius-sm, 4px);
    background: var(--zenfg-inspector-background, rgba(15, 21, 29, 0.97));
    box-shadow: var(--zenfg-inspector-shadow-lg, 0 18px 44px rgba(0, 0, 0, 0.4));
    box-sizing: border-box;
}

.zenfg-inspector-shell-body[hidden] {
    display: none;
}

@media (max-width: 720px) {
    .zenfg-inspector-shell-dock {
        flex-direction: column;
        align-items: flex-end;
        justify-content: flex-end;
    }
}
`;

export function ensureInspectorShellStyles(): void {
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = INSPECTOR_SHELL_CSS;
    document.head.appendChild(style);
}
