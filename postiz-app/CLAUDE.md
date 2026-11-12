Read [the repository instructions](../AGENTS.md) first. Use [repository routing](../docs/brain/REPOSITORY_ROUTING.md) to locate an owner, [product truth](../docs/brain/PRODUCT_TRUTH.md) for capability claims, and [the handoff protocol](../docs/brain/CHATGPT_CODEX_HANDOFF.md) for implementation and final-review sequencing. These application notes do not replace the repository's approval gates.

Commands below are relative to `postiz-app/`. Toolchain declarations live in `package.json`: Node `>=22.12.0 <23.0.0`, Volta `22.20.0`, and `pnpm@10.6.1`.

This pnpm workspace has three main application services:

- apps/backend - this is where the API code is (NESTJS)
- apps/orchestrator - this is temporal, it's for background jobs (NESTJS) it contains all the workflows and activities
- apps/frontend - Next.js frontend; its package scripts run `next dev`, `next build`, and `next start`.
- libraries/ contains a lot of services shared between backend and orchestrator and frontend components.

We are using only pnpm, don't use any other dependency manager.
Never install frontend components from npmjs, focus on writing native components.

The project uses tailwind 3, before writing any component look at:
- apps/frontend/src/app/colors.scss
- apps/frontend/src/app/global.scss
- apps/frontend/tailwind.config.cjs

All the --color-custom* are deprecated, don't use them.

And check other components in the system before to get the right design.

When working on the backend we need to pass the 3 layers:
Controller >> Service >> Repository (no shortcuts)
In some cases we will have
Controller >> Mananger >> Service >> Repository.

Backend API controllers live in `apps/backend/src/api/`; shared backend services, repositories, and Temporal support live in `libraries/nestjs-libraries/`. Start with the owning subsystem.

For the frontend follow this:
- Many of the UI components lives in apps/frontend/src/components/ui
- Routing is in apps/frontend/src/app
- Components are in apps/frontend/src/components
- always use SWR to fetch stuff, and use "useFetch" hook from `libraries/helpers/src/utils/custom.fetch.tsx`

When using SWR, each one have to be in a seperate hook and must comply with react-hooks/rules-of-hooks, never put eslint-disable-next-line on it.

It means that this is valid:
const useCommunity = () => {
   return useSWR....
}

This is not valid:
const useCommunity = () => {
  return {
    communities: () => useSWR<CommunitiesListResponse>("communities", getCommunities),
    providers: () => useSWR<ProvidersListResponse>("providers", getProviders),
  };
}

- Linting of the project can run only from the root.
- Use only pnpm.