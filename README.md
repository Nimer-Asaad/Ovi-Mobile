# Ovi Mobile

Ovi Mobile is an Arabic-first, RTL-first commerce and management platform for mobile accessories.

This repository is a pnpm workspace monorepo managed with Turborepo.

## Requirements

- Node.js 20.11 or newer
- pnpm 10 or newer
- Docker, for the optional local PostgreSQL service

## Install

```bash
pnpm install
```

## Environment

Copy the example environment files before running services locally:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
```

Update local values as needed. Never commit real secrets.

## Local Development

Start PostgreSQL:

```bash
docker compose -f infrastructure/docker-compose.yml up -d
```

Run all apps:

```bash
pnpm dev
```

The web app defaults to `http://localhost:3000`.
The API defaults to `http://localhost:4000/api`, with Swagger docs at `http://localhost:4000/docs`.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Workspace Layout

- `apps/web` - Next.js App Router frontend.
- `apps/api` - NestJS REST API.
- `packages/config` - shared TypeScript, ESLint, and formatting configuration.
- `packages/contracts` - DTO-friendly shared contract placeholders.
- `packages/api-client` - reusable typed HTTP client base.
- `packages/ui` - minimal shared UI foundations.
- `infrastructure` - local development infrastructure.
- `docs` - project documentation.
