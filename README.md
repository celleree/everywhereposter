# EverywherePoster

AI-assisted content repurposing and distribution, built on [Postiz](postiz-app/README.md).

Repository: `celleree/everywhereposter`. The app source is included in `postiz-app/`.

## Start here

Read the guide relevant to your task:

- [Agent instructions](AGENTS.md): working rules and source precedence.
- [Repository routing](docs/brain/REPOSITORY_ROUTING.md): find the owning subsystem.
- [Product truth](docs/brain/PRODUCT_TRUTH.md): product promises and constraints.
- [Current work](docs/brain/CURRENT_WORK.md): priorities and checkpoints.
- [Operating manual](OPERATING-MANUAL.md): environment, database, and deployment procedures.
- Development: [workspace scripts and toolchain](postiz-app/package.json), [test guide](postiz-app/tests/README.md).

## Layout

| Path | Purpose |
| --- | --- |
| [postiz-app/](postiz-app/) | App workspace: frontend, backend, orchestration, shared libraries, tests |
| [docs/](docs/) | Product, subsystem, and operating guides; project memory in `brain/` |
| [scripts/](scripts/) | Repository checks and operational helpers |
| [.github/](.github/) | CI, deployment workflows, and contribution templates |
| [site/](site/) | Public policy pages and branding assets |
| [nginx/](nginx/) | Reverse-proxy configuration |
| [docker-compose.yaml](docker-compose.yaml) | Runtime stack; overlays live alongside it |

## License

AGPL-3.0: [repository license](LICENSE) and [app license](postiz-app/LICENSE).
