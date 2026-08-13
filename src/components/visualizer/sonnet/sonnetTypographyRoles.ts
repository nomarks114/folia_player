import { normalizeFontWeight } from '../../../utils/fontStacks';
import type { SonnetSemanticSegment } from './types';

// src/components/visualizer/sonnet/sonnetTypographyRoles.ts
// Selects deterministic typography emphasis roles without coupling them to a layout template.
export type SonnetSegmentRole = 'hero' | 'semi-hero' | 'support' | 'decoration';

export const isSonnetEmphasisRole = (role: SonnetSegmentRole) => (
    role === 'hero' || role === 'semi-hero'
);

/** Uses Sonnet's designed role weights in auto mode, or the user's global manual override. */
export const resolveSonnetRoleFontWeight = (
    configuredFontWeight: number | null | undefined,
    role: SonnetSegmentRole,
) => {
    const manualWeight = normalizeFontWeight(configuredFontWeight);
    if (manualWeight !== null) return manualWeight;
    if (isSonnetEmphasisRole(role)) return 900;
    return role === 'decoration' ? 300 : 700;
};

export const getSonnetVisibleSegmentLength = (segment: SonnetSemanticSegment) => (
    segment.graphemes.filter(item => item.char.trim().length > 0).length
);

// --- Foreign-language hero priority ---
// When lyrics are predominantly one script (e.g. CJK) but contain words in
// another script (e.g. Latin), those foreign-script words are visually striking
// and should be prioritised as hero / semi-hero candidates.

const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const LATIN_RE = /[a-zA-Z\u00C0-\u024F]/;

/** Returns 'cjk', 'latin', or null when the text has no dominant script. */
const classifyScript = (text: string): 'cjk' | 'latin' | null => {
    let cjk = 0;
    let latin = 0;
    for (const ch of text) {
        if (CJK_RE.test(ch)) cjk++;
        else if (LATIN_RE.test(ch)) latin++;
    }
    if (cjk === 0 && latin === 0) return null;
    return cjk >= latin ? 'cjk' : 'latin';
};

/**
 * Detects the majority script across all segments, then flags individual
 * segments whose script differs from the majority as "foreign-language".
 */
const detectForeignLanguageSegments = (
    segments: SonnetSemanticSegment[],
): Set<number> => {
    let cjkTotal = 0;
    let latinTotal = 0;
    // First pass: tally characters across all word-like segments
    for (const seg of segments) {
        if (!seg.isWordLike) continue;
        for (const ch of seg.text) {
            if (CJK_RE.test(ch)) cjkTotal++;
            else if (LATIN_RE.test(ch)) latinTotal++;
        }
    }
    if (cjkTotal === 0 || latinTotal === 0) return new Set(); // single-script lyrics
    const majorityScript: 'cjk' | 'latin' = cjkTotal >= latinTotal ? 'cjk' : 'latin';
    const foreign = new Set<number>();
    // Second pass: mark segments whose dominant script differs from majority
    segments.forEach((seg, index) => {
        if (!seg.isWordLike) return;
        const segScript = classifyScript(seg.text);
        if (segScript !== null && segScript !== majorityScript) {
            foreign.add(index);
        }
    });
    return foreign;
};

export const scoreSonnetHeroSegment = (segment: SonnetSemanticSegment, isForeignLanguage?: boolean) => {
    const lengthScore = Math.min(getSonnetVisibleSegmentLength(segment), 8) * 14;
    const durationScore = Math.min(2.5, Math.max(0, segment.endTime - segment.startTime)) * 18;
    // Foreign-language words get a strong boost so they are preferred as hero
    const foreignBonus = isForeignLanguage ? 60 : 0;
    return lengthScore + durationScore + foreignBonus;
};

export const findSonnetHeroSegmentIndex = (
    segments: SonnetSemanticSegment[],
) => {
    const foreignSet = detectForeignLanguageSegments(segments);
    let bestIndex = segments.findIndex(segment => segment.isWordLike);
    let bestScore = -Infinity;
    segments.forEach((segment, index) => {
        if (!segment.isWordLike || getSonnetVisibleSegmentLength(segment) === 0) return;
        const score = scoreSonnetHeroSegment(segment, foreignSet.has(index));
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });
    return Math.max(0, bestIndex);
};

// Semi-hero constraints: emphasis words need spacing, real words beat particles,
// and only long enough lines earn secondary accents at all.
const SEMI_HERO_MIN_GAP = 2;
const SEMI_HERO_MIN_VISIBLE_LENGTH = 2;
const SEMI_HERO_MIN_LINE_WORDS = 4;
const SEMI_HERO_SCORE_RATIO = 0.35;
const SEMI_HERO_MULTI_WORD_COUNT = 9;

// Picks secondary emphasis words on the side opposite the hero's lean so the
// composition stays balanced; long lines earn a second accent on the other side.
export const findSonnetSemiHeroSegmentIndices = (
    segments: SonnetSemanticSegment[],
    heroIndex: number,
) => {
    const hero = segments[heroIndex];
    if (!hero) return [];
    const foreignSet = detectForeignLanguageSegments(segments);
    const wordLikeCount = segments.filter(segment => (
        segment.isWordLike && getSonnetVisibleSegmentLength(segment) > 0
    )).length;
    if (wordLikeCount < SEMI_HERO_MIN_LINE_WORDS) return [];

    const threshold = scoreSonnetHeroSegment(hero, foreignSet.has(heroIndex)) * SEMI_HERO_SCORE_RATIO;
    const candidates = segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment, index }) => (
            index !== heroIndex
            && segment.isWordLike
            && getSonnetVisibleSegmentLength(segment) >= SEMI_HERO_MIN_VISIBLE_LENGTH
            && Math.abs(index - heroIndex) >= SEMI_HERO_MIN_GAP
            && scoreSonnetHeroSegment(segment, foreignSet.has(index)) >= threshold
        ));
    if (candidates.length === 0) return [];

    const bestOf = (list: typeof candidates) => list.reduce<typeof candidates[number] | null>(
        (best, item) => (
            !best || scoreSonnetHeroSegment(item.segment, foreignSet.has(item.index)) > scoreSonnetHeroSegment(best.segment, foreignSet.has(best.index))
                ? item
                : best
        ),
        null,
    );

    const heroLeansEarly = heroIndex <= (segments.length - 1) / 2;
    const primarySide = candidates.filter(({ index }) => (
        heroLeansEarly ? index > heroIndex : index < heroIndex
    ));
    const secondarySide = candidates.filter(({ index }) => (
        heroLeansEarly ? index < heroIndex : index > heroIndex
    ));

    const picks: number[] = [];
    const primary = bestOf(primarySide) ?? bestOf(secondarySide);
    if (primary) picks.push(primary.index);
    if (wordLikeCount >= SEMI_HERO_MULTI_WORD_COUNT && primary) {
        const secondary = bestOf(secondarySide.filter(({ index }) => (
            Math.abs(index - primary.index) >= SEMI_HERO_MIN_GAP
        )));
        if (secondary) picks.push(secondary.index);
    }
    return picks.sort((first, second) => first - second);
};

export const findSonnetSemiHeroSegmentIndex = (
    segments: SonnetSemanticSegment[],
    heroIndex: number,
) => findSonnetSemiHeroSegmentIndices(segments, heroIndex)[0] ?? -1;
