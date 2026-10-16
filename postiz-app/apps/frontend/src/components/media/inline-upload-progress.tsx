'use client';

import React, { useEffect, useReducer } from 'react';
import type Uppy from '@uppy/core';

// Present legacy image/nonlocal transfers without changing their transport or retry policy.
export function InlineUploadProgress({ uppy, onCancel }: {
  uppy: Uppy<any, any>;
  onCancel: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const [, update] = useReducer(value => value + 1, 0);
  useEffect(() => {
    uppy.on('state-update', update);
    return () => { uppy.off('state-update', update); };
  }, [uppy]);
  const files = uppy.getFiles();
  if (!files.length) return null;
  return <section aria-label="File transfers" className="mt-[16px] min-w-0 text-newTextColor">
    <p className="text-[12px]">You can browse Everywhere Poster while uploading. Keep this website open.</p>
    {files.map(file => <div key={file.id} className="mt-[8px] min-w-0">
      <p className="break-all text-[13px] font-[600]">{file.name}</p>
      <progress aria-label={`Upload progress for ${file.name}`} value={file.progress.bytesUploaded || 0} max={file.size || 1} className="my-[8px] block h-[8px] w-full accent-btnPrimary" />
    </div>)}
    <button type="button" className="!min-h-[44px] px-[8px]" onClick={onCancel}>Cancel upload</button>
  </section>;
}
