import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createExampleStatus } from '../src/exampleStatus.ts';

function fixture(readyState: 'live' | 'ready' = 'live') {
	const browser = new Window();
	const document = browser.document as unknown as Document;
	const elements = { root: document.createElement('main'), status: document.createElement('div'),
		fps: document.createElement('span'), label: document.createElement('span'), signal: document.createElement('span'), feedback: document.createElement('p') };
	return { ...elements, ...createExampleStatus({ ...elements, readyState, loadingNote: 'Model download: 13–23 MB.' }),
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
	assert.equal(f.feedback.hidden, true);
	assert.equal(f.root.dataset.hasFrame, 'true');
	f.warn('Optional feature unavailable');
	assert.equal(f.label.textContent, 'Live · Warning');
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
});

test('FPS follows real frames, resets across pause/loading/suspension and expires when idle', t => {
 const f = fixture(); t.after(f.destroy);
 const frames = (start: number) => { for (let i = 0; i <= 30; i++) f.frame(start + i * (1000 / 60)); f.tick(start + 500); };
 f.update('loading'); frames(0); assert.equal(f.fps.hidden, true);
 f.update('ready'); frames(1000); assert.equal(f.fps.textContent, '60 FPS');
 f.warn('Optional feature unavailable'); f.tick(1550); assert.equal(f.fps.textContent, '60 FPS');
 f.pause(true); assert.equal(f.label.textContent, 'Paused · Warning'); assert.equal(f.fps.hidden, true);
 frames(2000); assert.equal(f.fps.hidden, true);
 f.pause(false); f.tick(3000); assert.equal(f.fps.hidden, true);
 frames(3000); assert.equal(f.fps.textContent, '60 FPS');
 f.suspend(true); assert.equal(f.fps.hidden, true);
 frames(4000); assert.equal(f.fps.hidden, true);
 f.suspend(false); f.tick(5000); assert.equal(f.fps.hidden, true);
 frames(5000); assert.equal(f.fps.textContent, '60 FPS');
 f.tick(7001); assert.equal(f.fps.hidden, true);
 f.frame(8000); f.tick(8500); assert.equal(f.fps.hidden, true, 'one frame does not manufacture FPS');
 frames(9000); f.update('error', 'Device lost'); assert.equal(f.fps.hidden, true);
 frames(10000); assert.equal(f.fps.hidden, true);
 f.update('ready'); frames(11000); assert.equal(f.fps.textContent, '60 FPS');
 f.update('loading', 'New model'); assert.equal(f.fps.hidden, true);
});

test('static Ready examples never advertise a frame rate', t => {
 const f = fixture('ready'); t.after(f.destroy); f.update('ready');
 for (let i = 0; i <= 30; i++) f.frame(i * (1000 / 60));
 f.tick(500); assert.equal(f.fps.hidden, true);
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
