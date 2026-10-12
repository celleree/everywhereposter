import { useResumableTransfers } from './resumable-upload.provider';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// @ts-ignore
import Uppy, { BasePlugin, UploadResult, UppyFile } from '@uppy/core';
// @ts-ignore
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { getUppyUploadPlugin } from '@gitroom/react/helpers/uppy.upload';
import { Dashboard, FileInput, ProgressBar } from '@uppy/react';

// Uppy styles
import { useVariables } from '@gitroom/react/helpers/variable.context';
import Compressor from '@uppy/compressor';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { resolveStructurallyValidatedUploadFileType } from '@gitroom/frontend/components/media/structural.upload.file.type';
import { uniqBy } from 'lodash';

export class CompressionWrapper<M = any, B = any> extends Compressor<any, any> {
  override async prepareUpload(fileIDs: string[]) {
    const { files } = this.uppy.getState();

    // 1) Skip GIFs (and anything missing)
    const filteredIDs = fileIDs.filter((id) => {
      const f = files[id];
      if (!f) return false;

      const type = f.type ?? '';
      const name = (f.name ?? '').toLowerCase();
      const isGif = type === 'image/gif' || name.endsWith('.gif');

      return !isGif;
    });

    // 2) Let @uppy/compressor do its work (convert/resize/etc)
    return super.prepareUpload(filteredIDs);
  }
}

export function cancelUppyUploads(uppy: Uppy<any, any>) {
  const files = uppy.getFiles();

  for (const file of files) {
    try {
      uppy.removeFile(file.id);
    } catch (error) {
      console.warn('Failed to remove Uppy file during cancel:', error);
    }
  }

  try {
    uppy.cancelAll?.();
  } catch (error) {
    console.warn('Failed to cancel Uppy uploads:', error);
  }
}

