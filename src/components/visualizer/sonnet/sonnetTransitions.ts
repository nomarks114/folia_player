import {
    SONNET_TRANSITION_KINDS,
    type SonnetParagraph,
    type SonnetShot,
    type SonnetTransitionKind,
} from './types';
import { clamp01, easeSonnetInOut, resolveShotPanDirection } from './sonnetMotion';

// src/components/visualizer/sonnet/sonnetTransitions.ts
// Resolves fast, seek-stable monochrome scene transitions without chromatic dispersion.
export interface SonnetSceneTransitionFrame {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    alpha: number;
    blur: number;
    glitch: number;
    glitchSeed: number;
}

export const IDLE_SONNET_TRANSITION_FRAME: SonnetSceneTransitionFrame = {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    alpha: 1,
    blur: 0,
    glitch: 0,
    glitchSeed: 0,
};

const resolveBoundaryKind = (seed: number, boundaryIndex: number): SonnetTransitionKind => {
    const mixed = (seed ^ Math.imul(boundaryIndex + 1, 0x9e3779b1)) >>> 0;
    return SONNET_TRANSITION_KINDS[mixed % SONNET_TRANSITION_KINDS.length];
};

export const resolveSonnetTransitionEffectFrame = (
    kind: SonnetTransitionKind,
    phase: 'enter' | 'exit',
    progress: number,
    seed: number,
    panDirection?: { x: number; y: number } | null,
): SonnetSceneTransitionFrame => {
    const linear = clamp01(progress);
    const eased = easeSonnetInOut(linear);
    const amount = phase === 'exit' ? eased : 1 - eased;

    if (kind === 'fast-blur') {
        return {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            alpha: phase === 'exit' ? 1 - amount : 1 - amount * 0.82,
            blur: amount * 14,
            glitch: 0,
            glitchSeed: 0,
        };
    }

    if (kind === 'mono-glitch') {
        const step = Math.floor(linear * 14);
        return {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            alpha: phase === 'exit' && linear > 0.86
                ? 1 - (linear - 0.86) / 0.14
                : 1,
            blur: 0,
            glitch: amount,
            glitchSeed: seed * 0.0001 + step * 0.173,
        };
    }

    if (kind === 'zoom-dip') {
        // Quick camera push: scale up with a slight rotation nudge, then settle.
        // Exit: rotation direction follows horizontal pan; Enter: seed-based.
        const direction = (phase === 'exit' && panDirection)
            ? (panDirection.x >= 0 ? 1 : -1)
            : (seed > 0.5 ? 1 : -1);
        return {
            x: 0,
            y: 0,
            scale: 1 + amount * 0.08,
            rotation: direction * amount * 0.02,
            alpha: phase === 'exit' ? 1 - amount * 0.9 : 1 - amount * 0.6,
            blur: amount * 2,
            glitch: 0,
            glitchSeed: 0,
        };
    }

    if (kind === 'slide-sweep') {
        // Horizontal page-sweep with directional blur.
        // Exit: sweep follows horizontal pan direction; Enter: seed-based.
        const direction = (phase === 'exit' && panDirection)
            ? (panDirection.x >= 0 ? 1 : -1)
            : (seed > 0.5 ? 1 : -1);
        return {
            x: direction * amount * 0.06,
            y: 0,
            scale: 1,
            rotation: 0,
            alpha: phase === 'exit' ? 1 - amount * 0.85 : 1 - amount * 0.5,
            blur: amount * 5,
            glitch: 0,
            glitchSeed: 0,
        };
    }

    if (kind === 'shutter-slice') {
        // Vertical film-strip slide with subtle scale contraction.
        // Exit: slice follows vertical pan direction; Enter: seed-based.
        const direction = (phase === 'exit' && panDirection)
            ? (panDirection.y >= 0 ? 1 : -1)
            : (seed > 0.5 ? 1 : -1);
        return {
            x: 0,
            y: direction * amount * 0.04,
            scale: 1 - amount * 0.03,
            rotation: 0,
            alpha: phase === 'exit' ? 1 - amount * 0.88 : 1 - amount * 0.55,
            blur: amount * 1.5,
            glitch: 0,
            glitchSeed: 0,
        };
    }

    if (kind === 'dissolve-fade') {
        // Gentle cross-dissolve with subtle scale breathing and light blur.
        return {
            x: 0,
            y: 0,
            scale: 1 + amount * 0.025,
            rotation: 0,
            alpha: phase === 'exit' ? 1 - amount : 1 - amount * 0.7,
            blur: amount * 3,
            glitch: 0,
            glitchSeed: 0,
        };
    }

    // camera-pull fallback
    return {
        x: 0,
        y: 0,
        // Scene filters use a viewport-sized render surface, so transition scaling exposes its bounds.
        scale: 1,
        rotation: 0,
        alpha: phase === 'exit' ? 1 - amount : 1 - amount * 0.72,
        blur: 0,
        glitch: 0,
        glitchSeed: 0,
    };
};

