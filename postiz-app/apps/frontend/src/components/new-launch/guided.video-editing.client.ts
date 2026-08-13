import type { VideoEditDecisionListV1 } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';
import type { TalkingHeadStylePlan } from '@gitroom/nestjs-libraries/media-editing/talking-head-style';
import { getApiErrorMessage } from '@gitroom/frontend/components/new-launch/copy-generation.client';

type VideoEditingFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface GuidedVideoEditResponse {
  outputMedia: {
    id: string;
    name: string;
    originalName?: string | null;
    path: string;
    type: 'video';
    thumbnail?: string | null;
    alt?: string | null;
  };
  stylePlan: TalkingHeadStylePlan;
  editDecisionList: VideoEditDecisionListV1;
  render: {
    durationMs: number;
    container: 'mp4';
    videoCodec: 'h264';
    audioCodec: 'aac';
  };
}

const readResponsePayload = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

export const requestGuidedVideoEdit = async (
  fetch: VideoEditingFetch,
  mediaId: string,
  stylePrompt: string
): Promise<GuidedVideoEditResponse> => {
  const response = await fetch(`/media/${mediaId}/talking-head-edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stylePrompt }),
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(payload) ||
        'The edited video could not be created. Please try again.'
    );
  }

  const result = payload as Partial<GuidedVideoEditResponse> | undefined;
  if (
    !result?.outputMedia?.id ||
    !result.outputMedia.path ||
    !result.stylePlan ||
    !result.editDecisionList ||
    !result.render
  ) {
    throw new Error('The video editor returned an incomplete result.');
  }

  return result as GuidedVideoEditResponse;
};
