import {
  computeDomainMatchScore,
  formatDomainTags,
  type DomainTagWeights,
} from '../transcripts/domainTags';

import type { OccupationScore } from './scoreOccupations';

export type DomainRerankMeta = {
  boost: number;
  tags: ReturnType<typeof formatDomainTags>;
};

export function rerankByDomainTags(params: {
  scores: OccupationScore[];
  titleByCode: Map<string, string>;
  tagWeights: DomainTagWeights;
  boost: number;
}): { results: OccupationScore[]; meta: DomainRerankMeta | null } {
  const { scores, titleByCode, tagWeights, boost } = params;
  if (!scores.length || tagWeights.size === 0 || boost <= 0) {
    return { results: scores, meta: null };
  }

  const reranked = scores
    .map((entry) => {
      const title = titleByCode.get(entry.onetCode) ?? null;
      const domainScore = computeDomainMatchScore(title, tagWeights);
      const boosted = entry.final * (1 + boost * domainScore);
      return { entry, boosted };
    })
    .sort((a, b) => b.boosted - a.boosted)
    .map((item) => item.entry);

  return {
    results: reranked,
    meta: {
      boost,
      tags: formatDomainTags(tagWeights),
    },
  };
}

