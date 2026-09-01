import { mountFrameGraphInspector } from '@zenfg/inspector';
import './styles.css';

const host = document.querySelector<HTMLElement>('#inspector-host');
if (!host) throw new Error('Inspector application host is missing.');

const inspector = mountFrameGraphInspector(host);

window.addEventListener('beforeunload', () => {
	inspector.destroy();
}, { once: true });
