import { Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import type { Clip } from "./clips";
import { INTRO_FRAMES } from "./clips";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

export const PANEL_WIDTH = 1460;
export const PANEL_HEIGHT = Math.round((PANEL_WIDTH * 700) / 1200);

export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => (
  <AbsoluteFill
    style={{
      backgroundColor: "#0b0d14",
      backgroundImage:
        "radial-gradient(1200px 600px at 50% -10%, #1d2030 0%, #0b0d14 70%)",
      fontFamily:
        "ui-sans-serif, -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif",
      color: "#e6e8f0",
    }}
  >
    {children}
  </AbsoluteFill>
);

export const BrandChip: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 36,
      left: 48,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      fontSize: 26,
      color: "#a6a9c8",
      border: "1px solid #2a2d40",
      borderRadius: 10,
      padding: "8px 18px",
      backgroundColor: "#11131d",
    }}
  >
    roboto-mem
  </div>
);

// type, not interface: Remotion's Composition needs the implicit index
// signature that only type aliases get (assignability to Record<string, unknown>)
export type FeatureClipProps = { clip: Clip; rate?: number };

export const FeatureClip: React.FC<FeatureClipProps> = ({
  clip,
  rate = 1,
}) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, INTRO_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <Backdrop>
      <BrandChip />
      <div
        style={{
          position: "absolute",
          top: 44,
          width: "100%",
          textAlign: "center",
          opacity: appear,
          transform: `translateY(${(1 - appear) * 14}px)`,
        }}
      >
        <div style={{ fontSize: 54, fontWeight: 700, letterSpacing: -0.5 }}>
          {clip.title}
        </div>
        <div style={{ fontSize: 30, color: "#a6a9c8", marginTop: 10 }}>
          {clip.caption}
        </div>
      </div>
      <Sequence from={INTRO_FRAMES}>
        <AbsoluteFill
          style={{ justifyContent: "flex-end", alignItems: "center" }}
        >
          <Video
            src={staticFile(`clips/${clip.id}.mp4`)}
            playbackRate={rate}
            muted
            style={{
              width: PANEL_WIDTH,
              height: PANEL_HEIGHT,
              marginBottom: 36,
              borderRadius: 14,
              boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
            }}
          />
        </AbsoluteFill>
      </Sequence>
    </Backdrop>
  );
};
