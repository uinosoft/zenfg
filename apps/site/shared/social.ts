/** Public identity consumed only by Site and documentation builds. */
export const publicSite = 'https://uinosoft.github.io/zenfg/';
export const socialImage = publicSite + 'brand/zenfg-social.png';

/** Static metadata for crawlers that do not execute JavaScript. */
export function socialHead(path: string, title: string, description: string): [string, Record<string, string>][] {
  const url = new URL(path, publicSite).href;
  return [
    ['link', { rel: 'canonical', href: url }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'ZenFG' }],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:url', content: url }],
    ['meta', { property: 'og:image', content: socialImage }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'ZenFG — a composable FrameGraph for WebGPU and wgpu' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: title }],
    ['meta', { name: 'twitter:description', content: description }],
    ['meta', { name: 'twitter:image', content: socialImage }],
    ['meta', { name: 'twitter:image:alt', content: 'ZenFG — a composable FrameGraph for WebGPU and wgpu' }],
  ];
}
