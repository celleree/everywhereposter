// Synthetic validator data only. No real transcript, footage or face observations.
export function fixture() {
  const words = [10, 11, 40, 70].map((start, i) => ({
    id: `w${i}`, text: `Example${i}`, start, end: start + 0.3,
  }));
  return {
    schemaVersion: 1, id: 'synthetic-edit', revision: 1,
    canvas: {width: 1440, height: 2560, fps: 30},
    source: {assetId: 'source', sha256: 'a'.repeat(64), frames: 3523},
    assets: [
      {id: 'source', file: 'assets/source.mp4', kind: 'video',
        sha256: 'a'.repeat(64), duration: 117.433333, fps: 30, evidence: 'Synthetic source'},
      {id: 'broll', file: 'assets/broll.mp4', kind: 'video',
        sha256: 'b'.repeat(64), duration: 60.1, fps: 30, evidence: 'Synthetic B-roll'},
      {id: 'still', file: 'assets/still.png', kind: 'image',
        sha256: 'c'.repeat(64), evidence: 'Synthetic still'},
    ],
    cuts: [{in: 0, out: 600, reason: 'Synthetic first cut'},
      {in: 700, out: 2787, reason: 'Synthetic second cut'}],
    words, captions: words.map(w => ({wordIds: [w.id]})),
    speaker: {count: 1, faces: [10, 70].map(t => ({
      t, x: 350, y: 300, width: 350, height: 500,
    }))},
    broll: [{id: 'b1', assetId: 'broll', from: 1200, frames: 60,
      sourceStart: 0, anchorWords: ['w2'], reason: 'Synthetic narration cue'}],
    effects: [
      {id: 'e1', type: 'DynamicChecklist', from: 300, frames: 60,
        anchorWords: ['w0'], reason: 'Synthetic checklist cue',
        bounds: {x: 110, y: 1100, width: 840, height: 320},
        props: {items: [{id: 'item', label: 'Example', checkedAt: 1}]}},
      {id: 'e2', type: 'ImageCollage', from: 2100, frames: 60,
        anchorWords: ['w3'], reason: 'Synthetic later cue',
        bounds: {x: 110, y: 1100, width: 840, height: 320},
        props: {radius: 10, images: [{id: 'image', assetId: 'still', at: 0,
          x: 0, y: 0, width: 100, height: 100}]}},
    ],
    instructions: {requiredCues: []},
    director: {summary: 'Synthetic test direction', decisions: []},
  };
}
