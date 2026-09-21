/** Deterministic motion adapted from Pixi's container_tinting example. */
export function createMotions() {
    let seed = 0x51f15e;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    return Array.from({ length: 20 }, () => ({
        x: random() * 2048, y: random() * 1024, scale: 1.7 + random() * 0.8,
        tint: Math.floor(random() * 0xffffff), direction: random() * Math.PI * 2,
        turning: (random() - 0.8) * 0.6, speed: 110 + random() * 100,
    }));
}
export function advanceMotions(motions: ReturnType<typeof createMotions>, dt: number) {
    if (dt === 0) return;
    for (const m of motions) {
        m.direction += m.turning * dt;
        m.x += Math.sin(m.direction) * m.speed * dt;
        m.y += Math.cos(m.direction) * m.speed * dt;
        m.x = ((m.x + 160) % 2368 + 2368) % 2368 - 160;
        m.y = ((m.y + 160) % 1344 + 1344) % 1344 - 160;
    }
}
