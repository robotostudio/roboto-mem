import { ALL_FORMATS, Input, UrlSource } from "mediabunny";

export const videoDurationSeconds = async (url: string): Promise<number> => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(url, { getRetryDelay: () => null }),
  });
  return input.computeDuration();
};
