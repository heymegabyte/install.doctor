import { Component, h, Host, Prop, State } from '@stencil/core';
import {
  ResponsiveContainer,
  Col,
  Grid,
  Heading,
  Breakpoint,
  Button,
  PrismicRichText,
  Paragraph,
} from 'ionic-ds-no-fonts';
import { href } from '@stencil/router';
import { LandingPageData } from 'src/store';

@Component({
  tag: 'landing-page',
  styleUrl: 'landing-page.scss',
  scoped: true,
})
export class LandingPage {
  @Prop() data: typeof LandingPageData;
  @Prop() template;

  @State() selectedCodeTab: string = 'notifications';
  @State() ebookModalOpen = false;
  isTouchscreen =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    (navigator as any).msMaxTouchPoints > 0 ||
    window.innerWidth < 1024;

  render() {
    const {
      Top,
      Started,
      // Ebook,
      Native,
      Features,
      Framework,
      // Tweets,
      Cta,
    } = this;
    return (
      <Host>
        <meta-tags
          defaults={this.data.defaults}
          pageTitle={this.data.defaults.landingPage.meta.pageTitle}
          description={this.data.defaults.landingPage.meta.description}
        />
        <site-header defaults={this.data.defaults} class="heading-container" sticky={true} />
        <top-parallax data={this.data} />
        <Top />
        <Started />
        {/* <Ebook /> */}
        <Native />
        <Features />
        <Framework />
        {/* <Tweets /> */}
        <Cta />
        <pre-footer defaults={this.data.defaults} />
        <capacitor-site-footer defaults={this.data.defaults} />
        <site-modal open={this.ebookModalOpen} onModalClose={() => (this.ebookModalOpen = false)}>
          <Heading level={2}>{this.data.defaults.eBookSiteModal.title}</Heading>
          <Paragraph>
            Fill out and submit the form below to get your free copy of <b>{this.data.defaults.eBookSiteModal}</b> sent
            to your e-mail.
          </Paragraph>
          <capacitor-hubspot-form defaults={this.data.defaults} />
        </site-modal>
      </Host>
    );
  }

  Top = () => {
    const { Announcement } = this;
    const { top, top__ctas, top__link, top__hero, top__icons } = this.data;
    const { primary, secondary } = top__ctas[0];
    return (
      <section id="start" class={{ 'touchscreen-start': this.isTouchscreen }}>
        <div class="background"></div>
        <ResponsiveContainer id="welcome">
          <div class="heading-group">
            <Announcement />
            <PrismicRichText richText={top} paragraphLevel={2} />
            <div class="buttons">
              <Button
                kind="round"
                anchor
                href={this.data.defaults.landingPage.topSection.leftButtonHref}
                class="primary"
              >
                {primary} <span class="arrow"> -&gt;</span>
              </Button>
              <Button
                kind="round"
                variation="light"
                anchor
                href={this.data.defaults.landingPage.topSection.rightButtonHref}
                class="secondary"
              >
                {secondary}
              </Button>
            </div>
            <a
              class="link ui-paragraph-4 underline-hover customize-link"
              href={this.data.defaults.landingPage.topSection.smallTextHref}
            >
              {top__link}
              <span class="arrow"> -&gt;</span>
            </a>
            <p class="passion-project">
              Install Doctor is a passion-project maintained by{' '}
              <a href="https://megabyte.space" target="_blank" rel="noopener" class="underline-hover link">
                Megabyte Labs
              </a>{' '}
              that aims to allow users to reformat daily without losing their desired state.
            </p>
            <a href="https://megabyte.space" class="heart-megabyte" target="_blank" rel="noopener">
              <prismic-image loading="eager" image={top__icons} width="91" height="16" defaults={this.data.defaults} />
            </a>
          </div>
          <div class="image-wrapper">
            <prismic-image defaults={this.data.defaults} width="392" height="392" loading="eager" image={top__hero} />
          </div>
        </ResponsiveContainer>
      </section>
    );
  };

