FROM node:24-bookworm@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40

ENV container=docker
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends dbus dpkg-dev systemd systemd-sysv \
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

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
