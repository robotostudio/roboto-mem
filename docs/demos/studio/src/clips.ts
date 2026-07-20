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
    caption: "One guided init creates the team's shared memory repo — review gates and CI included.",
  },
  {
    id: "02-init-libraries",
    title: "Bind with libraries",
    caption: "Libraries are auto-detected from package.json — confirm and go.",
  },
  {
    id: "03-migrate",
    title: "Migrate",
    caption: "configVersion 1 → 2 in one command — written beside your config, never over it.",
  },
  {
    id: "04-library-sync",
    title: "Libraries sync",
    caption: "Shared guides materialize locally; a teammate's edit arrives on the next sync.",
  },
  {
    id: "05-library-digest",
    title: "The digest",
    caption: "Global standards plus your declared libraries — nothing else.",
  },
  {
    id: "06-digest-hook",
    title: "The Claude Code hook",
    caption: "The SessionStart envelope injected into every session.",
  },
  {
    id: "07-promote",
    title: "Promote, guided",
    caption: "Answer the prompts; get a validated entry, a branch, and a PR.",
  },
  {
    id: "08-promote-scan",
    title: "The secret scan",
    caption: "Key material blocks promotion — and --force cannot bypass it.",
  },
  {
    id: "09-lint",
    title: "Lint in CI",
    caption: "The same checks on every Commons PR, findings printed redacted.",
  },
  {
    id: "10-promote-library",
    title: "Promote a library",
    caption: "Local edits become a reviewed PR on the Commons — branch, diff, URL.",
  },
  {
    id: "12-skill-add",
    title: "Team Skills — adopt once",
    caption: "A guided vendor: pinned at a commit, validated, scanned, PR'd.",
  },
  {
    id: "13-skill-sync",
    title: "Team Skills — everyone has it",
    caption: "Sync materializes merged skills into ~/.claude/skills for the whole team.",
  },
  {
    id: "14-sync-resilience",
    title: "Built for unreliable networks",
    caption: "Stale cache beats a hard failure — sessions keep working offline.",
  },
];

export const HERO_CLIP_IDS: readonly string[] = [
  "01-init-commons",
  "02-init-libraries",
  "04-library-sync",
  "05-library-digest",
  "07-promote",
  "10-promote-library",
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
