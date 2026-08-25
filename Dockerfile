# MVP-BETA-007 (#44): production container for Cloud Run.
#
# Two stages: the build stage installs full (dev + prod) dependencies once
# to run `vite build`, producing the static `dist/` bundle; the runtime
# stage installs only production dependencies and copies in exactly what
# the Fastify server actually needs to run - it never contains the Vite dev
# server, devDependencies, or test/CI tooling. See
# docs/engineering/DEPLOYMENT.md for the full build/deploy runbook.

FROM node:22-alpine AS build
WORKDIR /app
# Installing before copying the rest of the source lets Docker cache this
# layer across builds that only change application code, not dependencies.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The Fastify server imports directly from src/services/*.js at runtime
# (receipt parsing, attention-item building, price-change detection) - this
# is server-side application code, not something Vite bundles for it, so it
# has to be present alongside server/ in the runtime image. migrations/ is
# read from disk by server/persistence/migrations.js and
# server/persistence/migrate.js. dist/ is the built PWA, copied from the
# build stage rather than rebuilt here.
COPY server/ ./server/
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY --from=build /app/dist/ ./dist/
# node:22-alpine already ships a non-root "node" user (uid 1000) - reuse it
# rather than inventing a new one for no benefit.
USER node
# Cloud Run injects PORT and expects the container to listen on it; the app
# already reads process.env.PORT via server/config/env.js. EXPOSE here is
# documentation only (Cloud Run does not use it to route traffic).
EXPOSE 8080
CMD ["node", "server/app.js"]
