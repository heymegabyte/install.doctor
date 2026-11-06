import { Fragment, h } from '@stencil/core';
import { ResponsiveContainer, Heading, Paragraph } from 'ionic-ds-no-fonts';
export const SolutionWindows = () => {
  return (
    <Fragment>
      <ResponsiveContainer id="what-is" as="section">
        <div class="ui-container">
          <ion-icon class="what-is-info-icon" name="information-circle-outline"></ion-icon>
          <Heading class="quote-summary" level={2}>
            Why should you provision Windows with Install Doctor?
          </Heading>
          <Paragraph class="quote-summary">
            Provisioning Windows can be a time-consuming and complex process, especially when you need to set up
            multiple systems with specific configurations and software requirements. This is where an installation
            framework like Install Doctor can be extremely useful. Install Doctor is a powerful and user-friendly
            installation framework that automates many of the tasks involved in installing and configuring Windows.
          </Paragraph>
          <Paragraph class="quote-summary">
            One of the key benefits of using Install Doctor to provision Windows is that it handles updates
            automatically. This means that you don't have to manually search for and download updates, which can be
            time-consuming and tedious. Install Doctor ensures that your Windows installation is always up-to-date and
            secure.
          </Paragraph>
          <Paragraph class="quote-summary">
            Another benefit of using Install Doctor to provision Windows is that it can install software that requires
            rebooting, such as Docker, without any manual intervention. This can save you time and effort, especially if
            you are provisioning multiple systems.
          </Paragraph>
          <Paragraph class="quote-summary">
            Additionally, Install Doctor comes with optimized configurations for thousands of programs. This means that
            when you install a particular program, Install Doctor automatically configures it to run optimally on your
            Windows system. This can help to ensure that your programs run smoothly and efficiently, which can be
            particularly important in resource-intensive environments like data centers or gaming setups.
          </Paragraph>
          <Paragraph class="quote-summary">
            In conclusion, if you need to provision Windows systems, using an installation framework like Install Doctor
            can save you time and effort, while ensuring that your installations are up-to-date, secure, and optimized
            for your specific needs. With Install Doctor, you can handle updates automatically, install software that
            requires rebooting, and take advantage of optimized configurations for thousands of programs. These features
            make Install Doctor an excellent choice for anyone who needs to provision Windows systems efficiently and
            reliably.
          </Paragraph>
        </div>
      </ResponsiveContainer>
      <ResponsiveContainer id="getting-started" as="section">
        <article class="step">
          <sup class="ui-heading-6">01</sup>
          <div class="heading-group">
            <Heading level={3} id="install">
              Provision Windows.
            </Heading>
            <Paragraph>
              Native Windows provisioning remains experimental until the PowerShell entrypoint passes the signed-release
              and clean-host acceptance matrix. Use WSL2 only where its Linux support cell is explicitly verified.
            </Paragraph>
          </div>
          <div class="code-panel">
            <code-snippet
              language="shell-session"
              code={`# No release-verified native Windows installer is currently published.`}
            />
          </div>
        </article>

        <article class="step">
          <sup class="ui-heading-6">02</sup>
          <div class="heading-group">
            <Heading level={3}>Launch web services.</Heading>
            <div class="platforms">
              <img
                loading="lazy"
                src="/assets/img/landing/docker-swarm.png"
                alt="Docker Swarm"
                class="vm-icon"
                width="37"
                height="37"
              />
              <img
                loading="lazy"
                src="/assets/img/landing/kubesphere.png"
                alt="KubeSphere"
                class="vm-icon"
                width="37"
                height="37"
              />
              <img
                loading="lazy"
                src="/assets/img/landing/cloudflare.png"
                alt="CloudFlare"
                class="vm-icon"
                width="37"
                height="37"
              />
            </div>
            <Paragraph>
              Launch a suite of web services via Docker Swarm and KubeSphere. Access all your machines over a VPN subnet
              through an explicitly configured private tunnel and host SSO-protected web apps via Cloudflare Access.
            </Paragraph>
          </div>
          <div class="code-panel">
            <code-snippet
              language="shell-session"
              code={`
run setup:webapps
`}
            />
          </div>
        </article>

        <article class="step">
          <sup class="ui-heading-6">03</sup>
          <div class="heading-group">
            <Heading level={3}>Launch and provision VMs.</Heading>
            <div class="platforms">
              <img
                loading="lazy"
                src="/assets/img/landing/hyperv.png"
                alt="Hyper-V"
                class="vm-icon"
                width="37"
                height="37"
              />
              <img
                loading="lazy"
                src="/assets/img/landing/parallels.png"
                alt="Parallels"
                class="vm-icon"
                width="37"
                height="37"
              />
              <img
                loading="lazy"
                src="/assets/img/landing/qemu.png"
                alt="QEMU"
                class="vm-icon"
                width="37"
                height="37"
              />
              <img
                loading="lazy"
                src="/assets/img/landing/virtualbox.png"
                alt="VirtualBox"
                class="vm-icon"
                width="37"
                height="37"
              />
              <img
                loading="lazy"
                src="/assets/img/landing/vmware.png"
                alt="VMWare"
                class="vm-icon"
                width="37"
                height="37"
              />
            </div>
            <Paragraph>
              Create Archlinux, CentOS, Debian, Fedora, macOS, Ubuntu, and Windows VMs using almost any virtualization
              platform. Create disposable environments, improve security, and run macOS / Windows.
            </Paragraph>
          </div>
          <div class="code-panel">
            <code-snippet
              language="shell-session"
              code={`
run setup:vms
`}
            />
          </div>
        </article>
      </ResponsiveContainer>
    </Fragment>
  );
};
