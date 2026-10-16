export interface PricingInnerInterface {
  current: string;
  unlimited_channels?: boolean;
  unlimited_posts?: boolean;
  prepaid_ai?: boolean;
  month_price: number;
  year_price: number;
  channel?: number;
  posts_per_month: number;
  team_members: boolean;
  community_features: boolean;
  featured_by_gitroom: boolean;
  ai: boolean;
  import_from_channels: boolean;
  image_generator?: boolean;
  image_generation_count: number;
  generate_videos: number;
  public_api: boolean;
  webhooks: number;
  autoPost: boolean;
}
export interface PricingInterface {
  [key: string]: PricingInnerInterface;
}
export const LAUNCH_PLAN = 'LAUNCH_V1' as const;
export const pricing: PricingInterface = {
  LAUNCH_V1: {
    current: 'LAUNCH_V1', month_price: 9, year_price: 90,
    // Numeric DB fields remain zero; explicit flags, not artificial quotas,
    // represent the approved unlimited ordinary publishing allowance.
    channel: 0, posts_per_month: 0, unlimited_channels: true, unlimited_posts: true,
    prepaid_ai: true, team_members: false, community_features: false,
    featured_by_gitroom: false, ai: false, import_from_channels: false,
    image_generator: false, image_generation_count: 0, generate_videos: 0,
    public_api: false, webhooks: 0, autoPost: false,
  },
  FREE: {
    current: 'FREE',
    month_price: 0,
    year_price: 0,
    channel: 0,
    image_generation_count: 0,
    posts_per_month: 0,
    team_members: false,
    community_features: false,
    featured_by_gitroom: false,
    ai: false,
    import_from_channels: false,
    image_generator: false,
    public_api: false,
    webhooks: 0,
    autoPost: false,
    generate_videos: 0,
  },
  STANDARD: {
    current: 'STANDARD',
    month_price: 29,
    year_price: 278,
    channel: 5,
    posts_per_month: 400,
    image_generation_count: 20,
    team_members: false,
    ai: true,
    community_features: false,
    featured_by_gitroom: false,
    import_from_channels: true,
    image_generator: false,
    public_api: true,
    webhooks: 2,
    autoPost: false,
    generate_videos: 3,
  },
  TEAM: {
    current: 'TEAM',
    month_price: 39,
    year_price: 374,
    channel: 10,
    posts_per_month: 1000000,
    image_generation_count: 100,
    community_features: true,
    team_members: true,
    featured_by_gitroom: true,
    ai: true,
    import_from_channels: true,
    image_generator: true,
    public_api: true,
    webhooks: 10,
    autoPost: true,
    generate_videos: 10,
  },
  PRO: {
    current: 'PRO',
    month_price: 49,
    year_price: 470,
    channel: 30,
    posts_per_month: 1000000,
    image_generation_count: 300,
    community_features: true,
    team_members: true,
    featured_by_gitroom: true,
    ai: true,
    import_from_channels: true,
    image_generator: true,
    public_api: true,
    webhooks: 30,
    autoPost: true,
    generate_videos: 30,
  },
  ULTIMATE: {
    current: 'ULTIMATE',
    month_price: 99,
    year_price: 950,
    channel: 100,
    posts_per_month: 1000000,
    image_generation_count: 500,
    community_features: true,
    team_members: true,
    featured_by_gitroom: true,
    ai: true,
    import_from_channels: true,
    image_generator: true,
    public_api: true,
    webhooks: 10000,
    autoPost: true,
    generate_videos: 60,
  },
};

export function channelAllowance(subscription?: { subscriptionTier?: string; totalChannels?: number } | null): number {
  return pricing[subscription?.subscriptionTier || 'FREE']?.unlimited_channels
    ? Number.POSITIVE_INFINITY : subscription?.totalChannels ?? 0;
}
/** New customers see the versioned launch offer; legacy subscribers retain their
 * existing catalogue, prices and access without an automatic tier conversion. */
export function purchasePlans(currentTier?: string) {
  const legacy = ['STANDARD', 'TEAM', 'PRO', 'ULTIMATE'].includes(currentTier || '');
  return Object.entries(pricing).filter(([key]) => legacy ? key !== 'FREE' && key !== LAUNCH_PLAN : key === LAUNCH_PLAN);
}