export function useUppyUploader(props: {
  onUploadSuccess: (result: any[]) => void | Promise<void>;
  onStart?: () => void;
  onEnd?: () => void;
  onUploadIssue?: (message: string) => void;
  allowedFileTypes: string;
  guidedTranscription?: boolean;
}) {
  const transfers = useResumableTransfers();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const setLocked = useLaunchStore((state) => state.setLocked);
  const toast = useToaster();
  const { storageProvider, backendUrl, disableImageCompression, transloadit } =
    useVariables();
  const { allowedFileTypes } = props;
  const fetch = useFetch();
  const callbacks = useRef(props);
  callbacks.current = props;
  return useMemo(() => {
    // Track file order to maintain original sequence after upload
    let fileOrderIndex = 0;
    let uploadCancelled = false;
    let removingCompletedFiles = false;
    const busyFiles = new Set<string>();
    const deliveredFiles = new Set<string>();
    const issueFiles = new Set<string>();

    const uppy2 = new Uppy({
      autoProceed: true,
      restrictions: {
        // maxNumberOfFiles: 5,
        // allowedFileTypes: allowedFileTypes.split(','),
        maxFileSize: 1000 * 1024 * 1024, // Default 1GB, but we'll override with custom validation
      },
    });

    // Uppy upload() retries old errors before selecting new files. Suppress that
    // synchronous retry scan, then restore the errors for its normal result/UI.
    const upload = uppy2.upload.bind(uppy2);
    uppy2.upload = () => {
      const failed = uppy2.getFiles().filter((file) => file.error);
      for (const file of failed) uppy2.setFileState(file.id, { error: null });
      try {
        return upload();
      } finally {
        for (const file of failed) {
          uppy2.setFileState(file.id, {
            error: file.error,
            progress: {
              ...file.progress,
              uploadStarted: file.progress.uploadStarted || Date.now(),
              bytesUploaded: file.progress.bytesUploaded || 0,
            },
          });
        }
      }
    };

    // check for valid file types it can be something like this image/*,video/mp4.
    // If it's an image, I need to replace image/* with image/png, image/jpeg, image/jpeg, image/gif (separately)
    uppy2.addPreProcessor(async (fileIDs) => {
      const files = uppy2.getFiles();
      const allowedTypes = allowedFileTypes
        .split(',')
        .map((type) => type.trim());

      // Expand generic types to specific ones
      const expandedTypes = allowedTypes.flatMap((type) => {
        if (type === 'image/*') {
          return [
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/gif',
            'image/webp',
          ];
        }
        if (type === 'video/*') {
          return ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/mov'];
        }
        if (type === 'video/mp4' && transloadit && transloadit.length > 0) {
          return ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/mov'];
        }
        return [type];
      });

      for (const file of files) {
        if (fileIDs.includes(file.id)) {
          const fileType = await resolveStructurallyValidatedUploadFileType(file);

          // Check if file type is allowed
          const isAllowed = expandedTypes.some((allowedType) => {
            if (allowedType.endsWith('/*')) {
              const baseType = allowedType.replace('/*', '/');
              return fileType.startsWith(baseType);
            }
            return fileType === allowedType;
          });

          if (!isAllowed) {
            const error = new Error(
              `File type "${fileType}" is not allowed for file "${file.name}". Allowed types: ${allowedFileTypes}`
            );
            uppy2.log(error.message, 'error');
            uppy2.info(error.message, 'error', 5000);
            toast.show(
              `File type "${fileType}" is not allowed. Allowed types: ${allowedFileTypes}`,
              'warning'
            );
            uppy2.removeFile(file.id);
            throw error;
          }
        }
      }
    });

    uppy2.addPreProcessor(async (fileIDs) => {
      const files = uppy2.getFiles();

      for (const file of files) {
        if (fileIDs.includes(file.id)) {
          const fileType = await resolveStructurallyValidatedUploadFileType(file);
          const isImage = fileType.startsWith('image/');
          const isVideo = fileType.startsWith('video/');

          const maxImageSize = 30 * 1024 * 1024; // 30MB
          const maxVideoSize = 1000 * 1024 * 1024; // 1GB

          if (isImage && file.size > maxImageSize) {
            const error = new Error(
              `Image file "${file.name}" is too large. Maximum size allowed is 30MB.`
            );
            uppy2.log(error.message, 'error');
            uppy2.info(error.message, 'error', 5000);
            toast.show(`Image file is too large. Maximum size allowed is 30MB.`);
            uppy2.removeFile(file.id); // Remove file from queue
            throw error;
          }

          if (isVideo && file.size > maxVideoSize) {
            const error = new Error(
              `Video file "${file.name}" is too large. Maximum size allowed is 1GB.`
            );
            uppy2.log(error.message, 'error');
            uppy2.info(error.message, 'error', 5000);
            toast.show(`Video file is too large. Maximum size allowed is 1GB.`);
            uppy2.removeFile(file.id); // Remove file from queue
            throw error;
          }
        }
      }
    });

    const { plugin, options } = getUppyUploadPlugin(
      transloadit.length > 0 ? 'transloadit' : storageProvider,
      fetch,
      backendUrl,
      transloadit
    );

    uppy2.use(plugin, options);
    if (!disableImageCompression) {
      uppy2.use(CompressionWrapper, {
        convertTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxWidth: 1000,
        maxHeight: 1000,
        quality: 1,
      });
    }

    const finishUpload = () => {
      if (busyFiles.size === 0) {
        setLocked(false);
        callbacks.current.onEnd?.();
      }
    };

    const showIssue = (message: string) => {
      callbacks.current.onUploadIssue?.(message);
      toast.show(message, 'warning');
    };
    const notifySuccess = (media: any[]) => {
      Promise.resolve().then(() => callbacks.current.onUploadSuccess(media)).catch(() => {
        showIssue('The upload was saved, but the view could not refresh. Open Media Library to find it; do not upload it again.');
      });
    };
    const recoverUpload = (file?: UppyFile<any, any>, status?: number) => {
      if (file) {
        busyFiles.delete(file.id);
        issueFiles.add(file.id);
      }
      else busyFiles.clear();
      showIssue(status === 413
        ? 'The server rejected this upload because it is too large. Choose a smaller file.'
        : 'The upload connection failed. Your selection is preserved. Check Media Library before uploading again; the server may have saved the file.');
      finishUpload();
    };

    // Set additional metadata when a file is added
    uppy2.on('file-added', (file) => {
      if (storageProvider === 'local' && !transloadit.length && allowedFileTypes.includes('video/') && /\.(mp4|mov)$/i.test(file.name)) {
        // The layout owns local video transfer; modal/navigation locks belong only to the legacy path.
        uppy2.removeFile(file.id);
        if (!transfers) { showIssue('Open the authenticated app to start a resumable video transfer.'); return; }
        void transfers.start(file.data as File).then(media => {
          if (mounted.current) notifySuccess([media]);
        }).catch(error => { if (mounted.current) showIssue(error.message); });
        return;
      }
      uploadCancelled = false;
      deliveredFiles.delete(file.id);
      busyFiles.add(file.id);
      setLocked(true);
      callbacks.current.onStart?.();
      uppy2.setFileMeta(file.id, {
        useCloudflare: storageProvider === 'cloudflare' ? 'true' : 'false', // Example of adding a custom field
        addedOrder: fileOrderIndex++, // Track original order for sorting after upload
        guidedTranscription: props.guidedTranscription ? 'true' : 'false',
        // Add more fields as needed
      });
    });
    uppy2.on('file-removed', (file) => {
      busyFiles.delete(file.id);
      issueFiles.delete(file.id);
      if (!removingCompletedFiles && uppy2.getFiles().length === 0) {
        uploadCancelled = true;
        finishUpload();
      }
    });
    uppy2.on('error', (result) => {
      recoverUpload();
    });
    uppy2.on('upload-error', (file, error, response) => {
      if (!file || !uppy2.getFile(file.id)) return;
      recoverUpload(file, response?.status ?? (error as any)?.request?.status);
    });
    uppy2.on('restriction-failed', (_file, error) => {
      showIssue(`${error.message} Your selection is preserved. Check Media Library before uploading again.`);
      finishUpload();
    });
    uppy2.on('upload-stalled', (_error, files) => {
      const pending = files.filter((file) => uppy2.getFile(file.id) && !uppy2.getFile(file.id).progress.uploadComplete);
      if (pending.length === 0) return;
      for (const file of pending) {
        busyFiles.delete(file.id);
        issueFiles.add(file.id);
      }
      showIssue('The upload is waiting for a response. It may still finish. Your selection is preserved; check Media Library before uploading again.');
      // Keep the request alive: a delayed response can confirm a committed upload.
      finishUpload();
    });
    uppy2.on('cancel-all', () => {
      uploadCancelled = true;
      busyFiles.clear();
      finishUpload();
    });
    uppy2.on('upload-start', () => {
      if (busyFiles.size > 0) callbacks.current.onStart?.();
    });
    uppy2.on('complete', async (result) => {
      const successful = result.successful.filter((file) =>
        file.progress.uploadComplete &&
        uppy2.getFile(file.id)?.response === file.response &&
        !deliveredFiles.has(file.id)
      );
      removingCompletedFiles = true;
      try {
        for (const file of successful) {
          uppy2.removeFile(file.id);
        }
      } finally {
        removingCompletedFiles = false;
      }

      finishUpload();
      // Sort results by original add order to maintain file sequence
      const sortedSuccessful = [...successful].sort((a, b) => {
        const orderA = +((a.meta as any)?.addedOrder ?? 0);
        const orderB = +((b.meta as any)?.addedOrder ?? 0);
        return orderA - orderB;
      });

      for (const file of sortedSuccessful) deliveredFiles.add(file.id);

      if (uploadCancelled || sortedSuccessful.length === 0) {
        uploadCancelled = false;
        return;
      }

      if (storageProvider === 'local') {
        uploadCancelled = false;
        notifySuccess(sortedSuccessful.map((p) => p.response.body));
        return;
      }

      if (transloadit.length > 0) {
        // @ts-ignore
        const allRes = result.transloadit[0].results;
        const toSave = uniqBy<{
          name: string;
          originalName: string;
          order: number;
        }>(
          // @ts-ignore
          Object.values(allRes).flatMap((p: any[]) => {
            return p.flatMap((item) => ({
              name: item.url.split('/').pop(),
              originalName: item.name || '',
              order: +item.user_meta.addedOrder,
            }));
          }),
          (item) => item.name
        );

        const loadAllMedia = (
          await Promise.all(
            toSave.map(async ({ name, originalName, order }) => ({
              file: await (
                await fetch('/media/save-media', {
                  method: 'POST',
                  body: JSON.stringify({
                    name,
                    originalName,
                    guidedTranscription: props.guidedTranscription === true,
                  }),
                })
              ).json(),
              order,
            }))
          )
        )
          .sort((a, b) => {
            return a.order - b.order;
          })
          .map((p) => p.file);

        uploadCancelled = false;
        notifySuccess(loadAllMedia);
        return;
      }

      uploadCancelled = false;
      notifySuccess(sortedSuccessful.map((p) => p.response.body.saved));
    });
    uppy2.on('upload-success', (file, response) => {
      if (!file || !uppy2.getFile(file.id)) return;
      busyFiles.delete(file.id);
      issueFiles.delete(file.id);
      if (issueFiles.size === 0) callbacks.current.onUploadIssue?.('');
      finishUpload();
      // @ts-ignore
      uppy2.setFileState(file.id, {
        // @ts-ignore
        progress: uppy2.getState().files[file.id].progress,
        // @ts-ignore
        uploadURL: response.body.Location,
        response: response,
        isPaused: false,
      });
    });
    return uppy2;
  }, []);
}
