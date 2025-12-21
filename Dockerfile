FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    unzip \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user for runtime
RUN useradd -m -d /home/bun bun
ENV HOME=/home/bun
ENV BUN_INSTALL=/home/bun/.bun
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Install Bun for the bun user
RUN mkdir -p "$BUN_INSTALL" \
  && chown -R bun:bun /home/bun \
  && su bun -c "curl -fsSL https://bun.sh/install | bash" \
  && ln -s $BUN_INSTALL/bin/bun /usr/local/bin/bun

WORKDIR /app

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
