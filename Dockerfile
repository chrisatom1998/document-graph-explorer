# Build the production web app, then serve it with nginx.
# node:24-alpine, digest verified 2026-07-09 via:
#   docker pull node:24-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:24-alpine
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build
WORKDIR /app

# This is a client-side web app; skip the Electron binary download that
# would otherwise trigger during `npm ci` for the (unused-in-this-image)
# desktop-packaging devDependency.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

# nginxinc/nginx-unprivileged:1.27-alpine, digest verified 2026-07-09 via:
#   docker pull nginxinc/nginx-unprivileged:1.27-alpine && docker inspect --format='{{index .RepoDigests 0}}' nginxinc/nginx-unprivileged:1.27-alpine
FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0

USER root
# Pre-create the (optional) downloads mount point and make it writable by
# the container's group (nginx-unprivileged runs as an arbitrary UID with
# GID 0), so a compose bind mount over it still works read-only at runtime.
RUN mkdir -p /usr/share/nginx/downloads \
    && chgrp -R 0 /usr/share/nginx/downloads \
    && chmod -R g+rwX /usr/share/nginx/downloads

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
