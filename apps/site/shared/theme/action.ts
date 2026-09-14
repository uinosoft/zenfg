import type { ThemeMode } from './index.ts';

/** The icon reflects the current appearance; the label describes the action. */
export function themeAction(mode: ThemeMode, chinese = false) {
    const dark = mode === 'dark';
    return {
        icon: dark ? 'moon' as const : 'sun' as const,
        label: chinese ? (dark ? '切换到亮色主题' : '切换到暗色主题') : (dark ? 'Switch to light theme' : 'Switch to dark theme'),
    };
}
