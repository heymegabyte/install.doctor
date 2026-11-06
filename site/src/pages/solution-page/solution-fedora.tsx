import { Fragment, h } from '@stencil/core';
import { ResponsiveContainer, Heading, Paragraph } from 'ionic-ds-no-fonts';
export const SolutionFedora = () => {
  return (
    <Fragment>
      <ResponsiveContainer id="what-is" as="section">
        <div class="ui-container">
          <ion-icon class="what-is-info-icon" name="information-circle-outline"></ion-icon>
          <Heading class="quote-summary" level={2}>
            What is Fedora and why should you provision it with Install Doctor?
          </Heading>
          <Paragraph class="quote-summary">
            Fedora is a popular Linux distribution that is known for being a community-driven project and an upstream
            source of many features found in other Linux distributions. It is maintained by the Fedora Project, which is
            sponsored by Red Hat. Fedora is often used by developers, system administrators, and enthusiasts who are
            interested in the latest technologies and software.
          </Paragraph>
          <Paragraph class="quote-summary">
            One reason why you would want to provision Fedora properly with an installation framework like Install
            Doctor is that it can save you time and effort. The installation process for any operating system can be
            time-consuming and complicated, especially if you are installing it on multiple systems. An installation
            framework like Install Doctor can automate many of the tasks involved in installing and configuring the
            operating system, making the process faster and more efficient.
          </Paragraph>
          <Paragraph class="quote-summary">
            Another reason to use Install Doctor to provision Fedora is that it can help ensure that the installation is
            consistent and reliable. When you manually install an operating system, there is a greater chance of human
            error, which can lead to inconsistencies and problems down the line. With an installation framework, you can
            ensure that each system is configured exactly the same way, reducing the likelihood of errors and making it
            easier to troubleshoot if problems do occur.
          </Paragraph>
          <Paragraph class="quote-summary">
            In summary, Fedora is a popular Linux distribution that is used by developers, system administrators, and
            enthusiasts who are interested in the latest technologies and software. Provisioning it properly with an
            installation framework like Install Doctor can save time, increase efficiency, and ensure that installations
            are consistent and reliable.
          </Paragraph>
        </div>
      </ResponsiveContainer>
      <ResponsiveContainer id="getting-started" as="section">
        <article class="step">
          <sup class="ui-heading-6">01</sup>
          <div class="heading-group">
            <Heading level={3} id="install">
              Provision Fedora.
            </Heading>
            <Paragraph>
              Interactively provision Fedora with a feature-packed terminal, slick theme, and a configurable list of
              software.
            </Paragraph>
          </div>
          <div class="code-panel">
            <code-snippet
              language="shell-session"
              code={`
curl -fsSL https://app.install.doctor/start | bash
`}
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
