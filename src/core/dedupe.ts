export interface DedupeCandidate {
  name: string;
  description: string;
  body: string;
  file: string;
}

export interface SimilarMatch {
  candidate: DedupeCandidate;
  score: number;
}

export const SIMILARITY_THRESHOLD = 0.55;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "our",
  "we",
  "is",
  "are",
  "to",
  "of",
  "in",
  "for",
  "it",
  "with",
  "and",
  "or",
  "on",
]);

export const tokenize = (text: string): Set<string> => {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  return new Set(tokens);
};

export const similarity = (a: string, b: string): number => {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
};

const draftText = (draft: {
  name: string;
  description: string;
  body: string;
}): string => `${draft.name} ${draft.description} ${draft.body}`;

export const findSimilar = (
  draft: { name: string; description: string; body: string },
  candidates: DedupeCandidate[],
): SimilarMatch[] =>
  candidates
    .map((candidate) => ({
      candidate,
      score: similarity(draftText(draft), draftText(candidate)),
    }))
    .filter(({ score }) => score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score);
