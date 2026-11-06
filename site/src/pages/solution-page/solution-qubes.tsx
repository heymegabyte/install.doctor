import { Fragment, h } from '@stencil/core';
import { ResponsiveContainer, Heading, Paragraph } from 'ionic-ds-no-fonts';
export const SolutionQubes = () => {
  return (
    <Fragment>
      <ResponsiveContainer id="what-is" as="section">
        <div class="ui-container">
          <ion-icon class="what-is-info-icon" name="information-circle-outline"></ion-icon>
          <Heading class="quote-summary" level={2}>
            What is Qubes OS?
          </Heading>
          <Paragraph class="quote-summary">
            Qubes OS is a security-focused, open-source operating system that is designed to provide better security and
            isolation for its users. Unlike traditional operating systems, Qubes OS uses a unique approach to security
            called "Security by Compartmentalization."
          </Paragraph>
          <Paragraph class="quote-summary">
            This approach involves separating different applications and tasks into isolated compartments, called
            "qubes," which are each assigned a specific level of trust. For example, you can have a qube for your
            personal documents, a qube for browsing the web, and a qube for running sensitive applications. This way, if
            one qube is compromised, the others remain secure and unaffected.
          </Paragraph>
          <Paragraph class="quote-summary">
            Qubes OS also provides other security features, such as strict isolation of networking and USB devices,
            enforced memory management, and compartmentalized cryptography. It is designed to be used on a variety of
            hardware, including laptops and desktops, and supports a range of applications, including web browsing,
            email, office productivity, and multimedia.
          </Paragraph>
          <Paragraph class="quote-summary">
            Qubes OS is free and open-source, which means that anyone can access the source code and contribute to its
            development. It is often used by journalists, activists, and security professionals who require a high level
            of security and privacy in their work.
          </Paragraph>
        </div>
      </ResponsiveContainer>
      <ResponsiveContainer id="getting-started" as="section">
        <article class="step">
          <sup class="ui-heading-6">01</sup>
          <div class="heading-group">
            <Heading level={3} id="install">
              Provision Qubes.
            </Heading>
            <Paragraph>
              Interactively provision Qubes with feature-packed terminals, a slick theme, and a configurable lists of
              software for each Qubes VM. This one-liner will start the provisioning process when run from Qubes dom0.
            </Paragraph>
          </div>
          <div class="code-panel">
            <code-snippet
              language="shell-session"
              code={`
# No release-verified Qubes entrypoint is currently published.
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
              Launch a suite of web services via Docker Swarm and KubeSphere to a network-enabled VM. Access all your
              machines through an explicitly configured private tunnel and host SSO-protected web apps via Cloudflare Access.
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
      </ResponsiveContainer>
    </Fragment>
  );
};
