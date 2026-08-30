import { mountFrameGraphInspector } from '@zenfg/inspector';
import './styles.css';
import { wireSnapshotFileInputs } from './fileInputs.ts';

const host = document.querySelector<HTMLElement>('#inspector-host');
const input = document.querySelector<HTMLInputElement>('#snapshot-file');
const dropZone = document.querySelector<HTMLElement>('#drop-zone');
if (!host || !input || !dropZone) throw new Error('Inspector application shell is incomplete.');

const inspector = mountFrameGraphInspector(host);
inspector.setExpanded(true);

async function openFile(file: File | undefined): Promise<void> {
	if (!file) return;
	await inspector.importSnapshot(file);
}

const unwireFileInputs = wireSnapshotFileInputs(input, dropZone, openFile);

window.addEventListener('beforeunload', () => {
	unwireFileInputs();
	inspector.destroy();
}, { once: true });
