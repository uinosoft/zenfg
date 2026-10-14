import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, type HTMLAnchorElement } from 'happy-dom';
import { preferredLanguage, updateDocumentLinks } from '../shared/language.ts';

test('document language preference follows explicit choice, browser order and blocked storage', t => {
    const window = new Window();
    t.after(() => window.happyDOM.abort());
    Object.defineProperty(window.navigator, 'languages', { value: ['zh-TW', 'en-US'], configurable: true });
    const host = window as unknown as globalThis.Window;
    assert.equal(preferredLanguage(host), 'zh-CN');
    window.localStorage.setItem('zenfg-language', 'en');
    assert.equal(preferredLanguage(host), 'en');
    window.localStorage.setItem('zenfg-language', 'invalid');
    assert.equal(preferredLanguage(host), 'zh-CN');
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked'); } });
    assert.equal(preferredLanguage(host), 'zh-CN');
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US', 'zh-CN'], configurable: true });
    assert.equal(preferredLanguage(host), 'en');
});

test('document links preserve prefixes, anchors and English API/external destinations through repeated switches', t => {
    const window = new Window({ url: 'https://example.org/zenfg/playground/' });
    t.after(() => window.happyDOM.abort());
    const original = ['../docs/', '/zenfg/docs/concepts.html#integration-levels', 'https://example.org/zenfg/docs/zh-CN/getting-started.html', '../docs/api/webgpu/', 'https://other.org/docs/', '../inspector/'];
    window.document.body.innerHTML = original.map(href => '<a href="' + href + '">Link</a>').join('');
    const links = [...window.document.querySelectorAll<HTMLAnchorElement>('a')];
    const hrefs = () => links.map(link => link.getAttribute('href'));
    updateDocumentLinks(window.document as unknown as Document, 'zh-CN');
    const chinese = ['../docs/zh-CN/', '/zenfg/docs/zh-CN/concepts.html#integration-levels', 'https://example.org/zenfg/docs/zh-CN/getting-started.html', ...original.slice(3)];
    assert.deepEqual(hrefs(), chinese);
    updateDocumentLinks(window.document as unknown as Document, 'zh-CN');
    assert.deepEqual(hrefs(), chinese);
    updateDocumentLinks(window.document as unknown as Document, 'en');
    assert.deepEqual(hrefs(), [original[0], original[1], 'https://example.org/zenfg/docs/getting-started.html', ...original.slice(3)]);
});
