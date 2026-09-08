import smallIni from './presets/small.ini?raw';
import mediumIni from './presets/medium.ini?raw';
import largeIni from './presets/large.ini?raw';
import type { Particles4AllPreset, Particles4AllSceneOverrides, Particles4AllSettings } from './particles4allTypes';
// @ts-expect-error Vendored JavaScript remains directly comparable with upstream.
import { defaultParams } from './upstream/scene.js';
// @ts-expect-error Vendored JavaScript remains directly comparable with upstream.
import { parseIni } from './upstream/settingsini.js';

const PRESET_INI: Record<Particles4AllPreset, string> = { small: smallIni, medium: mediumIni, large: largeIni };

// Defaults from pinned main.js and the native renderer constructors. Preset tuning
// belongs exclusively in the original INI files, applied over these fallback values.
const DEFAULT_SETTINGS: Particles4AllSettings = {
    preset: 'small', displayMode: 'particles', paused: false, timeScale: 1,
    particleRadius: 0.5, speedMax: 3, boxScaleX: 1,
    substeps: 4, iterations: 4, cfm: 0.01, omega: 1, sorAverage: false,
    xsph: 0.05, scorr: 0.1, scorrDq: 0.3, tension: 0, gravity: 9.81,
    forceEnabled: true, forceRadius: 0.12, forceStrength: 30, forceLimit: 4,
    cameraSpeed: 1, rigidBodiesEnabled: true, grabEnabled: false, grabStrength: 10,
    pourSpeed: 3, pourWidth: 0.24, pourHeight: 0.85, pourTilt: 0,
    meshResolution: 128, meshIso: 0.4, fieldSmooth: 0, normalSmooth: 2,
    anisotropyRatio: 4, anisotropyLambda: 0.9, anisotropyNeighbours: 25,
    anisotropyLonely: 1, anisotropyRadius: 2, anisotropyStretch: 2, anisotropyKs: 1,
    raySurface: 'mesh', rayDebug: 0, rayThicknessSteps: 48,
    ior: 1.333, absorption: 1, transmission: [0.35, 0.62, 0.78], roughness: 0.055,
    exposure: 1, sunIntensity: 3, sunElevation: 38, sunAzimuth: 40, groundReflection: 0,
    ssfrScale: 1, ssfrDebug: 0, ssfrRadius: 1, ssfrFilter: 2, ssfrIterations: 2,
    ssfrSigma: 0.7, ssfrDelta: 10, ssfrMu: 1, ssfrBilateralRange: 2, ssfrCleanupPass: true,
    ssfrThicknessRadius: 0.62, ssfrThicknessScale: 3, ssfrThicknessBlur: 8, ssfrDepthCull: 0,
    environmentIntensity: 1, environmentYawDegrees: 0, floorPlane: true,
};

type KeysOfType<T> = { [K in keyof Particles4AllSettings]: Particles4AllSettings[K] extends T ? K : never }[keyof Particles4AllSettings];
const NUMERIC_KEYS: Record<string, KeysOfType<number>> = {
    substeps: 'substeps', iterations: 'iterations', cfm: 'cfm', omega: 'omega', xsph: 'xsph',
    scorrk: 'scorr', scorrdq: 'scorrDq', tension: 'tension', gravity: 'gravity',
    timescale: 'timeScale', renderradius: 'particleRadius', colorspeedmax: 'speedMax',
    meshres: 'meshResolution', meshiso: 'meshIso', fieldsmooth: 'fieldSmooth', normalsmooth: 'normalSmooth',
    anisoratio: 'anisotropyRatio', anisolambda: 'anisotropyLambda', anisonbrs: 'anisotropyNeighbours',
    anisolonely: 'anisotropyLonely', anisoradius: 'anisotropyRadius', anisostretch: 'anisotropyStretch', anisoks: 'anisotropyKs',
    thicksteps: 'rayThicknessSteps', ior: 'ior', absorption: 'absorption', roughness: 'roughness',
    groundreflection: 'groundReflection', sunintensity: 'sunIntensity', sunelev: 'sunElevation', sunazim: 'sunAzimuth', exposure: 'exposure',
    ssfrscale: 'ssfrScale', ssfrradius: 'ssfrRadius', ssfriters: 'ssfrIterations', ssfrfilter: 'ssfrFilter',
    ssfrsigma: 'ssfrSigma', ssfrdelta: 'ssfrDelta', ssfrmu: 'ssfrMu', ssfrrange: 'ssfrBilateralRange',
    ssfrthickr: 'ssfrThicknessRadius', ssfrthick: 'ssfrThicknessScale', ssfrthickblur: 'ssfrThicknessBlur', ssfrdepthcull: 'ssfrDepthCull',
    hoverradius: 'forceRadius', hoverstrength: 'forceStrength', hoverlimit: 'forceLimit', grabstrength: 'grabStrength',
    pourspeed: 'pourSpeed', pourwidth: 'pourWidth', pourheight: 'pourHeight', pourtilt: 'pourTilt',
    cubemapintensity: 'environmentIntensity', cubemapyaw: 'environmentYawDegrees',
};
const BOOLEAN_KEYS: Record<string, KeysOfType<boolean>> = {
    soraverage: 'sorAverage', hover: 'forceEnabled', ssfrcleanup: 'ssfrCleanupPass', floorplane: 'floorPlane',
};

