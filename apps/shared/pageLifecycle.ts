export type AppPageLifecycleOptions = {
	readonly onDiscard: () => void;
	readonly onRestore?: () => void;
	/** Reconnect development-only resources, such as Vite's HMR WebSocket. */
	readonly reloadOnRestore?: () => void;
};

type PageLifecycleTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export function installAppPageLifecycle(
	target: PageLifecycleTarget,
	options: AppPageLifecycleOptions,
): () => void {
	const handlePageHide = (event: PageTransitionEvent): void => {
		if (!event.persisted) options.onDiscard();
	};
	const handlePageShow = (event: PageTransitionEvent): void => {
		if (!event.persisted) return;
		options.onRestore?.();
		options.reloadOnRestore?.();
	};

	// Unlike beforeunload, pagehide identifies documents retained by the BFCache.
	target.addEventListener('pagehide', handlePageHide);
	target.addEventListener('pageshow', handlePageShow);

	return () => {
		target.removeEventListener('pagehide', handlePageHide);
		target.removeEventListener('pageshow', handlePageShow);
	};
}
