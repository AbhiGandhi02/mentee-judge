# Single image carrying the judge service + all four language toolchains.
# Debian base so we get apt packages for gcc/g++, OpenJDK, python3, and Node.
FROM node:20-bookworm-slim

# --- Language toolchains + coreutils (provides `timeout`) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ \
      python3 \
      default-jdk-headless \
      coreutils \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# --- Unprivileged user that runs submitted code ---
# uid/gid must match RUNNER_UID / RUNNER_GID in config.ts.
RUN groupadd --gid 1001 runner \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin runner

WORKDIR /app

# Install deps first for layer caching. Dev deps (typescript) are needed to build.
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Writable scratch space for per-submission temp dirs.
RUN mkdir -p /tmp/judge-runs && chown runner:runner /tmp/judge-runs

ENV NODE_ENV=production \
    PORT=8080 \
    WORK_ROOT=/tmp/judge-runs

EXPOSE 8080

# The service itself starts as root so it can spawn child processes as the
# `runner` uid/gid (Node's spawn uid/gid option requires privilege to drop to).
CMD ["node", "dist/server.js"]
