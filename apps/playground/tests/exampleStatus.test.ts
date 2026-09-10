import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createExampleStatus } from '../src/exampleStatus.ts';

function fixture(readyState: 'live' | 'ready' = 'live') {
	const browser = new Window();
	const document = browser.document as unknown as Document;
	let fps: number | undefined;
	const samples: number[] = [];
	const elements = { root: document.createElement('main'), status: document.createElement('div'),
		label: document.createElement('span'), signal: document.createElement('span'), feedback: document.createElement('p') };
	return { ...elements, samples, get fps() { return fps; }, ...createExampleStatus({ ...elements, onFrameRate: value => { fps = value; }, onFrameSample: value => samples.push(value), readyState, loadingNote: 'Model download: 13–23 MB.' }),
		destroy: () => browser.happyDOM.abort() };
}
test('runtime feedback separates loading detail, short readiness, warnings and fatal errors', t => {
	const f = fixture();
	t.after(f.destroy);
	f.update('loading', 'Downloading model…');
	assert.equal(f.label.textContent, 'Loading…');
	assert.match(f.feedback.textContent!, /Downloading model.*Model download/);
	assert.equal(f.feedback.hidden, false);
	assert.equal(f.root.dataset.hasFrame, undefined);
	f.update('ready', 'Unnecessary renderer description');
	assert.equal(f.label.textContent, 'Live');
	assert.equal(f.status.hidden, true);
	assert.equal(f.feedback.hidden, true);
	assert.equal(f.root.dataset.hasFrame, 'true');
	f.warn('Optional feature unavailable');
	assert.equal(f.label.textContent, 'Live · Warning');
	assert.equal(f.status.hidden, false);
	assert.equal(f.root.dataset.effectState, 'ready');
	assert.equal(f.feedback.dataset.state, 'warning');
	assert.equal(f.feedback.textContent, 'Optional feature unavailable');
	f.warn();
	assert.equal(f.label.textContent, 'Live');
	assert.equal(f.feedback.hidden, true);
	f.update('loading', 'Changing input…');
	assert.equal(f.root.dataset.hasFrame, 'true');
	f.update('error', 'Device lost');
	assert.equal(f.label.textContent, 'Error');
	assert.equal(f.status.hidden, false);
	assert.equal(f.feedback.getAttribute('role'), 'alert');
	assert.equal(f.feedback.textContent, 'Device lost');
	assert.equal(f.root.dataset.hasFrame, 'true');
	f.warn('Late warning');
	assert.equal(f.label.textContent, 'Error');
	assert.equal(f.feedback.textContent, 'Device lost');
	f.update('ready');
	assert.equal(f.feedback.hidden, true);
});
test('a one-shot recipe reports Ready, not Live', t => {
	const f = fixture('ready');
	t.after(f.destroy);
	f.update('ready');
	assert.equal(f.label.textContent, 'Ready');
	assert.equal(f.status.hidden, true);
});

test('FPS follows real frames, resets across pause/loading/suspension and expires when idle', t => {
 const f = fixture(); t.after(f.destroy);
 const frames = (start: number) => { for (let i = 0; i <= 30; i++) f.frame(start + i * (1000 / 60)); f.tick(start + 500); };
 f.update('loading'); frames(0); assert.equal(f.fps, undefined);
 f.update('ready'); frames(1000); assert.equal(f.fps, 60);
 f.warn('Optional feature unavailable'); f.tick(1550); assert.equal(f.fps, 60);
 f.pause(true); assert.equal(f.label.textContent, 'Paused · Warning'); assert.equal(f.status.hidden, false); assert.equal(f.fps, undefined);
 frames(2000); assert.equal(f.fps, undefined);
 f.pause(false); f.tick(3000); assert.equal(f.fps, undefined);
 frames(3000); assert.equal(f.fps, 60);
 f.suspend(true); assert.equal(f.fps, undefined);
 frames(4000); assert.equal(f.fps, undefined);
 f.suspend(false); f.tick(5000); assert.equal(f.fps, undefined);
 frames(5000); assert.equal(f.fps, 60);
 f.tick(7001); assert.equal(f.fps, undefined);
 f.frame(8000); f.tick(8500); assert.equal(f.fps, undefined, 'one frame does not manufacture FPS');
 frames(9000); f.update('error', 'Device lost'); assert.equal(f.fps, undefined);
 frames(10000); assert.equal(f.fps, undefined);
 f.update('ready'); frames(11000); assert.equal(f.fps, 60);
 f.update('loading', 'New model'); assert.equal(f.fps, undefined);
});

test('static Ready examples never advertise a frame rate', t => {
 const f = fixture('ready'); t.after(f.destroy); f.update('ready');
 for (let i = 0; i <= 30; i++) f.frame(i * (1000 / 60));
 f.tick(500); assert.equal(f.fps, undefined);
});

test('warnings received before the first frame remain visible after readiness', t => {
 const f = fixture(); t.after(f.destroy);
 f.update('loading', 'Preparing first frame');
 f.warn('Environment unavailable');
 assert.match(f.feedback.textContent!, /Environment unavailable/);
 f.update('ready');
 assert.equal(f.label.textContent, 'Live · Warning');
 assert.equal(f.feedback.textContent, 'Environment unavailable');
 f.warn();
 assert.equal(f.feedback.hidden, true);
});

test('curve samples every frame while the average publishes only on timer ticks', t => {
 const f = fixture(); t.after(f.destroy); f.update('ready');
 f.frame(0); f.frame(10); f.frame(100);
 assert.deepEqual(f.samples, [100, 11]);
 assert.equal(f.fps, undefined);
 f.tick(100); assert.equal(f.fps, 20, 'divide interval count by elapsed time, not mean reciprocal FPS');
 assert.deepEqual(f.samples, [100, 11], 'timer never adds graph samples');
 f.pause(true); assert.equal(f.fps, undefined);
 f.pause(false); f.frame(200); f.tick(200); assert.equal(f.fps, undefined);
 f.frame(220); f.tick(250); assert.equal(f.fps, 50, 'resume starts a fresh average');
});