function finiteNumber(text: string, key: string): number {
    // Reject empty, hexadecimal, partial numeric strings, Infinity, and NaN.
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) || !Number.isFinite(Number(text))) {
        throw new Error(`Particles4All INI ${key} must be a finite decimal number.`);
    }
    return Number(text);
}

function vector(text: string, key: string, lengths: readonly number[]): number[] {
    const values = text.trim().split(/[ ,]+/).map(value => finiteNumber(value, key));
    if (!lengths.includes(values.length)) throw new Error(`Particles4All INI ${key} must contain ${lengths.join(' or ')} numbers.`);
    return values;
}

export interface ImportedParticles4AllSettings {
    readonly settings: Particles4AllSettings;
    readonly sceneOverrides: Particles4AllSceneOverrides;
    readonly skipped: readonly string[];
    readonly missingPanorama: string | null;
}

function applyIni(text: string, base: Particles4AllSettings, baseScene: Particles4AllSceneOverrides): ImportedParticles4AllSettings {
    const settings = { ...base, transmission: [...base.transmission] as [number, number, number] };
    const sceneOverrides = { ...baseScene };
    const skipped: string[] = [];
    let missingPanorama: string | null = null;
    const values = parseIni(text) as Record<string, string>;
    for (const [key, value] of Object.entries(values)) {
        const numericKey = Object.hasOwn(NUMERIC_KEYS, key) ? NUMERIC_KEYS[key] : undefined;
        if (numericKey) {
            const parsed = finiteNumber(value, key);
            if (numericKey === 'ssfrFilter') {
                if (parsed !== 0 && parsed !== 1 && parsed !== 2) throw new Error('Particles4All INI ssfrfilter must be 0, 1, or 2.');
                settings.ssfrFilter = parsed;
            } else settings[numericKey] = parsed;
            continue;
        }
        const booleanKey = Object.hasOwn(BOOLEAN_KEYS, key) ? BOOLEAN_KEYS[key] : undefined;
        if (booleanKey) {
            if (value !== '0' && value !== '1') throw new Error(`Particles4All INI ${key} must be 0 or 1.`);
            settings[booleanKey] = value === '1';
            continue;
        }
        switch (key) {
            case 'display': {
                const display = finiteNumber(value, key);
                const modes = ['particles', 'surface-mesh', 'surface-mesh', 'ray-march', 'ssfr'] as const;
                if (!Number.isInteger(display) || !modes[display]) throw new Error('Particles4All INI display must be an integer in [0, 4].');
                settings.displayMode = modes[display]!;
                break;
            }
            case 'raysurface':
                if (value !== '0' && value !== '1') throw new Error('Particles4All INI raysurface must be 0 or 1.');
                settings.raySurface = value === '0' ? 'field' : 'mesh';
                break;
            case 'transmit': settings.transmission = vector(value, key, [3]) as [number, number, number]; break;
            case 'box': sceneOverrides.box = vector(value, key, [3]) as [number, number, number]; break;
            case 'camera': sceneOverrides.camera = vector(value, key, [3, 6]) as Particles4AllSceneOverrides['camera']; break;
            case 'particles': sceneOverrides.targetParticleCount = finiteNumber(value, key); break;
            case 'spacing': sceneOverrides.spacing = finiteNumber(value, key); break;
            case 'bodysize': sceneOverrides.bodySize = finiteNumber(value, key); break;
            case 'body':
                sceneOverrides.bodies = value ? value.split(',').map(item => item.trim()) : [];
                settings.rigidBodiesEnabled = Boolean(value);
                break;
            case 'cubemap':
                // A file name is informational; imported INI never initiates network access.
                missingPanorama = value.replace(/^"|"$/g, '').split(/[\\/]/).pop() || null;
                break;
            default: skipped.push(key);
        }
    }
    if (Object.keys(values).length === skipped.length) throw new Error('Particles4All INI contains no recognized settings.');
    return { settings: validateParticles4AllSettings(settings), sceneOverrides: validateSceneOverrides(sceneOverrides), skipped, missingPanorama };
}