  Announcement = () => {
    const { tag_text, desktop_text, mobile_text, link } = this.data.announcement;
    const { target, url } = link;

    const newUrl = url.replace(window.location.origin, '');

    return (
      <a
        id="announcement"
        class="feature__register"
        href={newUrl}
        target={target}
        rel={target ? 'noopener' : undefined}
      >
        <div class="tag">{tag_text}</div>
        <Breakpoint sm={true} display="inline-block" class="text">
          <span class="text__content">
            {desktop_text} <span class="arrow">-&gt;</span>
          </span>
        </Breakpoint>
        <Breakpoint xs={true} sm={false} display="inline-block" class="text">
          <span class="text__content">
            {mobile_text} <span class="arrow">-&gt;</span>
          </span>
        </Breakpoint>
      </a>
    );
  };

  Started = () => {
    const { started, started__list } = this.data;

    const panels = [
      <code-tabs
        data={{
          tabs: ['Linux/macOS', 'Windows', 'Qubes'],
          languages: ['bash', 'powershell', 'bash'],
          code: [
            `bash <(curl -sSL "https://install.doctor/start")`,
            `iex ((New-Object System.Net.WebClient).DownloadString('https://install.doctor/windows'))`,
            `qvm-run --pass-io sys-firewall "curl -sSL 'https://install.doctor/qubes'" > ~/setup.sh && bash ~/setup.sh`,
          ],
        }}
      />,
      <code-tabs
        data={{
          tabs: ['Linux/macOS', 'Windows', 'Qubes'],
          languages: ['bash', 'powershell', 'bash'],
          code: [
            `export START_REPO="my-gh-user/my-fork-name"
bash <(curl -sSL "https://install.doctor/start")
`,
            `
$env:START_REPO = 'my-gh-user/my-fork-name'
iex ((New-Object System.Net.WebClient).DownloadString('https://install.doctor/windows'))
`,
            `export START_REPO="my-gh-user/my-fork-name"
qvm-run --pass-io sys-firewall "curl -sSL https://install.doctor/qubes" > ~/setup.sh && bash ~/setup.sh`,
          ],
        }}
      />,
      <code-tabs
        data={{
          tabs: ['Linux/macOS', 'Windows', 'Qubes'],
          languages: ['bash', 'powershell', 'bash'],
          code: [
            `echo "Headlessly provisioning a Linux / macOS / Unix machine"
export HEADLESS_INSTALL=true
export SOFTWARE_GROUP="Standard-Desktop"
export FULL_NAME="Joe Shmoe"
export PUBLIC_SERVICES_DOMAIN="megabyte.space"
export CLOUDFLARE_API_TOKEN="cf-pat-xXP999kUu888777"
export TAILSCALE_AUTH_KEY="tailscale-auth-key-xXP999kUu888777"
export START_REPO="my-gh-user/my-fork-name"
bash <(curl -sSL "https://install.doctor/start")`,
            `Write-Host "Headlessly provisioning a Windows machine"
$env:HEADLESS_INSTALL = 'true'
$env:SOFTWARE_GROUP = 'Standard-Desktop'
$env:FULL_NAME = 'Joe Shmoe'
$env:PUBLIC_SERVICES_DOMAIN = 'megabyte.space'
$env:CLOUDFLARE_API_TOKEN = 'cf-pat-xXP999kUu888777'
$env:TAILSCALE_AUTH_KEY = 'tailscale-auth-key-xXP999kUu888777'
$env:START_REPO = 'my-gh-user/my-fork-name'
iex ((New-Object System.Net.WebClient).DownloadString('https://install.doctor/windows'))`,
            `echo "Headlessly provisioning Qubes from dom0"
export HEADLESS_INSTALL=true
export SOFTWARE_GROUP=Standard-Desktop
export FULL_NAME="Joe Shmoe"
export PUBLIC_SERVICES_DOMAIN="megabyte.space"
export CLOUDFLARE_API_TOKEN="cf-pat-xXP999kUu888777"
export TAILSCALE_AUTH_KEY="tailscale-auth-key-xXP999kUu888777"
export START_REPO="my-gh-user/my-fork-name"
qvm-run --pass-io sys-firewall "curl -sSL https://install.doctor/qubes" > ~/setup.sh
bash ~/setup.sh`,
          ],
        }}
      />,
      <code-snippet
        language="yaml"
        code={`---
softwarePackages:
  imagemagick:
    _bin: convert
    apk: imagemagick
    apt:
      - imagemagick
      - libx11-dev
    brew: imagemagick
    choco: imagemagick
    dnf:fedora: imagemagick
    scoop: imagemagick`}
      />,
      <code-snippet
        language="yaml"
        code={`---
chromeExtensions:
  - automa/infppggnoaenmfagbfknfkancpbljcca
  - buffer/noojglkidnpfjbincgijbaiedldjfbhh
  - falcon/mmifbbohghecjloeklpbinkjpbplfalb
firefoxAddOns:
  - automa
  - buffer-for-firefox
  - chatgpt-for-google
  - firefox-translations
  - floccus
  - ublock-origin`}
      />,
      <code-snippet
        language="bash"
        code={`
# The following command will create backups of
# compatible application settings and store them
# in encrypted form in either S3 or the git fork.
run snapshot
        `}
      />,
    ];

    return (
      <ResponsiveContainer id="started" as="section">
        <div class="heading-group">
          <PrismicRichText richText={started} />
        </div>
        {started__list.map(({ number, title, text }, i) => (
          <div class="step">
            <sup class="ui-heading-6">{number}</sup>
            <div class="heading-panel-wrapper">
              <div class="heading-wrapper">
                <Heading>{title}</Heading>
                {text ? <Paragraph>{text}</Paragraph> : null}
              </div>
              <div class="panel">{panels[i]}</div>
            </div>
          </div>
        ))}
      </ResponsiveContainer>
    );
  };

