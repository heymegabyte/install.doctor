import { Fragment, h } from '@stencil/core';
import { ResponsiveContainer, Heading, Paragraph } from 'ionic-ds-no-fonts';
export const SolutionMacOS = () => {
  return (
    <Fragment>
      <ResponsiveContainer id="what-is" as="section">
        <div class="ui-container">
          <ion-icon class="what-is-info-icon" name="information-circle-outline"></ion-icon>
          <Heading class="quote-summary" level={2}>
            What is macOS and why should you provision it with Install Doctor?
          </Heading>
          <Paragraph class="quote-summary">
            If you need to provision macOS, using an installation framework like Install Doctor can make the process
            faster, easier, and more reliable. Here are some of the main reasons why you would want to use Install
            Doctor to provision macOS:
          </Paragraph>
          <ul class="quote-summary quote-summary-list">
            <li>
              <b>Optimized configurations for thousands of programs</b>: Install Doctor comes with preconfigured
              settings for thousands of popular programs, which can help to ensure that your applications run optimally
              on your macOS system.
            </li>
            <li>
              <b>Advanced terminal settings</b>: Install Doctor includes terminal settings that use the best open-source
              projects available, providing a powerful and flexible command-line environment that you can customize to
              suit your needs. With these settings, you can take advantage of features and capabilities that you may not
              have even known were possible.
            </li>
            <li>
              <b>Automatic macOS-specific optimizations</b>: Install Doctor handles macOS-specific optimizations
              automatically, ensuring that your system is configured to run smoothly and efficiently. This includes
              things like optimizing your system preferences, adjusting kernel settings, and more.
            </li>
            <li>
              <b>Time-saving automation</b>: With Install Doctor, you can automate many of the tasks involved in
              provisioning macOS, which can save you time and effort. This includes tasks like installing software,
              configuring settings, and setting up user accounts.
            </li>
            <li>
              <b>Improved security</b>: By using Install Doctor to provision macOS, you can ensure that your system is
              configured securely from the outset. Install Doctor includes security-focused settings and configurations
              that can help to protect your system from common threats and vulnerabilities.
            </li>
          </ul>

          <Paragraph class="quote-summary">
            Overall, if you need to provision macOS systems, using an installation framework like Install Doctor can
            make the process faster, easier, and more reliable. With optimized configurations for thousands of programs,
            advanced terminal settings, and automatic macOS-specific optimizations, Install Doctor can help you to
            configure your system to run optimally and securely. Additionally, the time-saving automation features can
            help to streamline the provisioning process, freeing up your time for other tasks.
          </Paragraph>
        </div>
      </ResponsiveContainer>
      <ResponsiveContainer id="getting-started" as="section">
        <article class="step">
          <sup class="ui-heading-6">01</sup>
          <div class="heading-group">
            <Heading level={3} id="install">
              Provision macOS.
            </Heading>
            <Paragraph>
              Interactively provision macOS with a feature-packed terminal, slick theme, and a configurable list of
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
