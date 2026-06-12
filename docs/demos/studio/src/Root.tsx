import "./index.css";
import {
  type CalculateMetadataFunction,
  Composition,
  staticFile,
} from "remotion";
import {
  CLIPS,
  FPS,
  HERO_CLIP_IDS,
  heroLayout,
  INTRO_FRAMES,
  OUTRO_FRAMES,
} from "./clips";
import { videoDurationSeconds } from "./duration";
import { FeatureClip, type FeatureClipProps } from "./FeatureClip";
import { Hero, type HeroProps } from "./Hero";

const featureMetadata: CalculateMetadataFunction<FeatureClipProps> = async ({
  props,
}) => ({
  durationInFrames:
    Math.ceil(
      (await videoDurationSeconds(staticFile(`clips/${props.clip.id}.mp4`))) *
        FPS,
    ) +
    INTRO_FRAMES +
    OUTRO_FRAMES,
});

const heroMetadata: CalculateMetadataFunction<HeroProps> = async () => {
  const entries = await Promise.all(
    HERO_CLIP_IDS.map(
      async (id) =>
        [id, await videoDurationSeconds(staticFile(`clips/${id}.mp4`))] as const,
    ),
  );
  const durations = Object.fromEntries(entries);
  return {
    durationInFrames: heroLayout(durations).totalFrames,
    props: { durations },
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {CLIPS.map((clip) => (
        <Composition
          key={clip.id}
          id={`f-${clip.id}`}
          component={FeatureClip}
          fps={FPS}
          width={1920}
          height={1080}
          durationInFrames={INTRO_FRAMES + OUTRO_FRAMES + FPS}
          defaultProps={{ clip }}
          calculateMetadata={featureMetadata}
        />
      ))}
      <Composition
        id="hero"
        component={Hero}
        fps={FPS}
        width={1920}
        height={1080}
        durationInFrames={FPS}
        defaultProps={{ durations: {} }}
        calculateMetadata={heroMetadata}
      />
    </>
  );
};