  Ebook = () => {
    const { ebook } = this.data;
    const { text, cta1: cta, background, book } = ebook[0];

    return (
      <section id="ebook">
        <ResponsiveContainer>
          <div class="wrapper">
            <prismic-image defaults={this.data.defaults} image={background} class="background" />
            <div class="content">
              <div class="image-wrapper">
                <prismic-image defaults={this.data.defaults} image={book} />
              </div>
              <div class="heading-group">
                <PrismicRichText paragraphLevel={1} richText={text} />
                <Button kind="round" size="md" onClick={() => (this.ebookModalOpen = true)}>
                  {cta} <span class="arrow"> -&gt;</span>
                </Button>
              </div>
            </div>
          </div>
        </ResponsiveContainer>
      </section>
    );
  };

  Native = () => {
    const { native, native__list } = this.data;
    const dimensions = ['64x64', '64x64', '64x64'];

    return (
      <ResponsiveContainer id="native" as="section">
        <div class="heading-group underline-hover">
          <PrismicRichText richText={native} />
        </div>
        <Grid>
          {native__list.map(({ icon, item }, i: number) => (
            <Col xs={6} sm={4} cols={12}>
              <prismic-image
                defaults={this.data.defaults}
                image={icon}
                width={dimensions[i].split('x')[0]}
                height={dimensions[i].split('x')[1]}
              />
              <PrismicRichText richText={item} />
            </Col>
          ))}
        </Grid>
      </ResponsiveContainer>
    );
  };

  Features = () => {
    const { features, features__list, features__link } = this.data;
    const dimensions = ['48x48', '48x48', '48x48', '48x48', '48x48', '48x48', '48x48', '48x48'];

    return (
      <section id="features">
        <ResponsiveContainer>
          <div class="heading-group underline-heading">
            <PrismicRichText richText={features} />
            <a href={this.data.defaults.landingPage.featureGridTopLinkHref} class="link ui-heading-4">
              {features__link}
              <span class="arrow">-&gt;</span>
            </a>
          </div>
          <Grid>
            {features__list.map(({ icon, item }, i: number) => (
              <Col xs={6} sm={4} md={3} cols={12}>
                <prismic-image
                  defaults={this.data.defaults}
                  image={icon}
                  width={dimensions[i].split('x')[0]}
                  height={dimensions[i].split('x')[1]}
                />
                <PrismicRichText richText={item} />
              </Col>
            ))}
          </Grid>
        </ResponsiveContainer>
      </section>
    );
  };

