---
title: CloudFlare Integration
description: Find out the details on how Install Doctor integrates with CloudFlare and how you can leverage the functionality to improve your workflow.
sidebar_label: CloudFlare
slug: /integrations/cloudflare
---

CloudFlare integration provides a comprehensive set of networking and security features:

| Feature | Description |
|---|---|
| **SSO-protected services** | Web services hosted on your devices, protected by Single Sign-On |
| **Short-lived SSH certificates** | SSH access via CloudFlare Teams with auto-rotating certificates |
| **Browser isolation** | Remote browser rendering via CloudFlare's network (paid add-on) |
| **Automatic DNS** | Sub-domains automatically pointed to services via CloudFlare tunnels |
| **S3-compliant storage** | Cloud mounts mapped to local folders for encrypted backups |

## Required Variables

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_TEAMS_CLIENT_ID` | Client ID for Zero Trust / WARP configuration |
| `CLOUDFLARE_TEAMS_CLIENT_SECRET` | Client secret for Zero Trust / WARP configuration |
| `CLOUDFLARE_TEAMS_ORG` | Organization slug for your Zero Trust account |
| `cert.pem` (encrypted) | Authorization certificate for creating tunnels headlessly |

## CloudFlare WARP

CloudFlare WARP is leveraged to provide a free VPN service that can be configured to work with CloudFlare Zero Trust. Internet access to sent to CloudFlare in the first hop by configuring the host with CloudFlare's SSL certificates. Applications like `git`, `python`, and a few others that leverage their own bundled certificates are also configured to leverage CloudFlare as a proxy for egress traffic.

In order for everything to work as expected, you will need to bundle the `CLOUDFLARE_TEAMS_CLIENT_ID`, `CLOUDFLARE_TEAMS_CLIENT_SECRET`, and `CLOUDFLARE_TEAMS_ORG` secrets into your implementation.

### Browser Isolation

If you are willing to pay $10/month, you can enable browser isolation to improve the security and privacy of web surfing. With Browser Isolation enabled, instead of downloading web pages / apps when you visit websites, CloudFlare WARP will configure your browser to load websites in CloudFlare data-centers and then stream the view to your browser.

## CloudFlare Tunnels

By default, we do not open up any incoming ports in the firewall to the public internet. The firewall rules you may find in the `software.yml` definitions file only apply to local intranet communications. However, we do integrate our system with CloudFlare Teams Zero Access which allows us to provide public services and SSO-enabled services via a combination of CloudFlare tunnels (for providing access to system services such as SSH via a FQDN) and the CloudFlare WARP client (which is used for proxying outgoing traffic through CloudFlare Teams Zero Trust). In other words, CloudFlare tunnels handles the incoming traffic and CloudFlare WARP handles the outgoing traffic.

### Ownership boundary

Install Doctor installs and operates the portable connector/firewall mechanisms. It does not own production DNS names, origin mappings, Access policies, or permanent firewall exceptions. Those belong to the machine's host recovery repository and are reconciled into Cloudflare and the host firewall. See [Server ingress ownership](/docs/architecture/server-ingress-ownership).

The automatic `host-$HOST` flow below is a bootstrap mechanism. A production server must consume host-owned desired state; it must not infer its permanent ingress or firewall exceptions merely from installed software.

### Bundling Authorization Certificate

Each computer instance (e.g. operating system, VM, container) provisioned with Install Doctor that is configured to install `cloudflared` will attempt to create a new tunnel named `host-$HOST`, if one does not already exist. It can do this headlessly by utilizing the CloudFlare `cert.pem` file which grants access to a specific domain managed by CloudFlare. If the `cert.pem` is in `/usr/local/etc/cloudflared/cert.pem`, calls to `cloudflared` will be authenticated and new tunnels will be able to be created. To integrate the `cert.pem` into your fork, generate it by:

1. Running `cloudflared login`
2. Sign into CloudFlare with the browser that automatically pops up
3. Select a domain you want to associate the `cert.pem` file with
4. Generate an encrypted version of the `cert.pem` to store in your fork by running `cat ~/.cloudflared/cert.pem | chezmoi encrypt` (which requires [setting up encryption](/docs/customization/secrets#creating-an-age-key-password-protected))
5. Push the changes to your fork

### Saving Registration Tokens

The above method will allow you to automatically add new hosts to your CloudFlare Zero Trust tunnels administration panel. However, to fully automate things, we need to:

1. Create all tunnels manually in the CloudFlare tunnels panel by naming them `host-$HOST`
2. Copy the `cloudflared service install` token that is shown after creating the tunnel
3. Encrypt the token by running `echo -n "$TOKEN" | chezmoi encrypt` (where `$TOKEN` is the long token seen after `sudo cloudflared service install` on the webpage you are led to after creating a new tunnel)
4. Paste the encrypted blob in a file stored under `home/.chezmoitemplates/cloudflared/$HOST`. If your computer's hostname is `Workstation`, then the encrypted blob should be pasted in a file stored under `home/.chezmoitemplates/cloudflared/Workstation`.

Using the **Saving Registration Tokens** method after following the **Bundling Authorization Certificate** process will lead to a completely automated setup that automatically sets up a tunnel for each host that is configured to have a matching tunnel that is already configured on CloudFlare Teams Zero Trust. However, if you only follow the **Bundling Authorization Certificate** method, then you will still be able to automatically add new tunnels to the CloudFlare Zero Trust tunnels dashboard but you will not be able to headlessly re-provision the hosts if you reformat, for example.

#### Saving Token Without CloudFlare Dashboard

It is also possible to save the JSON credentials file that CloudFlare generates for each tunnel to the `.chezmoitemplates/cloudflared` secrets. While Install Doctor is provisioning, it will decrypt the secret in `.chezmoitemplates/cloudflared` that corresponds to the `$HOST`. If the first character is `{`, then the secret will assumed to be the JSON credential that `cloudflared` generates instead of the launch token that you can find in the CloudFlare Zero Trust Tunnel dashboard. The following shows how to manually acquire the encrypted blob that should be stored in `home/.chezmoitemplates/cloudflared/$HOST` for a particular host and update your git fork with the changes (assuming you have forked Install Doctor):

```shell
❯ sudo cloudflared tunnel create host-example
Tunnel credentials written to /Users/user/.cloudflared/df56bb55-4bfb-481f-8260-b5975372b7a9.json. cloudflared chose this file based on where your origin certificate was found. Keep this file secret. To revoke these credentials, delete the tunnel.

Created tunnel host-example with id df56bb55-4bfb-481f-8260-b5975372b7a9
❯ sudo cat /Users/user/.cloudflared/df56bb55-4bfb-481f-8260-b5975372b7a9.json | chezmoi encrypt > "/usr/local/src/install.doctor/home/.chezmoitemplates/cloudflared/$HOST"
❯ cd /usr/local/src/install.doctor && git add --all && git commit -m "Added CloudFlare tunnel encrypted blob" && git push origin master
```
