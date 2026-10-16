import { Metadata } from 'next';
import { VideoEditorWorkspace } from '@gitroom/frontend/components/video-editor/video-editor.workspace';

export const metadata: Metadata = {
  title: 'EverywherePoster Video Editor',
};

export default function Page() {
  return <VideoEditorWorkspace />;
}
