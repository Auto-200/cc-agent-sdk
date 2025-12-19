# Minimal image to run the local Claude Agent SDK proxy server (TypeScript + Bun).
# Keep it simple: install prod deps, bundle TS to dist/, then run the built output.
FROM oven/bun:1.3
WORKDIR /app
ENV HOME=/home/bun
RUN mkdir -p /home/bun/.claude

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# Build server bundle (keep packages external so runtime resolves from node_modules)
RUN bun build --target=bun --packages=external --outdir dist src/server.ts \
  && rm -rf src tsconfig.json

RUN chown -R bun:bun /app /home/bun
USER bun

EXPOSE 20001

CMD ["bun", "dist/server.js"]
