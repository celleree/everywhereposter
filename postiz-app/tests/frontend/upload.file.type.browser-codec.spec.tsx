import { resolveStructurallyValidatedUploadFileType } from '../../apps/frontend/src/components/media/structural.upload.file.type';

const encodeAscii = (value: string) =>
  new Uint8Array(
    Array.from(value).map((character) => character.charCodeAt(0))
  );

const encodeUint16 = (value: number) =>
  new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);

const encodeUint32 = (value: number) =>
  new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);

const concatBytes = (...chunks: Uint8Array[]) => {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0)
  );
  let offset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
};

const createBox = (type: string, ...payload: Uint8Array[]) => {
  const bytes = concatBytes(...payload);

  return concatBytes(
    encodeUint32(bytes.length + 8),
    encodeAscii(type),
    bytes
  );
};

const createHevcMp4 = () => {
  const sample = new Uint8Array([0, 0, 0, 1, 0x26]);
  const ftyp = createBox(
    'ftyp',
    encodeAscii('isom'),
    new Uint8Array(4),
    encodeAscii('mp42')
  );
  const mdat = createBox('mdat', sample);
  const visualEntryBase = new Uint8Array(86);
  const codecConfig = createBox('hvcC', new Uint8Array([1]));
  const visualEntry = concatBytes(visualEntryBase, codecConfig);

  visualEntry.set(encodeUint32(visualEntry.length), 0);
  visualEntry.set(encodeAscii('hvc1'), 4);
  visualEntry.set(encodeUint16(1), 14);
  visualEntry.set(encodeUint16(1920), 32);
  visualEntry.set(encodeUint16(1080), 34);
  visualEntry.set(encodeUint32(0x00480000), 36);
  visualEntry.set(encodeUint32(0x00480000), 40);
  visualEntry.set(encodeUint16(1), 48);
  visualEntry.set(encodeUint16(24), 82);
  visualEntry.set(encodeUint16(0xffff), 84);

  const stsd = createBox(
    'stsd',
    new Uint8Array(4),
    encodeUint32(1),
    visualEntry
  );
  const stts = createBox(
    'stts',
    new Uint8Array(4),
    encodeUint32(1),
    encodeUint32(1),
    encodeUint32(1)
  );
  const stsc = createBox(
    'stsc',
    new Uint8Array(4),
    encodeUint32(1),
    encodeUint32(1),
    encodeUint32(1),
    encodeUint32(1)
  );
  const stsz = createBox(
    'stsz',
    new Uint8Array(4),
    encodeUint32(0),
    encodeUint32(1),
    encodeUint32(sample.length)
  );
  const stco = createBox(
    'stco',
    new Uint8Array(4),
    encodeUint32(1),
    encodeUint32(ftyp.length + 8)
  );
  const hdlr = createBox('hdlr', new Uint8Array(8), encodeAscii('vide'));
  const stbl = createBox('stbl', stsd, stts, stsc, stsz, stco);
  const moov = createBox(
    'moov',
    createBox('trak', createBox('mdia', hdlr, createBox('minf', stbl)))
  );

  return new File([concatBytes(ftyp, mdat, moov)], 'hevc-source.mp4', {
    type: 'application/octet-stream',
  });
};

describe('upload type validation and browser codec support', () => {
  it('accepts structurally valid HEVC without consulting the local decoder', async () => {
    const createElementSpy = jest.spyOn(document, 'createElement');

    try {
      await expect(
        resolveStructurallyValidatedUploadFileType(createHevcMp4())
      ).resolves.toBe('video/mp4');
      expect(createElementSpy).not.toHaveBeenCalled();
    } finally {
      createElementSpy.mockRestore();
    }
  });
});
