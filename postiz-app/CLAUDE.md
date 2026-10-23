# EverywherePoster app guidance

This workspace contains EverywherePoster, built on Postiz. Follow the repository [AGENTS.md](../AGENTS.md) for scope, verification, and human gates; use [PRODUCT_TRUTH.md](../docs/brain/PRODUCT_TRUTH.md) for product promises and [REPOSITORY_ROUTING.md](../docs/brain/REPOSITORY_ROUTING.md) for source/test entry points. Read [OPERATING-MANUAL.md](../OPERATING-MANUAL.md) before runtime, database, environment, or deployment work.

Use the Node engine and exact pnpm pin in [package.json](package.json), and choose focused validation from [tests/README.md](tests/README.md). Paths below are relative to `postiz-app/`.
You can add posts to the calendar, they will be added into a workflow and posted at the right time.
You can find things like:
- Schedule posts
- Calendar view
- Analytics
- Team management
- Media library

This project is a monorepo with a root only package.json of dependencies.
Made with PNPM.
We have 3 important folders

- apps/backend - this is where the API code is (NESTJS)
- apps/orchestrator - this is temporal, it's for background jobs (NESTJS) it contains all the workflows and activities
- apps/frontend - this is the code of the frontend (Next.js / React)
- /libraries contains a lot of services shared between backend and orchestrator and frontend components.

We are using only pnpm, don't use any other dependency manager.
Never install frontend components from npmjs, focus on writing native components.

The project uses tailwind 3, before writing any component look at:
- /apps/frontend/src/app/colors.scss
- /apps/frontend/src/app/global.scss
- /apps/frontend/tailwind.config.js

All the --color-custom* are deprecated, don't use them.

And check other components in the system before to get the right design.

When working on the backend we need to pass the 3 layers:
Controller >> Service >> Repository (no shortcuts)
In some cases we will have
Controller >> Mananger >> Service >> Repository.

Shared backend services and persistence code live in `libraries/nestjs-libraries/src/`.
Backend API controllers live in `apps/backend/src/api/routes/` and call the relevant shared services.

For the frontend follow this:
- Many of the UI components lives in /apps/frontend/src/components/ui
- Routing is in /apps/frontend/src/app
- Components are in /apps/frontend/src/components
- always use SWR to fetch stuff, and use "useFetch" hook from /libraries/helpers/src/utils/custom.fetch.tsx

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

- Run workspace commands from `postiz-app/`; use the specific package/test configuration for the affected area.
- Use only pnpm.
