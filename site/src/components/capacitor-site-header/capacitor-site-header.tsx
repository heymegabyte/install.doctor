import { Element, Component, ComponentInterface, Host, Prop, State, h } from '@stencil/core';
import { href } from '@stencil/router';
import Router from '../../router';
import { Button } from 'ionic-ds-no-fonts';
import { DocsTemplate } from 'src/data.server/models';
import { defaults } from '../../store';
import { headerLogo, headerActionButtonIcon } from '../../icons';
//import { Translation } from '../../icons';

declare let window: any;

@Component({
  tag: 'site-header',
  styleUrl: 'capacitor-site-header.scss',
  scoped: true,
})
export class SiteHeader implements ComponentInterface {
  @Element() elm: HTMLElement;
  @Prop() template: DocsTemplate;
  @Prop() defaults: typeof defaults;
  @Prop() includeLogo = true;
  @Prop() includeBurger = false;
  @Prop() theme: 'light' | 'dark' = 'light';
  @Prop() sticky = true;

  @State() collapsed = false;
  @State() expanded = false;
  @State() scrolled = false;

  private routeListener = Symbol();
  private links: { [key: string]: HTMLElement } = {};
  // Could be an announcement banner or platform bar
  private heightAboveBar = 72;

  componentWillLoad() {
    this.createHeaderObserver();
    this.createRouteListener();
    setInterval(() => {
      this.handleActive(window.location);
    }, 5);
  }

  createHeaderObserver() {
    const opts = {
      root: document.body,
      rootMargin: `-${this.heightAboveBar + 1}px 0px 0px 0px`,
      threshold: 1.0,
    };

    const observer = new IntersectionObserver((entries) => {
      this.scrolled = !(entries[0].intersectionRatio < 1);
    }, opts);

    observer.observe(this.elm);
  }

  createRouteListener() {
    if (window.hasOwnProperty(this.routeListener)) return;

    window[this.routeListener] = true;
    Router.on('change', this.handleActive);
  }

  handleActive = (url: URL) => {
    const activeRoute = url.pathname.split('/')[1];

    for (const [key, value] of Object.entries(this.links)) {
      if (key === activeRoute) {
        value.classList.add('active');
      } else {
        value.classList.remove('active');
      }
    }
  };

  isActive(path: string): boolean {
    const prefix = new RegExp('^' + path, 'gm');
    const regexRes = prefix.test(Router.path);

    return regexRes;
  }

  toggleExpanded = () => (this.expanded = !this.expanded);