function presetValues(preset: Particles4AllPreset): ImportedParticles4AllSettings {
    if (!Object.hasOwn(PRESET_INI, preset)) throw new Error('Particles4All preset is invalid.');
    const native = defaultParams(preset) as Required<Pick<Particles4AllSceneOverrides, 'targetParticleCount' | 'spacing' | 'box' | 'bodies' | 'bodySize'>>;
    return applyIni(PRESET_INI[preset], { ...DEFAULT_SETTINGS, preset }, {
        targetParticleCount: native.targetParticleCount, spacing: native.spacing, box: native.box,
        bodies: native.bodies, bodySize: native.bodySize,
    });
}

export function createPresetSettings(preset: Particles4AllPreset): Particles4AllSettings {
    return presetValues(preset).settings;
}

export function getPresetScene(preset: Particles4AllPreset): Particles4AllSceneOverrides {
    return presetValues(preset).sceneOverrides;
}

export function parseImportedSettings(text: string, preset: Particles4AllPreset = 'small'): ImportedParticles4AllSettings {
    const base = presetValues(preset);
    return applyIni(text, base.settings, base.sceneOverrides);
}

export function validateSceneOverrides(overrides: Particles4AllSceneOverrides): Particles4AllSceneOverrides {
    const result: Particles4AllSceneOverrides = {};
    if (overrides.targetParticleCount !== undefined) {
        if (!Number.isInteger(overrides.targetParticleCount)
            || overrides.targetParticleCount < 1
            || overrides.targetParticleCount > 1_000_000) {
            throw new Error('Particles4All targetParticleCount must be an integer in [1, 1000000].');
        }
        result.targetParticleCount = overrides.targetParticleCount;
    }
    if (overrides.spacing !== undefined) {
        if (!Number.isFinite(overrides.spacing) || overrides.spacing < 0.005 || overrides.spacing > 0.2) {
            throw new Error('Particles4All spacing must be in [0.005, 0.2].');
        }
        result.spacing = overrides.spacing;
    }
    if (overrides.box !== undefined) {
        if (overrides.box.length !== 3 || overrides.box.some(
            value => !Number.isFinite(value) || value < 0.1 || value > 20,
        )) {
            throw new Error('Particles4All box must contain three values in [0.1, 20].');
        }
        result.box = [...overrides.box];
    }
    if (overrides.bodies !== undefined) {
        if (overrides.bodies.length > 64 || overrides.bodies.some(value => {
            const [shape, density, height, extra] = value.split(':');
            return !['box', 'sphere', 'torus'].includes(shape ?? '') || extra !== undefined
                || (density !== undefined && (!density.trim() || !Number.isFinite(Number(density)) || Number(density) <= 0))
                || (height !== undefined && (!height.trim() || !Number.isFinite(Number(height)) || Number(height) <= 0 || Number(height) > 1));
        })) {
            throw new Error('Particles4All bodies must contain at most 64 box, sphere, or torus specifications with positive density and optional height in (0, 1].');
        }
        result.bodies = overrides.bodies.slice();
    }
    if (overrides.bodySize !== undefined) {
        if (!Number.isFinite(overrides.bodySize) || overrides.bodySize < 0 || overrides.bodySize > 10) {
            throw new Error('Particles4All bodySize must be in [0, 10].');
        }
        result.bodySize = overrides.bodySize;
    }
    if (overrides.camera !== undefined) {
        if ((overrides.camera.length !== 3 && overrides.camera.length !== 6)
            || overrides.camera.some(value => !Number.isFinite(value))
            || overrides.camera[2] <= 0) {
            throw new Error('Particles4All camera must contain three or six finite values with positive distance.');
        }
        result.camera = [...overrides.camera] as Particles4AllSceneOverrides['camera'];
    }
    return result;
}

