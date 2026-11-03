import { Fragment, h } from '@stencil/core';
import { ResponsiveContainer, Heading, Paragraph } from 'ionic-ds-no-fonts';
export const SolutionDebian = () => {
  return (
    <Fragment>
      <ResponsiveContainer id="what-is" as="section">
        <div class="ui-container">
          <ion-icon class="what-is-info-icon" name="information-circle-outline"></ion-icon>
          <Heading class="quote-summary" level={2}>
            What is Debian and why should you provision it with Install Doctor?
          </Heading>
          <Paragraph class="quote-summary">
            Debian is a widely used Linux distribution that is known for its stability, security, and open-source
            nature. It is maintained by the Debian Project, which is a community of volunteers who work together to
            develop and maintain the software. Debian is popular among both users and developers due to its vast
            repository of free, open-source software packages and its commitment to the principles of free software.
          </Paragraph>
          <Paragraph class="quote-summary">
            One reason why you would want to provision Debian properly with an installation framework like Install
            Doctor is that it can save you time and effort. The installation process for any operating system can be
            time-consuming and complicated, especially if you are installing it on multiple systems. An installation
            framework like Install Doctor can automate many of the tasks involved in installing and configuring the
            operating system, making the process faster and more efficient.
          </Paragraph>
          <Paragraph class="quote-summary">
            Another reason to use Install Doctor to provision Debian is that it has been heavily tested on Debian and is
            designed to work seamlessly with the operating system. This means that you can be confident that the
            installation process will be smooth and reliable, without any compatibility issues or other problems.
            Additionally, Install Doctor supports the installation of thousands of free, open-source software packages,
            which makes it easier to get up and running with the software you need.
          </Paragraph>
          <Paragraph class="quote-summary">
            In summary, Debian is a popular and well-respected Linux distribution that is known for its stability,
            security, and vast repository of free, open-source software packages. Provisioning it properly with an
            installation framework like Install Doctor can save time, increase efficiency, and ensure that installations
            are consistent and reliable. Furthermore, Install Doctor has been extensively tested on Debian and supports
            the installation of thousands of free, open-source software packages, making it an ideal tool for
            provisioning Debian systems.
          </Paragraph>
        </div>
      </ResponsiveContainer>
      <ResponsiveContainer id="getting-started" as="section">
        <article class="step">
          <sup class="ui-heading-6">01</sup>
          <div class="heading-group">
            <Heading level={3} id="install">
              Provision Debian.
            </Heading>
            <Paragraph>
              Interactively provision Debian with a feature-packed terminal, slick theme, and a configurable list of
              software.
            </Paragraph>
          </div>
          <div class="code-panel">
            <code-snippet
              language="shell-session"
              code={`
bash <(curl -sSL https://install.doctor/start)
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
