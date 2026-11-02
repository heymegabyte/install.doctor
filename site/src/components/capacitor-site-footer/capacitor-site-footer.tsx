import { Component, Host, State, h, Fragment, Prop } from '@stencil/core';
import { href } from '@stencil/router';
import { defaults } from '../../store';
import { ResponsiveContainer, Grid, Col, Heading, Paragraph } from 'ionic-ds-no-fonts';

declare global {
  interface Window {
    hbspt: {
      forms: {
        create: ({}) => any;
      };
    };
  }
}


@Component({
  tag: 'capacitor-site-footer',
  styleUrl: 'capacitor-site-footer.scss',
})
export class CapacitorSiteFooter {
  @Prop() defaults: typeof defaults;
  @State() email: string = '';
  @State() isLoading: boolean = false;
  @State() hasSubmitted: boolean = false;
  @State() isValid: boolean = true;
  @State() inlineMessage: string = '';

  componentWillLoad() {}

  handleNewsletterSubmit(e: Event) {
    e.preventDefault();

    this.isLoading = true;

    const xhr = new XMLHttpRequest();
    const url = this.defaults.emailForm.url;

    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        this.isLoading = false;
      }
      if (xhr.readyState === 4 && xhr.status === 200) {
        this.inlineMessage = 'Successfully added ' + this.email;
        this.hasSubmitted = true;
        this.isValid = true;
      } else if (xhr.readyState == 4 && xhr.status === 400) {
        console.error(`Failed to add ${this.email}`, xhr);
        const json = JSON.parse(xhr.responseText);
        this.inlineMessage = json.error;
        this.isValid = false;
        this.hasSubmitted = false;
      } else if (xhr.readyState == 4) {
        const json = JSON.parse(xhr.responseText);
        this.inlineMessage = json.error;
        this.isValid = false;
        this.hasSubmitted = false;
      }
    };
    const customFields: any = {};
    let slug = (url) => new URL(url).pathname.match(/[^\/]+/g);
    const slugs = slug(window.location.href);
    customFields.join_href = window.location.href;
    if (slugs) {
      customFields.join_slug = slugs.pop();
    }
    customFields.join_type = 'footer';
    xhr.send(
      JSON.stringify({
        list_ids: [this.defaults.sendGridListId],
        contacts: [
          {
            email: this.email,
            custom_fields: customFields,
          },
        ],
      })
    );
  }

  handleEmailChange(ev: any) {
    this.email = ev.target.value;
    this.isValid = true;
  }

  companyLink() {
    if (this.defaults.companyUrl !== this.defaults.homepage) {
      return (
        <Fragment>
          <a class="underline-hover link" href={this.defaults.companyUrl} target="_blank" rel="noopener">
            {this.defaults.companyFooterBrandName}
          </a>{' '}
          | Released under <span id="mit">{this.defaults.license} License</span>
        </Fragment>
      );
    } else {
      return (
        <Fragment>
          <a class="underline-hover link" {...href('/')}>
            {this.defaults.companyFooterBrandName}
          </a>{' '}
          | Released under <span id="mit">{this.defaults.license} License</span>
        </Fragment>
      );
    }
  }

  render() {
    return (
      <Host>
        <footer>
          <ResponsiveContainer>
            <div class="newsletter">
              <div>
                <Heading level={4}>Join our Newsletter</Heading>
                <Paragraph level={4} class="join-our-newsletter">
                  Keep up to date with all the latest {this.defaults.brandName} news and updates. Be the first to know
                  about popular, trending open-source productivity tools that we integrate into our stack.
                </Paragraph>
              </div>
              <div class="form-group" aria-live="polite">
                {this.hasSubmitted ? (
                  <div class="form-message" role="status">
                    <ion-icon name="checkmark-circle" class="success-color" aria-hidden="true"></ion-icon>
                    <Paragraph>{this.inlineMessage}</Paragraph>
                  </div>
                ) : (
                  <form class="hs-form" onSubmit={(e) => this.handleNewsletterSubmit(e)}>
                    <div class="hs_email hs-email hs-fieldtype-text field hs-form-field">
                      <div class="input">
                        <input
                          name="email"
                          type="email"
                          autocomplete="email"
                          inputmode="email"
                          value={this.email}
                          onInput={(ev) => this.handleEmailChange(ev)}
                          disabled={this.isLoading}
                          placeholder="E-mail"
                          class={{ error: !this.isValid, 'ui-paragraph-4': true }}
                          aria-label="Email"
                          aria-invalid={String(!this.isValid)}
                          required
                        />
                      </div>
                    </div>
                    <div class="hs_submit hs-submit">
                      <div class="actions">
                        <input type="submit" class="hs-button primary large" value="Subscribe" />
                      </div>
                    </div>
                    {!this.isValid && (
                      <Paragraph level={5} class="error-message">
                        {this.inlineMessage}
                      </Paragraph>
                    )}
                  </form>
                )}
              </div>
            </div>
            <Grid>
              <Col md={6} sm={4} xs={12} cols={12} class="copyright">
                <webp-image
                  src="/assets/img/logo-white.png"
                  alt={this.defaults.brandName + ' logo'}
                  class="logo"
                  loading="lazy"
                  width="200"
                  height="28"
                />
                <div class="footer-social-wrapper">
                  <a
                    class="footer-social github hint--top hint--rounded"
                    href={this.defaults.social.github}
                    target="_blank"
                    rel="noopener"
                    aria-label="GitHub"
                  >
                    <ion-icon name="logo-github"></ion-icon>
                  </a>
                  <a
                    class="footer-social gitlab hint--top hint--rounded"
                    href={this.defaults.social.gitlab}
                    target="_blank"
                    rel="noopener"
                    aria-label="GitLab"
                  >
                    <ion-icon name="logo-gitlab"></ion-icon>
                  </a>
                  <a
                    class="footer-social slack hint--top hint--rounded"
                    href={this.defaults.social.slack}
                    target="_blank"
                    rel="noopener"
                    aria-label="Slack"
                  >
                    <ion-icon name="logo-slack"></ion-icon>
                  </a>
                  <a
                    class="footer-social discord hint--top hint--rounded"
                    href={this.defaults.social.discord}
                    target="_blank"
                    rel="noopener"
                    aria-label="Discord"
                  >
                    <ion-icon name="logo-discord"></ion-icon>
                  </a>
                  <a
                    class="footer-social facebook hint--top hint--rounded"
                    href={this.defaults.social.facebook}
                    target="_blank"
                    rel="noopener"
                    aria-label="Facebook"
                  >
                    <ion-icon name="logo-facebook"></ion-icon>
                  </a>
                  <a
                    class="footer-social twitter hint--top hint--rounded"
                    href={this.defaults.social.twitter}
                    target="_blank"
                    rel="noopener"
                    aria-label="Twitter (X)"
                  >
                    <ion-icon name="logo-twitter"></ion-icon>
                  </a>
                  <a
                    class="footer-social pinterest hint--top hint--rounded"
                    href={this.defaults.social.pinterest}
                    target="_blank"
                    rel="noopener"
                    aria-label="Pinterest"
                  >
                    <ion-icon name="logo-pinterest"></ion-icon>
                  </a>
                  <a
                    class="footer-social linkedin hint--top hint--rounded"
                    href={this.defaults.social.linkedin}
                    target="_blank"
                    rel="noopener"
                    aria-label="LinkedIn"
                  >
                    <ion-icon name="logo-linkedin"></ion-icon>
                  </a>
                  <a
                    class="footer-social youtube hint--top hint--rounded"
                    href={this.defaults.social.youtube}
                    target="_blank"
                    rel="noopener"
                    aria-label="YouTube"
                  >
                    <ion-icon name="logo-youtube"></ion-icon>
                  </a>
                  <a
                    class="footer-social instagram hint--top hint--rounded"
                    href={this.defaults.social.instagram}
                    target="_blank"
                    rel="noopener"
                    aria-label="Instagram"
                  >
                    <ion-icon name="logo-instagram"></ion-icon>
                  </a>
                  <a
                    class="footer-social threads hint--top hint--rounded"
                    href={this.defaults.social.threads}
                    target="_blank"
                    rel="noopener"
                    aria-label="Threads"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" aria-label="Threads" viewBox="0 0 192 192">
                      <path
                        class="x19hqcy"
                        d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.537 60.5382 122.616 44.905 97.5619 44.745C97.4484 44.7443 97.3355 44.7443 97.222 44.7443C82.2364 44.7443 69.7731 51.1409 62.102 62.7807L75.881 72.2328C81.6116 63.5383 90.6052 61.6848 97.2286 61.6848C97.3051 61.6848 97.3819 61.6848 97.4576 61.6855C105.707 61.7381 111.932 64.1366 115.961 68.814C118.893 72.2193 120.854 76.925 121.825 82.8638C114.511 81.6207 106.601 81.2385 98.145 81.7233C74.3247 83.0954 59.0111 96.9879 60.0396 116.292C60.5615 126.084 65.4397 134.508 73.775 140.011C80.8224 144.663 89.899 146.938 99.3323 146.423C111.79 145.74 121.563 140.987 128.381 132.296C133.559 125.696 136.834 117.143 138.28 106.366C144.217 109.949 148.617 114.664 151.047 120.332C155.179 129.967 155.42 145.8 142.501 158.708C131.182 170.016 117.576 174.908 97.0135 175.059C74.2042 174.89 56.9538 167.575 45.7381 153.317C35.2355 139.966 29.8077 120.682 29.6052 96C29.8077 71.3178 35.2355 52.0336 45.7381 38.6827C56.9538 24.4249 74.2039 17.11 97.0132 16.9405C119.988 17.1113 137.539 24.4614 149.184 38.788C154.894 45.8136 159.199 54.6488 162.037 64.9503L178.184 60.6422C174.744 47.9622 169.331 37.0357 161.965 27.974C147.036 9.60668 125.202 0.195148 97.0695 0H96.9569C68.8816 0.19447 47.2921 9.6418 32.7883 28.0793C19.8819 44.4864 13.2244 67.3157 13.0007 95.9325L13 96L13.0007 96.0675C13.2244 124.684 19.8819 147.514 32.7883 163.921C47.2921 182.358 68.8816 191.806 96.9569 192H97.0695C122.03 191.827 139.624 185.292 154.118 170.811C173.081 151.866 172.51 128.119 166.26 113.541C161.776 103.087 153.227 94.5962 141.537 88.9883ZM98.4405 129.507C88.0005 130.095 77.1544 125.409 76.6196 115.372C76.2232 107.93 81.9158 99.626 99.0812 98.6368C101.047 98.5234 102.976 98.468 104.871 98.468C111.106 98.468 116.939 99.0737 122.242 100.233C120.264 124.935 108.662 128.946 98.4405 129.507Z"
                      />
                    </svg>
                  </a>
                  <a
                    class="footer-social telegram hint--top hint--rounded"
                    href={this.defaults.social.telegram}
                    target="_blank"
                    rel="noopener"
                    aria-label="Telegram"
                  >
                    <ion-icon name="send"></ion-icon>
                  </a>
                  <a
                    class="footer-social matrix hint--top hint--rounded"
                    href={this.defaults.social.matrix}
                    target="_blank"
                    rel="noopener"
                    aria-label="Element Matrix chat"
                  >
                    <ion-icon name="chatbubbles-sharp"></ion-icon>
                  </a>
                </div>
                <p>
                  © {new Date().getFullYear()} {this.defaults.companyLegalName}
                </p>
                <p>{this.companyLink()}</p>
                <p>
                  <a class="underline-hover link" {...href('/privacy')}>
                    Privacy Policy
                  </a>{' '}
                  |{' '}
                  <a class="underline-hover link" {...href('/terms')}>
                    Terms of Service
                  </a>
                </p>
              </Col>
              <Col md={6} sm={8} xs={12} cols={12}>
                <div class="routes-group">
                  <div>
                    <Heading level={5}>Documentation</Heading>
                    <ul class="routes">
                      {this.defaults.documentationFooterLinks.map(({ title, href }) => (
                        <li>
                          <a class="ui-paragraph-4 underline-hover link" href={href}>
                            {title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <Heading level={5}>Resources</Heading>
                    <ul class="routes">
                      <li>
                        <a class="ui-paragraph-4 underline-hover link" href="/blog">
                          Blog
                        </a>
                      </li>
                      <li>
                        <a class="ui-paragraph-4 underline-hover link" {...href('/community')}>
                          Community
                        </a>
                      </li>
                      <li>
                        <a
                          class="ui-paragraph-4 underline-hover link"
                          href={this.defaults.social.githubDiscussions}
                          target="_blank"
                          rel="noopener"
                        >
                          Discussions
                        </a>
                      </li>
                      <li>
                        <a class="ui-paragraph-4 underline-hover link" {...href('/enterprise')}>
                          Enterprise
                        </a>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <Heading level={5}>Connect</Heading>
                    <ul class="routes">
                      <li>
                        <a
                          class="ui-paragraph-4 underline-hover link"
                          href={this.defaults.social.github}
                          target="_blank"
                          rel="noopener"
                        >
                          GitHub
                        </a>
                      </li>
                      <li>
                        <a
                          class="ui-paragraph-4 underline-hover link"
                          href={this.defaults.social.gitlab}
                          target="_blank"
                          rel="noopener"
                        >
                          GitLab
                        </a>
                      </li>
                      <li>
                        <a
                          class="ui-paragraph-4 underline-hover link"
                          href={this.defaults.social.facebook}
                          target="_blank"
                          rel="noopener"
                        >
                          Facebook
                        </a>
                      </li>
                      <li>
                        <a
                          class="ui-paragraph-4 underline-hover link"
                          href={this.defaults.social.twitter}
                          target="_blank"
                          rel="noopener"
                        >
                          Twitter
                        </a>
                      </li>
                    </ul>
                  </div>
                </div>
              </Col>
            </Grid>
          </ResponsiveContainer>
        </footer>
      </Host>
    );
  }
}