  render() {
    const { expanded, template, includeLogo, includeBurger } = this;

    return (
      <Host
        class={{
          scrolled: this.scrolled,
          [`theme--${this.theme}`]: true,
          sticky: this.sticky,
        }}
      >
        <site-backdrop visible={expanded} onClick={() => this.toggleExpanded()} mobileOnly />

        <header class="tt-site-navbar" data-theme-tools-site-navbar>
          {includeBurger ? <app-menu-toggle /> : null}

          {includeLogo ? (
            <a {...href('/')} aria-label="homepage link" class="tt-site-navbar-brand">
              {headerLogo()}
            </a>
          ) : null}

          <div class="docs-search-wrapper desktop-only">
            <docs-search defaults={this.defaults} theme={this.theme} />
          </div>
          {this.defaults.header.customLinks.map(({ title, href, templateId }) => (
            <a
              href={href}
              class={{
                'ui-paragraph-4': true,
                'first-links': true,
                active: template === templateId,
              }}
            >
              {title}
            </a>
          ))}

          <div class="separator desktop-only"></div>

          <nav
            class={{
              routes: true,
              'tt-site-navbar-navigation': true,
              expanded: this.expanded,
            }}
          >
            <div class="routes__header">
              <a aria-label="homepage link" class="logo-wrapper" {...href('/')}>
                {headerLogo()}
              </a>
              <button class="close" aria-label="close">
                <svg
                  onClick={this.toggleExpanded}
                  width="10"
                  height="10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9 9L1 1M9 1L1 9"
                    stroke="#B2BECD"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
            <a href="/blog" class="ui-paragraph-4" ref={(el) => (this.links.blog = el)}>
              Blog
            </a>
            <a {...href('/community')} class="ui-paragraph-4" ref={(el) => (this.links.community = el)}>
              Community
            </a>
            <a {...href('/enterprise')} class="ui-paragraph-4" ref={(el) => (this.links.enterprise = el)}>
              Enterprise
            </a>
          </nav>

          <div class="separator desktop-only"></div>

          <more-button onClick={() => this.toggleExpanded()} />

          <div class="ctas tt-site-navbar-utilities">
            <a
              href={this.defaults.social.github}
              target="_blank"
              title={this.defaults.brandName + "'s repository on GitHub"}
              rel="noopener"
              class="hint--bottom hint--rounded"
              aria-label="GitHub"
            >
              <svg class="social" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 0a8.1 8.1 0 0 0-8 8.2c0 3.63 2.3 6.7 5.47 7.79l.14.01c.3 0 .4-.22.4-.4v-1.4c-.3.06-.57.1-.81.1-1.54 0-1.89-1.2-1.89-1.2-.36-.95-.89-1.2-.89-1.2-.7-.5 0-.5.05-.5.8.06 1.23.84 1.23.84.4.7.94.9 1.41.9.38 0 .72-.12.92-.21.07-.53.28-.9.5-1.1-1.77-.2-3.64-.91-3.64-4.05 0-.9.31-1.63.82-2.2-.08-.21-.35-1.05.08-2.18l.18-.01c.3 0 .94.1 2.02.86a7.5 7.5 0 0 1 4.01 0c1.08-.75 1.73-.86 2.02-.86l.18.01c.44 1.13.16 1.97.08 2.18.5.57.82 1.3.82 2.2 0 3.15-1.87 3.84-3.65 4.04.28.25.54.75.54 1.52l-.01 2.25c0 .2.1.41.4.41l.15-.01A8.19 8.19 0 0 0 16 8.2 8.1 8.1 0 0 0 8 0Z"
                  fill="#B2BECD"
                />
              </svg>
            </a>
            <a
              href={this.defaults.social.discord}
              target="_blank"
              rel="noopener"
              title="Discord link"
              class="hint--bottom hint--rounded"
              aria-label="Discord"
            >
              <svg class="social" width="20" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M16.93 1.33A15.93 15.93 0 0 0 12.86 0c-.03 0-.05 0-.07.03-.17.33-.37.76-.5 1.1a14.52 14.52 0 0 0-4.57 0A11.3 11.3 0 0 0 7.2.03.06.06 0 0 0 7.14 0a15.89 15.89 0 0 0-4.1 1.35 18.4 18.4 0 0 0-2.93 12 16.3 16.3 0 0 0 5 2.65c.02 0 .05 0 .06-.03.39-.55.73-1.13 1.02-1.74a.07.07 0 0 0-.03-.1 10.7 10.7 0 0 1-1.56-.77.07.07 0 0 1 0-.12l.3-.25a.06.06 0 0 1 .07-.01 11.32 11.32 0 0 0 10.05 0h.06c.1.1.21.18.32.26.03.03.03.1-.01.12-.5.3-1.02.56-1.56.78a.07.07 0 0 0-.04.09c.3.6.65 1.2 1.03 1.74.01.03.04.04.07.03a16.24 16.24 0 0 0 5.02-2.7 18.26 18.26 0 0 0-2.98-11.97ZM6.68 10.9c-.98 0-1.8-.95-1.8-2.11 0-1.17.8-2.12 1.8-2.12 1.01 0 1.82.96 1.8 2.12 0 1.16-.8 2.11-1.8 2.11Zm6.65 0c-.99 0-1.8-.95-1.8-2.11 0-1.17.8-2.12 1.8-2.12s1.81.96 1.8 2.12c0 1.16-.8 2.11-1.8 2.11Z"
                  fill="#B2BECD"
                />
              </svg>
            </a>
            <a
              href={this.defaults.social.twitter}
              target="_blank"
              title="Twitter link"
              rel="noopener"
              class="hint--bottom hint--rounded"
              aria-label="Twitter"
            >
              <svg class="social" width="18" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M18 1.9c-.66.32-1.37.53-2.12.63A4 4 0 0 0 17.5.3c-.7.46-1.5.8-2.34.98A3.55 3.55 0 0 0 12.46 0c-2.04 0-3.7 1.8-3.7 4.04 0 .31.04.62.1.92A10.2 10.2 0 0 1 1.26.74 4.33 4.33 0 0 0 2.4 6.13a3.38 3.38 0 0 1-1.68-.5v.04a3.97 3.97 0 0 0 2.96 3.96 3.42 3.42 0 0 1-1.66.07 3.76 3.76 0 0 0 3.45 2.8A7.02 7.02 0 0 1 0 14.18 9.7 9.7 0 0 0 5.65 16c6.8 0 10.52-6.15 10.52-11.5L16.16 4A7.94 7.94 0 0 0 18 1.89Z"
                  fill="#B2BECD"
                />
              </svg>
            </a>
            <div class="fork-container hint--bottom hint--rounded" aria-label="Fork on GitHub">
              <Button
                class="primary ui-paragraph-4 tt-spring-press"
                anchor
                href={this.defaults.header.actionButton.href}
                target="_blank"
                kind="regular"
                color="cyan"
                size="md"
              >
                {headerActionButtonIcon()}
                {this.defaults.header.actionButton.title}
              </Button>
            </div>
          </div>
        </header>
      </Host>
    );
  }
}