  Framework = () => {
    const { framework, framework__list } = this.data;

    const logoTile = (logo: any) => (
      <prismic-image defaults={this.data.defaults} image={logo} width="272" height="200" />
    );

    return (
      <ResponsiveContainer id="framework" as="section">
        <div id="framework-text" class="heading-group">
          <PrismicRichText richText={framework} paragraphLevel={3} />
        </div>
        <Grid>
          {framework__list.map(({ logo, link }) => (
            <Col sm={3} cols={6}>
              {link ? <a {...href(link)}>{logoTile(logo)}</a> : logoTile(logo)}
            </Col>
          ))}
        </Grid>
      </ResponsiveContainer>
    );
  };

  Tweets = () => {
    const { tweets, tweets__list, tweets__bottom, tweets__bottom__list } = this.data;
    const { title } = tweets[0];
    const { emoji, text } = tweets__bottom[0];

    return (
      <section id="tweets">
        <ResponsiveContainer>
          <div class="heading-group">
            <PrismicRichText richText={title} />
          </div>
          <div class="tweets">
            {tweets__list.map(({ name, handle, text, image, verified }, i) => (
              <article class="tweet" key={i}>
                <div class="title-row">
                  <prismic-image defaults={this.data.defaults} image={image} />
                  <div class="title">
                    <Heading level={5} as="h3">
                      {name}
                      {verified && (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                          <path
                            fill="#1DA1F2"
                            d="M512 268c0 17.9-4.3 34.5-12.9 49.7a92 92 0 01-34.6 35.4c.4 2.7.6 6.9.6 12.6 0 27.1-9.1 50.1-27.1 69.1a86.8 86.8 0 01-65.4 28.6 85.6 85.6 0 01-32.6-6.3 99.2 99.2 0 01-34.6 39.7A86 86 0 01256 512a86.8 86.8 0 01-49.7-14.9 97 97 0 01-34.3-40 85.3 85.3 0 01-32.6 6.3 87.8 87.8 0 01-65.7-28.6 96 96 0 01-26.3-81.7 92.7 92.7 0 01-34.6-35.4A100.3 100.3 0 010 268c0-19 4.8-36.5 14.3-52.3a88.1 88.1 0 0138.3-35.1 98.9 98.9 0 01-6.3-34.3 96 96 0 0127.4-69.1A88.1 88.1 0 01172 54.9a99.2 99.2 0 0134.6-39.7A86.7 86.7 0 01256 0c17.9 0 34.4 5.1 49.4 15.1A100 100 0 01340 54.8a85.3 85.3 0 0132.6-6.3c25.5 0 47.3 9.5 65.4 28.6a96.7 96.7 0 0127.1 69.1c0 12.6-1.9 24-5.7 34.3a88.1 88.1 0 0138.3 35.1A100.4 100.4 0 01512 268zm-266.9 77.1l105.7-158.3c2.7-4.2 3.5-8.8 2.6-13.7-1-4.9-3.5-8.8-7.7-11.4a19.5 19.5 0 00-13.7-2.9c-5 .8-9 3.2-12 7.4l-93.1 140-42.9-42.8a17 17 0 00-13.1-5.4c-5 .2-9.3 2-13.1 5.4a17.5 17.5 0 00-5.1 12.9c0 5.1 1.7 9.4 5.1 12.9l58.9 58.9 2.9 2.3c3.4 2.3 6.9 3.4 10.3 3.4 6.7-.1 11.8-2.9 15.2-8.7z"
                          />
                        </svg>
                      )}
                    </Heading>
                    <Paragraph level={6}>{handle}</Paragraph>
                  </div>
                  <svg width="16" height="13" viewBox="0 0 16 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M16 1.54036C15.41 1.80104 14.7794 1.97708 14.1149 2.05833C14.793 1.65208 15.3151 1.00885 15.5592 0.24375C14.9252 0.619531 14.2234 0.89375 13.474 1.03932C12.8739 0.399479 12.0195 0 11.0769 0C9.26298 0 7.79487 1.46927 7.79487 3.28047C7.79487 3.53776 7.822 3.78828 7.87963 4.02865C5.15024 3.89323 2.72939 2.58646 1.1121 0.599219C0.830685 1.08333 0.667938 1.6487 0.667938 2.24792C0.667938 3.38542 1.25111 4.39089 2.13266 4.97995C1.59017 4.96641 1.08159 4.81745 0.640814 4.57031V4.61094C0.640814 6.20208 1.77326 7.52578 3.27527 7.82708C3.00064 7.90156 2.70905 7.94219 2.41068 7.94219C2.20047 7.94219 1.99364 7.92188 1.7936 7.88125C2.21064 9.18464 3.42445 10.1326 4.86205 10.1596C3.73978 11.0398 2.32253 11.5646 0.783217 11.5646C0.518754 11.5646 0.257682 11.5477 0 11.5172C1.44776 12.4583 3.17355 13 5.02479 13C11.0701 13 14.3725 7.99974 14.3725 3.66302C14.3725 3.52083 14.3691 3.37865 14.3624 3.23984C15.0032 2.77604 15.5592 2.20052 16 1.54036Z"
                      fill="#1DA1F2"
                    />
                  </svg>
                </div>

                <PrismicRichText richText={text} paragraphLevel={4} className="content" />
              </article>
            ))}
          </div>
          <div class="bottom">
            <Paragraph class="emoji">{emoji}</Paragraph>
            <PrismicRichText richText={text} paragraphLevel={1} />
            <div class="links">
              {tweets__bottom__list.map(({ icon, text, link }) => (
                <a href={link.url} target={link.target}>
                  <article>
                    <prismic-image defaults={this.data.defaults} image={icon} />
                    <Heading level={4}>{text}</Heading>
                  </article>
                </a>
              ))}
            </div>
          </div>
        </ResponsiveContainer>
      </section>
    );
  };

