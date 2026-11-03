---
title: Web App Features
sidebar_label: Web Apps
description: Learn how to turn your Install Doctor managed device into a secure, full-fledged web app server with endpoints protected by SSO and CloudFlare.
slug: /customization/web-apps
image: /docs/img/og/web-apps.png
---

The default configuration of Install Doctor includes launching multiple services that are available as either web applications or as services that are available on specific ports. These web applications are either run as services or launched as web applications via Docker (i.e. `docker-compose.yml`).

## SSO-Protected Publicly Accessible Web Services

Whenever possible, we make the services available via an FQDN of your choice. By providing the `PUBLIC_SERVICES_DOMAIN` environment variable (or [storing it in your encrypted secrets](/customization/secrets)) before running the kickstart script, Install Doctor will automatically use `cloudflared` to create publicly accessible web apps by using the `PUBLIC_SERVICES_DOMAIN` as a base domain. All of the publicly accessible services can have their:

1. IP address protected by CloudFlare
2. Can be protected by Single Sign-On by leveraging [CloudFlare Teams](https://www.cloudflare.com/zero-trust/) (also known as CloudFlare Zero Trust)
3. Be accessible over the web via domains created using the format of `service-slug.hostname.public-services-domain.com`

### Example

```bash
export PUBLIC_SERVICES_DOMAIN="install.doctor"
bash <(curl -sSL https://install.doctor/start)
```

**Will create the following publicly accessible web services assuming the hostname is `webdev1` and the `PUBLIC_SERVICES_DOMAIN` is `example.com`:**

| Service                 | Domain                       |
|-------------------------|------------------------------|
| SSH                     | `ssh.webdev1.example.com`    |
| Remote Desktop Protocol | `rdp.webdev1.example.com`    |
| Samba                   | `samba.webdev1.example.com`  |
| SFTP                    | `sftp.webdev1.example.com`   |
| SFTPGo Web Portal       | `sftpgo.webdev1.example.com` |
| VNC                     | `vnc.webdev1.example.com`    |
| [Dagu](https://github.com/dagu-dev/dagu) | `dagu.webdev1.example.com` |
| rsyslog                 | `rsyslog.webdev1.example.com` |
| [Netdata](https://github.com/netdata/netdata)                 | `netdata.webdev1.example.com` |
| [Rundeck](https://github.com/rundeck/rundeck)                 | `rundeck.webdev1.example.com` |
| [Portainer](https://github.com/portainer/portainer)               | `portainer.webdev1.example.com` |

## `cloudflared` Configuration

The services detailed in the chart above are installed in the default configuration. After they are installed, the `cloudflared` daemon is launched with a [configuration](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/etc/cloudflared/config.yml.tmpl) that defines the data shown in the chart above. With `cloudflared` proxying the requests, all of these services are available on port 443 (HTTPS) using their defined domain names.

## Customization

Customizing the ports that need to be proxied to from the `cloudflared` daemon are all dependent on the configurations of each specific app. The [`sftpgo` configuration is here](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/etc/sftpgo/private_sftpgo.json.tmpl), for instance.

Besides modifying individual app configurations, if you need to debug anything, you can find the `cloudflared` initialization logic in the [`software.yml`](https://github.com/heymegabyte/install.doctor/blob/master/software.yml) file (by searching for `cloudflared`). During the provisioning started by the kickstart script, the [`installx`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/bin/executable_installx) program will install all the various applications and run their `_post` installation scripts afterwards which includes the initialization logic for both `cloudflared` and all of the individual programs (which may need their configurations copied to specific system locations).
