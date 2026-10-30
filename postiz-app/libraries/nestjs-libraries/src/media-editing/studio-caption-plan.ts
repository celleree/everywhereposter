type CaptionWord = Readonly<{ id: string; text: string; start: number; end: number }>;

// Presentation only: callers supply validated output-clock words and cumulative
// kept-frame ends at CFR30. Never infer seams from source in-points or retime words.
export function groupStudioCaptions(words: readonly CaptionWord[], keptFrameEnds: readonly number[]): { wordIds: string[] }[] {
  const groups: CaptionWord[][] = [];
  let current: CaptionWord[] = [], span = -1;
  const flush = () => { if (current.length) groups.push(current); current = []; };
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
  // First-active selection can hide a short following phrase under an earlier
  // tail. Merge soft phrase breaks when a legal merge restores token visibility.
  const range = (g: CaptionWord[]) => [Math.floor(g[0].start * 30),
    Math.ceil(Math.min(g[g.length - 1].end + .12, words[words.length - 1].end) * 30)];
  const spanOf = (w: CaptionWord) => keptFrameEnds.findIndex(end => w.start < end / 30);
  const mergeable = (a: CaptionWord[], b: CaptionWord[]) => a.length + b.length <= 4 &&
    b[0].start - Math.max(...a.map(w => w.end)) < .350 &&
    [...a, ...b].every(w => spanOf(w) === spanOf(a[0]) && !keptFrameEnds.some(end =>
      w.start < end / 30 && w.end > end / 30 || w.start === w.end && w.start === end / 30));
  for (let i = 0; i < groups.length; i++) {
    const covered = Math.max(0, ...groups.slice(0, i).map(g => range(g)[1]));
    if (range(groups[i])[1] > Math.max(range(groups[i])[0], covered)) continue;
    const previous = groups[i - 1], next = groups[i + 1];
    if (previous && mergeable(previous, groups[i])) {
      const merged = [...previous, ...groups[i]];
      const earlier = Math.max(0, ...groups.slice(0, i - 1).map(g => range(g)[1]));
      if (range(merged)[1] > Math.max(range(merged)[0], earlier)) {
        groups.splice(i - 1, 2, merged); i -= 2; continue;
      }
    }
    if (next && mergeable(groups[i], next)) {
      const merged = [...groups[i], ...next];
      if (range(merged)[1] > Math.max(range(merged)[0], covered)) groups.splice(i--, 2, merged);
    }
  }
  return groups.map(g => ({ wordIds: g.map(w => w.id) }));
}
