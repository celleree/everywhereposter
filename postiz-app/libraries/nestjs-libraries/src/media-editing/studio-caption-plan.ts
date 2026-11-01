type CaptionWord = Readonly<{ id: string; text: string; start: number; end: number }>;

// Presentation only: callers supply validated output-clock words and cumulative
// kept-frame ends at CFR30. Never infer seams from source in-points or retime words.
export function groupStudioCaptions(words: readonly CaptionWord[], keptFrameEnds: readonly number[], version: 'current' | 'initial-a9a' = 'current'): { wordIds: string[] }[] {
  // The final output end is not a seam. Retain the original algorithm only for
  // exact verification of saved plans, never for newly authored groups.
  const boundaries = version === 'initial-a9a' ? keptFrameEnds : keptFrameEnds.slice(0, -1);
  const spanOf = (w: CaptionWord) => boundaries.findIndex(end => w.start < end / 30);
  const groups: CaptionWord[][] = [];
  let current: CaptionWord[] = [], span = -1;
  const flush = () => { if (current.length) groups.push(current); current = []; };
  const terminal = (s: string) => /[.!?…][\"'”’)}\]]*$/.test(s) &&
    !/^(?:Mr|Mrs|Ms|Dr|Prof|Jr|Sr|St|[A-Z])\.$/i.test(s);
  for (const word of words) {
    // Half-open output spans: a word starting exactly at a seam belongs on its
    // right; a positive word ending there stays on its left. No frame rounding.
    const nextSpan = spanOf(word);
    const boundary = nextSpan < 0 ? undefined : boundaries[nextSpan] / 30;
    // Native evidence tolerates tiny seam straddles and overlapping/zero-length
    // words. Keep those tokens too; isolate a straddle rather than guessing.
    const straddles = boundary !== undefined && word.end > boundary;
    // A zero-length word exactly on a seam has ambiguous span membership.
    const isolated = straddles || word.start === word.end && boundaries.some(end => word.start === end / 30);
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
  const mergeable = (a: CaptionWord[], b: CaptionWord[]) => a.length + b.length <= 4 &&
    b[0].start - Math.max(...a.map(w => w.end)) < .350 &&
    [...a, ...b].every(w => spanOf(w) === spanOf(a[0]) && !boundaries.some(end =>
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
    // A full previous group can lend its last word to a hidden endpoint token.
    // Accept only when both replacement groups have visible legacy ranges.
    if (version === 'current' && i === groups.length - 1 && previous?.length > 1 &&
        groups[i].every(w => w.start === w.end && w.end === keptFrameEnds[keptFrameEnds.length - 1] / 30)) {
      const head = previous.slice(0, -1), tail = [previous[previous.length - 1], ...groups[i]];
      const earlier = Math.max(0, ...groups.slice(0, i - 1).map(g => range(g)[1]));
      if (mergeable(previous.slice(-1), groups[i]) &&
          range(head)[1] > Math.max(range(head)[0], earlier) &&
          range(tail)[1] > Math.max(range(tail)[0], range(head)[1], earlier)) {
        groups.splice(i - 1, 2, head, tail); i--; continue;
      }
    }
    if (next && mergeable(groups[i], next)) {
      const merged = [...groups[i], ...next];
      if (range(merged)[1] > Math.max(range(merged)[0], covered)) groups.splice(i--, 2, merged);
    }
  }
  return groups.map(g => ({ wordIds: g.map(w => w.id) }));
}
