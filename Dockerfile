# The Mediaplane image: the CLI, Node, and the Docker CLI with Compose (spec §2.1, §3.3).
# Build it with:  docker build --tag mediaplane:local .

# The CLI bundle is plain JavaScript, so it is built once, on the build machine's own
# architecture, for every image architecture.
FROM --platform=$BUILDPLATFORM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS bundle
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json packages/cli/
COPY packages/engine/package.json packages/engine/
COPY catalog/package.json catalog/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json LICENSE ./
COPY scripts/root.ts scripts/bundle.ts scripts/
COPY packages/cli/src packages/cli/src
COPY packages/engine/src packages/engine/src
COPY catalog catalog
RUN pnpm bundle

# The Docker CLI and the Compose plugin (v5.5.1) Mediaplane drives. Both are static.
FROM docker:29.8.1-cli@sha256:018edbc908e08fcc9dbf029c812c34251e9b4719e6f71ca0e5eae2a987d014ca AS docker-cli

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
# Only Node is needed at run time: drop the Node package managers the base image ships.
# apk stays: the Alpine package database it keeps (/lib/apk/db) is what Trivy scans.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=bundle /build/dist/mediaplane.mjs /opt/mediaplane-cli/mediaplane.mjs
COPY --from=bundle /build/dist/THIRD-PARTY-LICENSES.txt /usr/share/doc/mediaplane/THIRD-PARTY-LICENSES.txt
COPY --from=bundle /build/LICENSE /usr/share/doc/mediaplane/LICENSE
RUN ln -s /opt/mediaplane-cli/mediaplane.mjs /usr/local/bin/mediaplane
ENV MEDIAPLANE_HOME=/opt/mediaplane
LABEL org.opencontainers.image.title="Mediaplane" \
      org.opencontainers.image.description="Deploys and wires a self-hosted media stack from one stack.yaml" \
      org.opencontainers.image.source="https://github.com/cyclopsgd/Mediaplane" \
      org.opencontainers.image.licenses="GPL-3.0"
# The node user. mediaplane.compose.yaml runs it as the user that owns the home instead.
USER 1000:1000
ENTRYPOINT []
# M1 has no listener: the container idles, and commands arrive through `docker exec`.
CMD ["sleep", "infinity"]
