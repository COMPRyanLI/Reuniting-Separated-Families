# Production image for the API (which also serves the built web app) and the worker.
# Same image, three commands:
#   web:     node apps/api/dist/server.js
#   worker:  node apps/api/dist/worker.js
#   release: node node_modules/prisma/build/index.js migrate deploy   (run before starting a new version)
# No secrets are baked in; configuration comes from runtime environment variables only.

FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY prisma prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.22.0-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages
COPY --from=build /app/prisma ./prisma
# Sources used by the guarded seed and operator CLIs (run with tsx; never served).
COPY --from=build /app/apps/api/src ./apps/api/src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
