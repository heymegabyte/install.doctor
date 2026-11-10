FROM golang:1.24-bookworm@sha256:1a6d4452c65dea36aac2e2d606b01b4a029ec90cc1ae53890540ce6173ea77ac AS broker-builder

WORKDIR /src
COPY packages/privileged-broker/go.mod ./go.mod
COPY packages/privileged-broker/cmd ./cmd
COPY packages/privileged-broker/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /desktop-tools-privileged-broker ./cmd/desktop-tools-privileged-broker

FROM node:24-bookworm@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40

ENV container=docker
ENV DEBIAN_FRONTEND=noninteractive
# This acceptance image intentionally exercises Debian's current Bookworm transaction state inside
# digest-pinned base images; exact native payload provenance is verified separately by the signed catalog.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends dbus dpkg-dev gnupg systemd systemd-sysv xz-utils \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && systemctl mask dev-hugepages.mount sys-fs-fuse-connections.mount systemd-remount-fs.service

WORKDIR /opt/install.doctor/packages/aid-core
COPY packages/aid-core/package.json packages/aid-core/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY packages/aid-core/dist ./dist

WORKDIR /opt/install.doctor/packages/installer-engine
COPY packages/installer-engine/package.json packages/installer-engine/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY packages/installer-engine/dist ./dist
COPY packages/installer-engine/test/fixtures/native-dpkg-pid1/acceptance.mjs ./acceptance.mjs
COPY --from=broker-builder /desktop-tools-privileged-broker /usr/local/libexec/desktop-tools-privileged-broker

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
