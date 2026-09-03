import { mountFrameGraphInspector } from '@zenfg/inspector';
import { installAppPageLifecycle } from '../../shared/pageLifecycle.ts';
import './styles.css';

const host = document.querySelector<HTMLElement>('#inspector-host');
if (!host) throw new Error('Inspector application host is missing.');

const inspector = mountFrameGraphInspector(host);

installAppPageLifecycle(window, {
	onDiscard: () => {
		inspector.destroy();
	},
	reloadOnRestore: import.meta.hot ? () => {
		window.location.reload();
	} : undefined,
});
