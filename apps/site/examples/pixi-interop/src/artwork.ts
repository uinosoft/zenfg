import { Circle, Container, DisplacementFilter, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import { portalLayout } from './view.ts';

interface Actions { toggleOrbit(): void; toggleLens(): void; reset(): void; }

/** Ordinary Pixi scene objects. The built-in filter sees both the live image and the 2D artwork. */
export function createArtwork(viewportTexture: Texture, mapTexture: Texture, actions: Actions) {
    const root = new Container();
    const content = new Container();
    const background = new Graphics();
    const backOrbit = new Graphics();
    const viewport = new Sprite(viewportTexture);
    const mask = new Graphics();
    const foreground = new Graphics();
    const title = text('PORTAL LENS', 20, 0xe5f5ef, '600');
    const subtitle = text('A small window into somewhere else.', 11, 0x81a5ae);
    const sector = text('SECTOR 07\nLIVE TRANSMISSION', 10, 0x9bdfd1);
    const marker = new Graphics().circle(0, 0, 3).fill(0xf5b36b);
    viewport.mask = mask;
    content.addChild(background, backOrbit, viewport, mask, foreground, title, subtitle, sector, marker);

    const displacement = new Sprite(mapTexture);
    displacement.anchor.set(0.5);
    const filter = new DisplacementFilter({ sprite: displacement, scale: 50, resolution: 'inherit', antialias: 'inherit' });
    content.filters = [filter];
    const portalHit = new Container();
    portalHit.eventMode = 'static';
    portalHit.cursor = 'grab';
    const lens = new Container();
    lens.eventMode = 'static';
    lens.cursor = 'move';
    const rim = new Graphics();
    const lensLabel = text('DRAG LENS', 9, 0xe0d4b8);
    lensLabel.anchor.set(0.5, 0);
    lens.addChild(rim, lensLabel);
    root.addChild(content, displacement, portalHit, lens);

    function button(label: string, action: () => void) {
        const container = new Container();
        const plate = new Graphics();
        const caption = text(label, 11, 0xc6dadc);
        caption.anchor.set(0.5);
        container.addChild(plate, caption);
        container.eventMode = 'static';
        container.cursor = 'pointer';
        container.on('pointertap', action);
        container.on('pointerover', () => { container.alpha = 0.75; });
        container.on('pointerout', () => { container.alpha = 1; });
        root.addChild(container);
        return { container, plate, caption };
    }
    const buttons = [button('Orbit: on', actions.toggleOrbit), button('Lens: on', actions.toggleLens), button('Reset', actions.reset)];
    root.eventMode = 'static';
    let layout = portalLayout(1, 1);
    let elapsed = 0;
    let markerInFront = true;

    function resize(width: number, height: number) {
        layout = portalLayout(width, height);
        const { cx, cy, radius: r, lensRadius: lr, compact } = layout;
        root.hitArea = new Rectangle(0, 0, width, height);
        content.filterArea = new Rectangle(0, 0, width, height);
        background.clear().rect(0, 0, width, height).fill(0x07131d);
        for (let x = 22; x < width; x += 32) background.moveTo(x, 0).lineTo(x, height);
        for (let y = 16; y < height; y += 32) background.moveTo(0, y).lineTo(width, y);
        background.stroke({ color: 0x25404b, alpha: 0.36, width: 1 });
        for (let i = 0; i < 46; i++) {
            const x = ((i * 173 + 39) % 997) / 997 * width;
            const y = ((i * 227 + 71) % 991) / 991 * height;
            background.circle(x, y, i % 5 === 0 ? 1.4 : 0.7).fill({ color: 0x88b5b9, alpha: 0.6 });
        }
        backOrbit.clear().circle(cx, cy, r + 11).stroke({ color: 0x42686e, alpha: 0.5, width: 1 });
        orbit(backOrbit, 0, Math.PI * 2, cx, cy, r, 0x4a747a, 0.7);
        viewport.position.set(cx - r, cy - r);
        viewport.width = viewport.height = r * 2;
        mask.clear().circle(cx, cy, r).fill(0xffffff);
        mask.eventMode = 'none';
        foreground.clear().circle(cx, cy, r + 1).stroke({ color: 0x73c9bd, width: 1.5, alpha: 0.8 });
        orbit(foreground, 0, Math.PI, cx, cy, r, 0xc18c58, 0.85);
        foreground.moveTo(cx - r * 1.2, cy + r * 0.65).lineTo(cx - r * 0.72, cy + r * 0.65)
            .stroke({ color: 0x88c7c5, width: 1 });
        title.position.set(22, compact ? 12 : 18);
        title.style.fontSize = compact ? 15 : 20;
        subtitle.position.set(23, 45);
        subtitle.visible = !compact;
        sector.position.set(cx + r * 0.96, cy + r * 0.08);
        sector.style.fontSize = compact ? 8 : 10;
        portalHit.hitArea = new Circle(cx, cy, r);
        lens.hitArea = new Circle(0, 0, lr);
        rim.clear().circle(0, 0, lr).stroke({ color: 0xf2cc90, width: 2, alpha: 0.95 })
            .circle(0, 0, lr + 4).stroke({ color: 0xf2cc90, width: 1, alpha: 0.25 })
            .moveTo(Math.cos(Math.PI * 1.1) * (lr - 5), Math.sin(Math.PI * 1.1) * (lr - 5))
            .arc(0, 0, lr - 5, Math.PI * 1.1, Math.PI * 1.55).stroke({ color: 0xffffff, width: 1, alpha: 0.55 });
        lensLabel.position.set(0, lr + 10);
        lensLabel.visible = !compact;
        displacement.width = displacement.height = lr * 2;
        filter.scale.set(lr * 1.5);
        lens.position.set(layout.lensX, layout.lensY);
        const bw = Math.max(52, Math.min(110, (width - 94) / 3));
        const startX = compact ? 14 : (width - (bw * 3 + 16)) / 2;
        buttons.forEach(({ container, plate, caption }, i) => {
            container.position.set(startX + i * (bw + 8), height - 42);
            plate.clear().roundRect(0, 0, bw, 28, 5).fill(0x102632).stroke({ color: 0x34515a, width: 1 });
            caption.position.set(bw / 2, 14);
        });
    }
    function moveLens(x: number, y: number) {
        const r = layout.lensRadius;
        lens.position.set(Math.max(r, Math.min(layout.width - r, x)), Math.max(r, Math.min(layout.height - r, y)));
    }
    function update(dt: number, orbiting: boolean, lensEnabled: boolean) {
        elapsed += dt;
        displacement.position.copyFrom(lens.position);
        filter.enabled = lensEnabled;
        lens.visible = lensEnabled;
        buttons[0].caption.text = orbiting ? 'Orbit: on' : 'Orbit: off';
        buttons[1].caption.text = lensEnabled ? 'Lens: on' : 'Lens: off';
        const a = elapsed * 0.45;
        marker.position.set(layout.cx + Math.cos(a) * layout.radius * 1.25,
            layout.cy + Math.sin(a) * layout.radius * 0.32 + Math.cos(a) * layout.radius * 0.18);
        // A simple front/back orbit: the rear half belongs behind the portal.
        const inFront = Math.sin(a) >= 0;
        if (inFront !== markerInFront) {
            if (inFront) content.addChild(marker);
            else content.addChildAt(marker, content.getChildIndex(viewport));
            markerInFront = inFront;
        }
    }
    return { root, content, viewport, portalHit, lens, filter, resize, moveLens, update,
        get layout() { return layout; },
        resetLens() { lens.position.set(layout.lensX, layout.lensY); } };
}
function text(value: string, size: number, fill: number, weight: '400' | '600' = '400') {
    return new Text({ text: value, style: { fontFamily: 'Arial, sans-serif', fontSize: size, fill, fontWeight: weight, lineHeight: size * 1.5 } });
}
function orbit(g: Graphics, start: number, end: number, cx: number, cy: number, radius: number, color: number, alpha: number) {
    for (let i = 0; i <= 48; i++) {
        const a = start + (end - start) * i / 48;
        const x = cx + Math.cos(a) * radius * 1.25;
        const y = cy + Math.sin(a) * radius * 0.32 + Math.cos(a) * radius * 0.18;
        if (!i) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke({ color, alpha, width: 1.5 });
}