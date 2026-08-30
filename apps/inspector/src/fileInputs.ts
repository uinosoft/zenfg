export type OpenSnapshotFile = (file: File | undefined) => void | Promise<void>;

/** Wires the standalone page's native file picker and drag/drop surface. */
export function wireSnapshotFileInputs(
	input: HTMLInputElement,
	dropZone: HTMLElement,
	openFile: OpenSnapshotFile,
): () => void {
	const onChange = (): void => {
		void openFile(input.files?.[0]);
		input.value = '';
	};
	const onDragEnterOrOver = (event: DragEvent): void => {
		event.preventDefault();
		dropZone.classList.add('dragging');
	};
	const onDragLeaveOrEnd = (): void => dropZone.classList.remove('dragging');
	const onDrop = (event: DragEvent): void => {
		event.preventDefault();
		dropZone.classList.remove('dragging');
		void openFile(event.dataTransfer?.files[0]);
	};

	input.addEventListener('change', onChange);
	dropZone.addEventListener('dragenter', onDragEnterOrOver);
	dropZone.addEventListener('dragover', onDragEnterOrOver);
	dropZone.addEventListener('dragleave', onDragLeaveOrEnd);
	dropZone.addEventListener('dragend', onDragLeaveOrEnd);
	dropZone.addEventListener('drop', onDrop);

	return () => {
		input.removeEventListener('change', onChange);
		dropZone.removeEventListener('dragenter', onDragEnterOrOver);
		dropZone.removeEventListener('dragover', onDragEnterOrOver);
		dropZone.removeEventListener('dragleave', onDragLeaveOrEnd);
		dropZone.removeEventListener('dragend', onDragLeaveOrEnd);
		dropZone.removeEventListener('drop', onDrop);
	};
}
