import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import {
  HERO_END_FRAMES,
  HERO_RATE,
  HERO_TITLE_FRAMES,
  HERO_TRANSITION_FRAMES,
  heroLayout,
} from "./clips";
import { Backdrop, BrandChip, FeatureClip } from "./FeatureClip";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

const fadeUp = (frame: number) => ({
  opacity: interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  }),
  transform: `translateY(${
    (1 -
      interpolate(frame, [0, 20], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: EASE,
      })) *
    18
  }px)`,
});

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Backdrop>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ textAlign: "center", ...fadeUp(frame) }}>
          <div
            style={{
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontSize: 96,
              fontWeight: 700,
              letterSpacing: -2,
            }}
          >
            roboto-mem
          </div>
          <div style={{ fontSize: 40, color: "#a6a9c8", marginTop: 18 }}>
            Team Memory for Claude Code — synced into every session
          </div>
          <div style={{ fontSize: 28, color: "#6f7390", marginTop: 14 }}>
            Standards · Lessons · Libraries
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const mono = {
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: 34,
    color: "#cdd2ec",
    backgroundColor: "#11131d",
    border: "1px solid #2a2d40",
    borderRadius: 12,
    padding: "14px 28px",
    marginTop: 18,
  } as const;
  return (
    <Backdrop>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            ...fadeUp(frame),
          }}
        >
          <div style={{ fontSize: 64, fontWeight: 700, marginBottom: 16 }}>
            Give your team a memory.
          </div>
          <div style={mono}>/plugin marketplace add robotostudio/roboto-mem</div>
          <div style={mono}>npm i -g roboto-mem</div>
          <div style={{ fontSize: 28, color: "#6f7390", marginTop: 26 }}>
            github.com/robotostudio/roboto-mem
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

export type HeroProps = { durations: Record<string, number> };

export const Hero: React.FC<HeroProps> = ({ durations }) => {
  const { segments } = heroLayout(durations);
  // Before calculateMetadata injects real durations (e.g. raw defaultProps),
  // zero-length sequences would crash TransitionSeries.
  if (segments.some((s) => s.durationInFrames <= 0)) {
    return (
      <Backdrop>
        <BrandChip />
      </Backdrop>
    );
  }

  const transition = (
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: HERO_TRANSITION_FRAMES })}
    />
  );

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={HERO_TITLE_FRAMES}>
        <TitleCard />
      </TransitionSeries.Sequence>
      {segments.flatMap((segment) => [
        <TransitionSeries.Transition
          key={`t-${segment.clip.id}`}
          presentation={fade()}
          timing={linearTiming({ durationInFrames: HERO_TRANSITION_FRAMES })}
        />,
        <TransitionSeries.Sequence
          key={segment.clip.id}
          durationInFrames={segment.durationInFrames}
        >
          <FeatureClip clip={segment.clip} rate={HERO_RATE} />
        </TransitionSeries.Sequence>,
      ])}
      {transition}
      <TransitionSeries.Sequence durationInFrames={HERO_END_FRAMES}>
        <EndCard />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
