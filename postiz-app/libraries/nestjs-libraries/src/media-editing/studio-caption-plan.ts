type CaptionWord = Readonly<{ id: string; text: string; start: number; end: number }>;

// Presentation only: callers supply validated output-clock words and cumulative
// kept-frame ends at CFR30. Never infer seams from source in-points or retime words.
export function groupStudioCaptions(words: readonly CaptionWord[], keptFrameEnds: readonly number[]): { wordIds: string[] }[] {
  const groups: { wordIds: string[] }[] = [];
  let current: CaptionWord[] = [], span = -1;
  const flush = () => { if (current.length) groups.push({ wordIds: current.map(w => w.id) }); current = []; };
  const terminal = (s: string) => /[.!?…][\"'”’)}\]]*$/.test(s) &&
    !/^(?:Mr|Mrs|Ms|Dr|Prof|Jr|Sr|St|[A-Z])\.$/i.test(s);
  for (const word of words) {
    // Half-open output spans: a word starting exactly at a seam belongs on its
    // right; a positive word ending there stays on its left. No frame rounding.
    const nextSpan = keptFrameEnds.findIndex(end => word.start < end / 30);
    const boundary = nextSpan < 0 ? undefined : keptFrameEnds[nextSpan] / 30;
    // Native evidence tolerates tiny seam straddles and overlapping/zero-length
    // words. Keep those tokens too; isolate a straddle rather than guessing.
    const straddles = boundary !== undefined && word.end > boundary;
    // A zero-length word exactly on a seam has ambiguous span membership.
    const isolated = straddles || word.start === word.end && keptFrameEnds.some(end => word.start === end / 30);
    if (current.length && (nextSpan !== span || isolated ||
        word.start - Math.max(...current.map(w => w.end)) >= .350 ||
        current.length >= 4 || Math.max(word.end, ...current.map(w => w.end)) - current[0].start > 1.8 ||
        [...current, word].map(w => w.text).join(' ').length > 32)) flush();
    span = nextSpan;
    current.push(word);
    if (isolated || terminal(word.text) || /,[\"'”’)}\]]*$/.test(word.text) &&
        current.length >= 2 && (word.end - current[0].start >= .45 || current.map(w => w.text).join(' ').length >= 16)) flush();
  }
  flush();
  return groups;
}
