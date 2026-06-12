export interface Clip {
  id: string;
  title: string;
  caption: string;
}

export const FPS = 30;
export const INTRO_FRAMES = 15;
export const OUTRO_FRAMES = 20;

export const CLIPS: readonly Clip[] = [
  {
    id: "01-init-commons",
    title: "Scaffold the Commons",
    caption: "One command creates the team's shared memory repo — review gates and CI included.",
  },
  {
    id: "02-init-bind",
    title: "Bind a project",
    caption: "Stacks are detected from package.json; scopes decide which entries apply here.",
  },
  {
    id: "03-sync",
    title: "Sync",
    caption: "A teammate lands a Standard in the Commons; your next sync picks it up.",
  },
  {
    id: "04-sync-resilience",
    title: "Built for unreliable networks",
    caption: "Stale cache beats a hard failure — sessions keep working offline.",
  },
  {
    id: "05-status",
    title: "Status",
    caption: "Binding, scopes, entry counts, and freshness at a glance.",
  },
  {
    id: "06-digest",
    title: "The digest",
    caption: "Standards in full, overrides resolved, Lessons as a one-line index.",
  },
  {
    id: "07-digest-hook",
    title: "The Claude Code hook",
    caption: "The SessionStart envelope injected into every session.",
  },
  {
    id: "08-promote",
    title: "Promote",
    caption: "Note → validated entry → branch → PR. Nothing lands unreviewed.",
  },
  {
    id: "09-promote-scan",
    title: "The secret scan",
    caption: "Key material blocks promotion — and --force cannot bypass it.",
  },
  {
    id: "10-lint",
    title: "Lint in CI",
    caption: "The same checks on every Commons PR, findings printed redacted.",
  },
];

export const HERO_CLIP_IDS: readonly string[] = [
  "01-init-commons",
  "02-init-bind",
  "03-sync",
  "06-digest",
  "08-promote",
  "10-lint",
];

export const HERO_RATE = 1.4;
export const HERO_TRANSITION_FRAMES = 12;
export const HERO_TITLE_FRAMES = 75;
export const HERO_END_FRAMES = 105;

export interface HeroSegment {
  clip: Clip;
  durationInFrames: number;
}

export interface HeroLayout {
  segments: readonly HeroSegment[];
  totalFrames: number;
}

// Shared between calculateMetadata (composition duration) and the component
// (TransitionSeries layout) so the two can never drift apart.
export const heroLayout = (durations: Record<string, number>): HeroLayout => {
  const segments = HERO_CLIP_IDS.map((id) => {
    const clip = CLIPS.find((c) => c.id === id);
    if (!clip) throw new Error(`hero clip not in manifest: ${id}`);
    return {
      clip,
      durationInFrames: Math.ceil(((durations[id] ?? 0) * FPS) / HERO_RATE),
    };
  });
  const clipFrames = segments.reduce((sum, s) => sum + s.durationInFrames, 0);
  // Every transition overlaps two sequences, shortening the timeline.
  const transitions = segments.length + 1; // title->first, between clips, last->end
  return {
    segments,
    totalFrames:
      HERO_TITLE_FRAMES +
      clipFrames +
      HERO_END_FRAMES -
      transitions * HERO_TRANSITION_FRAMES,
  };
};