  Cta = () => {
    const { cta } = this.data;
    const { image, title, text, cta1 } = cta[0];

    const { get_started2: get_started, get_started__ctas } = this.data;
    const { title: get_started_title, text: get_started_text } = get_started[0];
    const { primary, secondary } = get_started__ctas[0];

    return (
      <section id="multisection">
        <ResponsiveContainer>
          <div id="cta">
            <PrismicRichText richText={title} />
            <div class="wrapper">
              <div class="card">
                <prismic-image defaults={this.data.defaults} image={image} class="background" />
                <div class="heading-group">
                  <PrismicRichText richText={text} paragraphLevel={1} />
                  <Button kind="round" {...href(this.data.defaults.landingPage.ctaLink)}>
                    {cta1} <span class="arrow"> -&gt;</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div id="get-started">
            <div class="heading-group">
              <Heading level={2}>{get_started_title}</Heading>
              <Paragraph level={2}>{get_started_text}</Paragraph>
            </div>
            <div class="ctas">
              <Button
                href={this.data.defaults.landingPage.getStartedLeftButtonHref}
                kind="round"
                anchor
                class="secondary"
                color="cyan"
              >
                {primary}
                <span class="arrow"> -&gt;</span>
              </Button>
              <Button
                href={this.data.defaults.landingPage.getStartedRightButtonHref}
                anchor
                kind="round"
                variation="light"
                class="primary"
                color="cyan"
              >
                {secondary}
                <span class="arrow"> -&gt;</span>
              </Button>
            </div>
          </div>
        </ResponsiveContainer>
      </section>
    );
  };
}