export function validateParticles4AllSettings(settings: Particles4AllSettings): Particles4AllSettings {
    for (const key of ['paused', 'sorAverage', 'forceEnabled', 'rigidBodiesEnabled', 'grabEnabled', 'ssfrCleanupPass', 'floorPlane'] as const) {
        if (typeof settings[key] !== 'boolean') throw new Error(`Particles4All ${key} must be a boolean.`);
    }
    const ranges: Partial<Record<keyof Particles4AllSettings, readonly [number, number]>> = {
        timeScale: [0.01, 2], particleRadius: [0.01, 4], speedMax: [0.01, 100], boxScaleX: [0.5, 2],
        substeps: [1, 8], iterations: [1, 10], cfm: [1e-6, 1], omega: [0.1, 4], xsph: [0, 2],
        scorr: [0, 2], scorrDq: [0.01, 1], tension: [0, 10], gravity: [0, 100],
        forceRadius: [0, 4], forceStrength: [0, 1_000], forceLimit: [0, 100], cameraSpeed: [0.25, 6],
        grabStrength: [0, 100],
        pourSpeed: [0.01, 100], pourWidth: [0.001, 10], pourHeight: [0, 1], pourTilt: [-89, 89],
        meshResolution: [48, 512], meshIso: [0.001, 10], fieldSmooth: [0, 16], normalSmooth: [0, 16],
        anisotropyRatio: [1, 16], anisotropyLambda: [0, 1], anisotropyNeighbours: [1, 128],
        anisotropyLonely: [0, 4], anisotropyRadius: [1, 8], anisotropyStretch: [1, 16], anisotropyKs: [0.01, 16],
        rayDebug: [0, 6], rayThicknessSteps: [1, 256], ior: [1, 4], absorption: [0, 100], roughness: [0, 1], exposure: [0, 20],
        sunIntensity: [0, 100], sunElevation: [-90, 90], sunAzimuth: [-360, 360], groundReflection: [0, 1],
        ssfrScale: [0.25, 1], ssfrDebug: [0, 5], ssfrRadius: [0.01, 8], ssfrFilter: [0, 2], ssfrIterations: [0, 16],
        ssfrSigma: [0.001, 20], ssfrDelta: [0, 100], ssfrMu: [0, 20], ssfrBilateralRange: [0.001, 100],
        ssfrThicknessRadius: [0.01, 8],
        ssfrThicknessScale: [0, 100], ssfrThicknessBlur: [0, 64], ssfrDepthCull: [0, 1],
        environmentIntensity: [0, 20], environmentYawDegrees: [-360, 360],
    };
    for (const [name, range] of Object.entries(ranges) as Array<[
        keyof Particles4AllSettings,
        readonly [number, number],
    ]>) {
        const value = settings[name];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) {
            throw new Error(`Particles4All ${name} must be in [${range[0]}, ${range[1]}].`);
        }
    }
    for (const name of [
        'substeps', 'iterations', 'meshResolution', 'fieldSmooth', 'normalSmooth', 'anisotropyNeighbours',
        'rayDebug', 'rayThicknessSteps', 'ssfrDebug', 'ssfrFilter', 'ssfrIterations', 'ssfrThicknessBlur',
    ] as const) {
        if (!Number.isInteger(settings[name])) throw new Error(`Particles4All ${name} must be an integer.`);
    }
    if (!['small', 'medium', 'large'].includes(settings.preset)) throw new Error('Particles4All preset is invalid.');
    if (!['particles', 'surface-mesh', 'ray-march', 'ssfr'].includes(settings.displayMode)) {
        throw new Error('Particles4All displayMode is invalid.');
    }
    if (settings.raySurface !== 'mesh' && settings.raySurface !== 'field') {
        throw new Error('Particles4All raySurface is invalid.');
    }
    if (settings.transmission.length !== 3 || settings.transmission.some(
        value => !Number.isFinite(value) || value < 0 || value > 1,
    )) {
        throw new Error('Particles4All transmission must contain three values in [0, 1].');
    }
    return { ...settings, transmission: [...settings.transmission] };
}
