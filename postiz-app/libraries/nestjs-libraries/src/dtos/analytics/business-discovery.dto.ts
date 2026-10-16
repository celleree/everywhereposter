/** Public Business Discovery data; never an Integration or a Graph response. */
export interface BusinessDiscoveryQuery {
  username: string;
  cursor?: string;
}
export interface BusinessDiscoveryMedia {
  id: string;
  caption: string | null;
  mediaType: string | null;
  permalink: string | null;
  timestamp: string | null;
  likes: number | null;
  comments: number | null;
  previewUrl: string | null;
}
export interface BusinessDiscoveryResult {
  source: 'public_business_discovery';
  acting: { integrationId: string; id: string; username: string };
  target: {
    id: string;
    username: string;
    biography: string | null;
    website: string | null;
    followers: number | null;
    mediaCount: number | null;
  };
  media: BusinessDiscoveryMedia[];
  nextCursor: string | null;
}