export const resolveSonnetExitTransitionFrame = (
    paragraph: SonnetParagraph,
    time: number,
    enabled: boolean,
    seed: number,
) => {
    const transition = paragraph.transitionOut;
    if (!enabled || !transition || time < transition.startTime) return IDLE_SONNET_TRANSITION_FRAME;
    const progress = (time - transition.startTime) / Math.max(transition.endTime - transition.startTime, 0.001);
    // Derive pan direction from the paragraph's last shot so the exit
    // transition sweeps in the same direction the camera was panning.
    const lastShot = paragraph.shots[paragraph.shots.length - 1];
    const panDirection = lastShot ? resolveShotPanDirection(lastShot.kind) : null;
    return resolveSonnetTransitionEffectFrame(transition.kind, 'exit', progress, seed, panDirection);
};

export const resolveSonnetEnterTransitionFrame = (
    kind: SonnetTransitionKind | null,
    timeSinceStart: number,
    duration: number,
    enabled: boolean,
    seed: number,
) => {
    if (!enabled || !kind || timeSinceStart < 0 || timeSinceStart > duration) {
        return IDLE_SONNET_TRANSITION_FRAME;
    }
    return resolveSonnetTransitionEffectFrame(kind, 'enter', timeSinceStart / Math.max(duration, 0.001), seed);
};

// Gives every layout boundary a short transition; paragraphs commonly contain several shots.
export const resolveSonnetShotTransitionFrame = (
    shots: SonnetShot[],
    activeShotIndex: number,
    time: number,
    enabled: boolean,
    seed: number,
) => {
    if (!enabled || shots.length < 2) return IDLE_SONNET_TRANSITION_FRAME;
    const current = shots[activeShotIndex];
    if (!current) return IDLE_SONNET_TRANSITION_FRAME;

    if (activeShotIndex > 0) {
        const previous = shots[activeShotIndex - 1];
        const duration = Math.min(0.24, Math.max(0.14, (current.startTime - previous.startTime) * 0.18));
        if (time <= current.startTime + duration) {
            return resolveSonnetEnterTransitionFrame(
                resolveBoundaryKind(seed, activeShotIndex - 1),
                time - current.startTime,
                duration,
                true,
                seed + activeShotIndex * 97,
            );
        }
    }

    const next = shots[activeShotIndex + 1];
    if (!next) return IDLE_SONNET_TRANSITION_FRAME;
    const duration = Math.min(0.24, Math.max(0.14, (next.startTime - current.startTime) * 0.18));
    const transitionStart = next.startTime - duration;
    if (time < transitionStart) return IDLE_SONNET_TRANSITION_FRAME;
    // Exit direction follows the current shot's camera pan — "摇到哪切到哪".
    const exitPanDirection = resolveShotPanDirection(current.kind);
    return resolveSonnetTransitionEffectFrame(
        resolveBoundaryKind(seed, activeShotIndex),
        'exit',
        (time - transitionStart) / duration,
        seed + (activeShotIndex + 1) * 97,
        exitPanDirection,
    );
};
