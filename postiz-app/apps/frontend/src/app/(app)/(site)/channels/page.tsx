export const dynamic = 'force-dynamic';
import { ChannelsComponent } from '@gitroom/frontend/components/channels/channels.component';
import { Metadata } from 'next';
export const metadata: Metadata = { title: 'EverywherePoster Channels' };
export default function Page() { return <ChannelsComponent />; }
