const path = require('path');
// const prismic = require('@prismicio/client');
// const fetch = require('node-fetch');
const fs = require('fs');

const BASE_URL = '/docs';

module.exports = {
  title: 'Install Doctor',
  tagline:
    'Documentation portal for Install Doctor, a multi-OS provisioning system designed to setup workstations and servers',
  url: 'https://install.doctor',
  baseUrl: `${BASE_URL}/`,
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
    localeConfigs: {
      en: { label: 'English' },
    },
  },
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'throw',
  favicon: 'img/meta/favicon.png',
  organizationName: 'megabyte-labs',
  projectName: 'install.doctor-docs',
  themeConfig: {
    colorMode: {
      defaultMode: 'light',
    },
    headTags: [
      {
        tagName: 'meta',
        attributes: {
          charset: 'utf-8',
        },
      },
      {
        tagName: 'meta',
        attributes: {
          'http-equiv': 'X-UA-Compatible',
          content: 'chrome=1',
        },
      },
      {
        tagName: 'meta',
        attributes: {
          'http-equiv': 'Content-Type',
          content: 'text/html',
          charset: 'utf-8',
        },
      },
      {
        tagName: 'meta',
        attributes: {
          'http-equiv': 'x-rim-auto-match',
          content: 'none',
        },
      },
      {
        tagName: 'meta',
        attributes: {
          'http-equiv': 'Content-Security-Policy',
          content: 'upgrade-insecure-requests',
        },
      },
      {
        tagName: 'meta',
        attributes: {
          property: 'og:site_name',
          content: 'Install Doctor',
        },
      },
      {
        tagName: 'meta',
        attributes: {
          property: 'fb:app_id',
          content: '669135071652897',
        },
      },
      {
        tagName: 'meta',
        attributes: {
          property: 'og:type',
          content: 'website',
        },
      },
      {
        tagName: 'link',
        attributes: {
          type: 'text/plain',
          rel: 'author',
          href: '/humans.txt',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'apple-touch-icon',
          type: 'image/png',
          sizes: '180x180',
          href: '/apple-touch-icon.png',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'icon',
          type: 'image/png',
          sizes: '32x32',
          href: '/favicon-32x32.png',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'icon',
          type: 'image/png',
          sizes: '16x16',
          href: '/favicon-16x16.png',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'manifest',
          href: '/manifest.json',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'mask-icon',
          color: '#000000',
          href: '/safari-pinned-tab.svg',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'dns-prefetch',
          href: 'https://www.googletagmanager.com',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'preload',
          href: '/assets/fonts/inter-v12-latin-regular.woff2',
          as: 'font',
          type: 'font/woff2',
          crossOrigin: 'anonymous',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'preload',
          href: '/assets/fonts/inter-v12-latin-500.woff2',
          as: 'font',
          type: 'font/woff2',
          crossOrigin: 'anonymous',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'preload',
          href: '/assets/fonts/inter-v12-latin-600.woff2',
          as: 'font',
          type: 'font/woff2',
          crossOrigin: 'anonymous',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'preload',
          href: '/assets/fonts/inter-v12-latin-700.woff2',
          as: 'font',
          type: 'font/woff2',
          crossOrigin: 'anonymous',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'preload',
          href: '/assets/fonts/roboto-mono-v22-latin-regular.woff2',
          as: 'font',
          type: 'font/woff2',
          crossOrigin: 'anonymous',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'preload',
          href: '/assets/fonts/roboto-mono-v22-latin-regular.woff2',
          as: 'font',
          type: 'font/woff2',
          crossOrigin: 'anonymous',
        },
      },
      {
        tagName: 'link',
        attributes: {
          rel: 'preload',
          href: '/assets/fonts/fontawesome-webfont.woff2',
          as: 'font',
          type: 'font/woff2',
          crossOrigin: 'anonymous',
        },
      },
      {
        tagName: 'link',
        rel: 'manifest',
        href: '/manifest.json', // your PWA manifest
      },
      {
        tagName: 'style',
        innerHTML: `
        @font-face {
          font-display: swap;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 400;
          src: url('/assets/fonts/inter-v12-latin-regular.eot');
          src: url('/assets/fonts/inter-v12-latin-regular.eot?#iefix') format('embedded-opentype'),
            url('/assets/fonts/inter-v12-latin-regular.woff2') format('woff2'),
            url('/assets/fonts/inter-v12-latin-regular.woff') format('woff'),
            url('/assets/fonts/inter-v12-latin-regular.ttf') format('truetype'),
            url('/assets/fonts/inter-v12-latin-regular.svg#Inter') format('svg');
        }

        @font-face {
          font-display: block;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 500;
          src: url('/assets/fonts/inter-v12-latin-500.eot');
          src: url('/assets/fonts/inter-v12-latin-500.eot?#iefix') format('embedded-opentype'),
            url('/assets/fonts/inter-v12-latin-500.woff2') format('woff2'),
            url('/assets/fonts/inter-v12-latin-500.woff') format('woff'),
            url('/assets/fonts/inter-v12-latin-500.ttf') format('truetype'),
            url('/assets/fonts/inter-v12-latin-500.svg#Inter') format('svg');
        }

        @font-face {
          font-display: swap;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 600;
          src: url('/assets/fonts/inter-v12-latin-600.eot');
          src: url('/assets/fonts/inter-v12-latin-600.eot?#iefix') format('embedded-opentype'),
            url('/assets/fonts/inter-v12-latin-600.woff2') format('woff2'),
            url('/assets/fonts/inter-v12-latin-600.woff') format('woff'),
            url('/assets/fonts/inter-v12-latin-600.ttf') format('truetype'),
            url('/assets/fonts/inter-v12-latin-600.svg#Inter') format('svg');
        }

        @font-face {
          font-display: swap;
          font-family: 'Inter';
          font-style: normal;
          font-weight: 700;
          src: url('/assets/fonts/inter-v12-latin-700.eot');
          src: url('/assets/fonts/inter-v12-latin-700.eot?#iefix') format('embedded-opentype'),
            url('/assets/fonts/inter-v12-latin-700.woff2') format('woff2'),
            url('/assets/fonts/inter-v12-latin-700.woff') format('woff'),
            url('/assets/fonts/inter-v12-latin-700.ttf') format('truetype'),
            url('/assets/fonts/inter-v12-latin-700.svg#Inter') format('svg');
        }

        @font-face {
          font-display: swap;
          font-family: 'Roboto Mono';
          font-style: normal;
          font-weight: 400;
          src: url('/assets/fonts/roboto-mono-v22-latin-regular.eot');
          src: url('/assets/fonts/roboto-mono-v22-latin-regular.eot?#iefix') format('embedded-opentype'),
            url('/assets/fonts/roboto-mono-v22-latin-regular.woff2') format('woff2'),
            url('/assets/fonts/roboto-mono-v22-latin-regular.woff') format('woff'),
            url('/assets/fonts/roboto-mono-v22-latin-regular.ttf') format('truetype'),
            url('/assets/fonts/roboto-mono-v22-latin-regular.svg#RobotoMono') format('svg');
        }

        @font-face {
          font-display: swap;
          font-family: 'Roboto Mono';
          font-style: normal;
          font-weight: 700;
          src: url('/assets/fonts/roboto-mono-v22-latin-700.eot');
          src: url('/assets/fonts/roboto-mono-v22-latin-700.eot?#iefix') format('embedded-opentype'),
            url('/assets/fonts/roboto-mono-v22-latin-700.woff2') format('woff2'),
            url('/assets/fonts/roboto-mono-v22-latin-700.woff') format('woff'),
            url('/assets/fonts/roboto-mono-v22-latin-700.ttf') format('truetype'),
            url('/assets/fonts/roboto-mono-v22-latin-700.svg#RobotoMono') format('svg');
        }

        @font-face {
          font-family: 'Pe-icon-7-stroke';
          src: url('/assets/fonts/Pe-icon-7-stroke.eot');
          src: url('/assets/fonts/Pe-icon-7-stroke.eot?#iefix') format('embedded-opentype'),
          , url('/assets/fonts/Pe-icon-7-stroke.woff2') format('woff2'),
            url('/assets/fonts/Pe-icon-7-stroke.woff') format('woff'),
            url('/assets/fonts/Pe-icon-7-stroke.ttf') format('truetype'),
            url('/assets/fonts/Pe-icon-7-stroke.svg#Pe-icon-7-stroke') format('svg');
          font-weight: normal;
          font-style: normal;
        }

        @font-face {
          font-family: revicons;
          src: url('/assets/fonts/revicons.eot');
          src: url('/assets/fonts/revicons.eot?#iefix') format('embedded-opentype'),
            url('/assets/fonts/revicons.woff2') format('woff2'),
            url('/assets/fonts/revicons.woff') format('woff'),
            url('/assets/fonts/revicons.ttf') format('truetype'),
            url('/assets/fonts/revicons.svg#revicons') format('svg');
          font-weight: 400;
          font-style: normal;
          font-display: swap
        }

        @font-face {
          font-family: 'FontAwesome';
          src: url('/assets/fonts/fontawesome-webfont.eot');
          src: url('/assets/fonts/fontawesome-webfont.eot?#iefix') format('embedded-opentype'), url('/assets/fonts/fontawesome-webfont.woff2') format('woff2'), url('/assets/fonts/fontawesome-webfont.woff') format('woff'), url('/assets/fonts/fontawesome-webfont.ttf') format('truetype'), url('/assets/fonts/fontawesome-webfont.svg#fontawesomeregular') format('svg');
          font-weight: normal;
          font-style: normal;
          font-display: swap;
        }
        `,
      },
      {
        tagName: 'script',
        attributes: {
          type: 'application/ld+json',
        },
        innerHTML: JSON.stringify({
          '@context': 'http://schema.org',
          '@type': 'WebSite',
          publisher: 'Install Doctor',
          url: 'http://install.doctor',
          potentialAction: [],
        }),
      },
      {
        tagName: 'script',
        attributes: {
          type: 'speculationrules',
        },
        innerHTML: JSON.stringify({
          prerender: [
            {
              where: {
                and: [{ href_matches: '/*' }, { not: { selector_matches: '.do-not-prerender' } }],
              },
              eagerness: 'immediate',
            },
          ],
        }),
      },
      {
        tagName: 'script',
        attributes: {
          type: 'application/ld+json',
        },
        innerHTML: JSON.stringify({
          '@context': 'http://schema.org',
          '@type': ['SoftwareApplication', 'WebApplication'],
          browserRequirements: ['HTML5', 'CSS3', 'JavaScript', 'Modern Browser'],
          name: 'Install Doctor',
          applicationSuite: 'Install Doctor',
          applicationCategory: 'DesktopEnhancementApplication',
          operatingSystem:
            'Archlinux, CentOS 9+, Debian 11+, Fedora 39+, macOS 12+, Qubes 3.2+, Ubuntu 22.04+, Windows 11+',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: '5.0',
            ratingCount: '58',
            ratingExplanation: 'Calculated from the number of GitHub stars',
          },
          featureList: [
            'Free, open-source, multi-OS desktop provisioning system that lets you store your Desktop-as-Code in a GitHub repository',
            'Pin your applications, extensions, plugins, and configurations to a GitHub repository and Install Doctor handles the rest',
            'Store encrypted secrets in your GitHub fork of Install Doctor and the system will integrate a growing list of API keys into your favorite tools',
            'Backup application settings for future installations to an S3 or Google Drive',
            'Expertly-tuned initial configurations for hundreds of power-user tools',
            'Gorgeous, amazing, and incredibly useful terminal theme and experience that incorporates hundreds of tools and auto-completions',
            'Easy-to-read, full documentation portal',
            'Utilizes system package manager whenever possible when installing your pinned applications',
            'Hundreds of system tweaks for optimized security and performance',
            'Supports CentOS, Debian, Fedora, macOS, and Ubuntu',
            'Experimental Archlinux, Qubes, and Windows support',
            'Allows you to reformat often and headlessly re-provision your desktop with minimal effort',
          ],
          softwareVersion: '1.0.2',
          screenshot: [
            {
              '@context': 'http://schema.org',
              '@type': 'ImageObject',
              contentUrl: 'https://install.doctor/assets/img/screenshots/home-1536x2048.png',
              name: 'Install Doctor: Multi-OS provisioning system',
              uploadDate: '2024-02-26',
              caption:
                'Meet Install Doctor: The free open-source, multi-OS provisioning system. Batteries-included, AI-included.',
              height: 2048,
              width: 1536,
              encodingFormat: 'image/png',
              productionCompany: {
                '@type': 'Organization',
                name: 'Install Doctor',
                logo: {
                  '@type': 'ImageObject',
                  url: 'https://install.doctor/apple-touch-icon.png',
                },
              },
              representativeOfPage: true,
            },
            {
              '@context': 'http://schema.org',
              '@type': 'ImageObject',
              contentUrl: 'https://install.doctor/assets/img/screenshots/documentation-1536x2048.png',
              name: 'Install Doctor Documentation Portal',
              uploadDate: '2024-02-26',
              caption: 'Easy, full documentation portal makes using Install Doctor a breeze.',
              height: 2048,
              width: 1536,
              encodingFormat: 'image/png',
              productionCompany: {
                '@type': 'Organization',
                name: 'Install Doctor',
                logo: {
                  '@type': 'ImageObject',
                  url: 'https://install.doctor/apple-touch-icon.png',
                },
              },
              representativeOfPage: true,
            },
            {
              '@context': 'http://schema.org',
              '@type': 'ImageObject',
              contentUrl: 'https://install.doctor/assets/img/screenshots/community-1536x2048.png',
              name: 'Install Doctor Community Hub',
              uploadDate: '2024-02-26',
              caption:
                'Vibrant community, multiple platforms. Find us on GitHub, Slack, Twitter, Facebook, Matrix, GitLab, Discord, and more!',
              height: 2048,
              width: 1536,
              encodingFormat: 'image/png',
              productionCompany: {
                '@type': 'Organization',
                name: 'Install Doctor',
                logo: {
                  '@type': 'ImageObject',
                  url: 'https://install.doctor/apple-touch-icon.png',
                },
              },
              representativeOfPage: true,
            },
            {
              '@context': 'http://schema.org',
              '@type': 'ImageObject',
              contentUrl: 'https://install.doctor/assets/img/screenshots/enterprise-1536x2048.png',
              name: 'Install Doctor Enterprise Support',
              uploadDate: '2024-02-26',
              caption: 'Enterprise-level business support options available.',
              height: 2048,
              width: 1536,
              encodingFormat: 'image/png',
              productionCompany: {
                '@type': 'Organization',
                name: 'Install Doctor',
                logo: {
                  '@type': 'ImageObject',
                  url: 'https://install.doctor/apple-touch-icon.png',
                },
              },
              representativeOfPage: true,
            },
          ],
          releaseNotes:
            'Install Doctor has spent years in the making and is now ready for use! Start using Install Doctor today! Provision a wide variety of operating systems by forking Install Doctor, customizing it to your liking, and provisioning with a quick one-liner.',
          thumbnailUrl: 'https://install.doctor/apple-touch-icon.png',
          copyrightYear: 2024,
          copyrightHolder: 'Megabyte LLC',
          creator: 'Brian Zalewski',
          accessibilityControl: ['fullMouseControl', 'fullTouchControl'],
          accessibilityHazard: [],
          accessMode: ['textual', 'visual'],
          accessModeSufficient: ['textual', 'visual'],
          accessibilitySummary:
            'Currently, we do not incorporate any testing for screen readers and other related accessibility software. That said, it is still entirely possible that Install Doctor could still be used for the visually impaired.',
        }),
      },
      {
        tagName: 'script',
        attributes: {
          type: 'application/ld+json',
        },
        innerHTML: JSON.stringify({
          '@context': 'http://schema.org',
          '@type': 'Organization',
          name: 'Install Doctor',
          legalName: 'Megabyte LLC',
          email: 'help@install.doctor',
          url: 'https://install.doctor',
          logo: {
            '@type': 'ImageObject',
            url: 'https://install.doctor/apple-touch-icon.png',
          },
          image: 'https://install.doctor/assets/img/og.png',
          founder: 'Brian Zalewski',
          foundingDate: '2022-10-29',
          numberOfEmployees: '2',
          seeks: 'Open-source collaborations',
          telephone: '+1-424-373-7371',
          address: {
            '@type': 'PostalAddress',
            addressCountry: 'US',
            addressLocality: 'Morristown',
            addressRegion: 'New Jersey',
            postalCode: '07960',
            streetAddress: '63 James Street',
          },
          alternateName: ['InstallDoc', 'install.doctor'],
          brand: ['Megabyte Labs', 'Megabyte Space', 'Megabyte LLC', 'Megabyte Labs Open Source', 'Install Doctor'],
          award: '2024 Workstation Provisioning System of the Year',
          sameAs: [
            'https://www.facebook.com/InstallDoctor',
            'https://twitter.com/InstallDoc',
            'https://www.pinterest.com/InstallDoc/',
            'https://www.instagram.com/installdoctor/',
            'https://github.com/heymegabyte/install.doctor',
            'https://linkedin.com/company/megabyte-labs',
            'https://app.slack.com/client/T01ABCG4NK1/C04TDHV564E',
            'https://discord.com/channels/1077138419953713222/1077138479928049734',
            'https://www.youtube.com/@InstallDoctor',
            'https://t.me/InstallDoctor',
            'https://app.element.io/#/room/#install.doctor:matrix.org',
          ],
          contactPoint: [
            {
              '@type': 'ContactPoint',
              email: 'help@install.doctor',
              url: 'https://install.doctor',
              telephone: '+1-424-373-7371',
              contactType: 'Customer Support',
              availableLanguage: ['English'],
            },
          ],
        }),
      },
      {
        tagName: 'script',
        attributes: {
          type: 'application/ld+json',
        },
        innerHTML: JSON.stringify([
          {
            '@context': 'http://schema.org',
            '@type': 'Article',
            url: 'https://install.doctor/privacy',
            publisher: {
              '@type': 'Organization',
              name: 'Install Doctor',
              logo: {
                '@type': 'ImageObject',
                url: 'https://install.doctor/apple-touch-icon.png',
              },
            },
            headline: 'Privacy Policy',
            image: {
              '@list': [
                {
                  '@type': 'ImageObject',
                  url: 'https://install.doctor/assets/img/og/privacy.png',
                },
              ],
            },
            mainEntityOfPage: 'https://install.doctor/privacy',
          },
          {
            '@context': 'http://schema.org',
            '@type': 'Article',
            url: 'https://install.doctor/terms',
            publisher: {
              '@type': 'Organization',
              name: 'Install Doctor',
              logo: {
                '@type': 'ImageObject',
                url: 'https://install.doctor/apple-touch-icon.png',
              },
            },
            headline: 'Terms of Service',
            image: {
              '@list': [
                {
                  '@type': 'ImageObject',
                  url: 'https://install.doctor/assets/img/og/terms.png',
                },
              ],
            },
            mainEntityOfPage: 'https://install.doctor/terms',
          },
        ]),
      },
    ],
    metadata: [
      { name: 'msapplication-tap-highlight', content: 'no' },
      { name: 'format-detection', content: 'telephone=no' },
      { name: 'theme-color', content: '#FFFFFF' },
      { name: 'msapplication-tooltip', content: 'Install Doctor: Provision fully-configured desktops automatically' },
      { name: 'msapplication-TileColor', content: '#FFFFFF' },
      {
        name: 'msapplication-task',
        content:
          'name=Documentation;action-uri=https://install.doctor/docs;icon-uri=https://megabyte.spacce/assets/img/microsoft/search.ico',
      },
      {
        name: 'msapplication-task',
        content:
          'name=Home;action-uri=https://install.doctor;icon-uri=https://install.doctor/assets/img/microsoft/home.ico',
      },
      {
        name: 'msapplication-task',
        content:
          'name=GitHub;action-uri=https://github.com/heymegabyte/install.doctor;icon-uri=https://install.doctor/assets/img/microsoft/github.ico',
      },
      { name: 'msapplication-tap-highlight', content: 'no' },
      { name: 'msapplication-starturl', content: 'https://install.doctor' },
      { name: 'geography', content: 'USA' },
      { name: 'contact', content: 'help@install.doctor' },
      { name: 'application-name', content: 'Install Doctor' },
      { name: 'apple-mobile-web-app-title', content: 'Install Doctor' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'twitter:site', content: '@InstallDoc' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'author', content: 'Brian Zalewski' },
      { name: 'copyright', content: 'Megabyte LLC' },
      { name: 'HandheldFriendly', content: 'True' },
      { name: 'MobileOptimized', content: '400' },
      { name: 'twitter:creator', content: '@InstallDoctor' },
      { name: 'viewport', content: 'width=device-width, minimum-scale=1, initial-scale=1, user-scalable=yes' },
      {
        name: 'keywords',
        content:
          'open-source, opensource, github, gitlab, installdoctor, jumpusb, kubernetes, docker, ubuntu, fedora, qubes, archlinux, debian, windows, macos, provisioning, deployment, ansible, bash, scripting, terminal, settings',
      },
    ],
    navbar: {
      hideOnScroll: false,
      logo: {
        alt: 'Install Doctor Logo',
        src: `/logos/install-doctor-text-docs-light.svg`,
        srcDark: `/logos/install-doctor-text-docs-dark.svg`,
        href: 'https://install.doctor',
        target: '_self',
        width: 200,
        height: 24,
      },
      items: [
        {
          type: 'doc',
          docId: 'index',
          label: 'Docs',
          position: 'left',
        },
        {
          type: 'doc',
          docId: 'scripts',
          label: 'Scripts',
          position: 'left',
        },
        {
          type: 'doc',
          docId: 'cli/index',
          label: 'CLI',
          position: 'left',
        },
        {
          type: 'search',
          position: 'right',
        },
        {
          label: 'Support',
          position: 'right',
          items: [
            {
              href: 'https://install.doctor/blog',
              label: 'Blog',
              target: '_self',
            },
            {
              href: 'https://install.doctor/community',
              label: 'Community',
              target: '_self',
            },
            {
              href: 'https://install.doctor/enterprise',
              label: 'Enterprise',
              target: '_self',
            },
          ],
          className: 'navbar__link--support',
        },
        {
          type: 'separator',
          position: 'right',
        },
        {
          type: 'iconLink',
          position: 'right',
          icon: {
            alt: 'Twitter logo',
            src: `/logos/twitter.svg`,
            href: 'https://twitter.com/InstallDoc',
            target: '_blank',
          },
        },
        {
          type: 'iconLink',
          position: 'right',
          icon: {
            alt: 'GitHub logo',
            src: `/logos/github.svg`,
            href: 'https://github.com/heymegabyte/install.doctor',
            target: '_blank',
          },
        },
        {
          type: 'iconLink',
          position: 'right',
          icon: {
            alt: 'Discord logo',
            src: `/logos/discord.svg`,
            href: 'https://discord.com/channels/1077138419953713222/1077138479928049734',
            target: '_blank',
          },
        },
      ],
    },
    tagManager: {
      trackingID: 'GTM-PJQ4263',
    },
    prism: {
      theme: { plain: {}, styles: [] },
      // https://github.com/FormidableLabs/prism-react-renderer/blob/master/src/vendor/prism/includeLangs.js
      additionalLanguages: ['shell-session', 'http'],
    },
    algolia: {
      appId: 'KFVMJ7I0DW',
      apiKey: '25aa5bf8d990c53c40c7571859290207',
      indexName: 'installtor',
      contextualSearch: true,
    },
  },
  plugins: [
    // 'docusaurus-plugin-sass',
    [
      'docusaurus-plugin-module-alias',
      {
        alias: {
          'styled-components': path.resolve(__dirname, './node_modules/styled-components'),
          react: path.resolve(__dirname, './node_modules/react'),
          'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
          '@components': path.resolve(__dirname, './src/components'),
        },
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        routeBasePath: '/',
        sidebarPath: require.resolve('./sidebars.js'),
        editUrl: ({ versionDocsDirPath, docPath, locale }) => {
          if (locale != 'en') {
            return 'https://crowdin.com/project/install-doctor-docs';
          }
          if ((match = docPath.match(/scripts\/profile\/(.*)\.md/)) != null) {
            return `https://github.com/heymegabyte/install.doctor/edit/master/home/dot_config/shell/${match[1]}`;
          }
          if ((match = docPath.match(/scripts\/utility\/(.*)\.md/)) != null) {
            return `https://github.com/heymegabyte/install.doctor/edit/master/scripts/${match[1]}`;
          }
          if ((match = docPath.match(/scripts\/.*\/(.*)\.md/)) != null) {
            return `https://github.com/heymegabyte/install.doctor/edit/master/home/.chezmoiscripts/universal/${match[1]}`;
          }
          if ((match = docPath.match(/cli\/commands\/(.*)\.md/)) != null) {
            return `https://github.com/heymegabyte/install.doctor/edit/master/home/dot_config/task/Taskfile.yml`;
          }
          return `https://github.com/heymegabyte/install.doctor/edit/master/${versionDocsDirPath}/${docPath}`;
        },
        exclude: ['README.md'],
        lastVersion: 'current',
        versions: {
          current: {
            label: 'v1',
            banner: 'none',
          },
        },
      },
    ],
    '@docusaurus/plugin-content-pages',
    process.env.NODE_ENV === 'production' && '@docusaurus/plugin-debug',
    [
      '@docusaurus/plugin-sitemap',
      {
        changefreq: 'weekly',
        priority: 0.5,
        // TODO: Add these back in once upgrade to more recent version is done
        // filename: 'sitemap.xml',
        // ignorePatterns: ['**/__docusaurus/**']
      },
    ],
    '@ionic-internal/docusaurus-plugin-tag-manager',
    function (context, options) {
      return {
        name: 'ionic-docs-ads',
        async loadContent() {
          if (fs.existsSync('./local/docsad.prismic.json')) {
            const prismic = fs.readFileSync('./local/docsad.prismic.json');
            return JSON.parse(prismic.toString());
          } else {
            const docsAd = await client.getByType('docs_ad');
            fs.writeFileSync('./local/docsad.prismic.json', JSON.stringify(docsAd));
            return docsAd;
          }
        },
        async contentLoaded({ content, actions: { setGlobalData, addRoute } }) {
          return setGlobalData({ prismicAds: content.results });
        },
      };
    },
    function (_, { id, ...options }) {
      return {
        name: 'docusaurus-plugin-sass-builtin',
        configureWebpack(_, isServer, utils) {
          const { getStyleLoaders } = utils;
          const isProd = process.env.NODE_ENV === 'production';
          return {
            module: {
              rules: [
                {
                  test: /\.s[ca]ss$/,
                  oneOf: [
                    {
                      test: /\.module\.s[ca]ss$/,
                      use: [
                        ...getStyleLoaders(isServer, {
                          modules: {
                            localIdentName: isProd ? `[local]_[hash:base64:4]` : `[local]_[path][name]`,
                            exportOnlyLocals: isServer,
                          },
                          importLoaders: 2,
                          sourceMap: !isProd,
                        }),
                        {
                          loader: 'sass-loader',
                          options: options || {},
                        },
                      ],
                    },
                    {
                      use: [
                        ...getStyleLoaders(isServer),
                        {
                          loader: 'sass-loader',
                          options: options || {},
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          };
        },
      };
    },
  ].filter(Boolean),
  themes: [
    [
      //overriding the standard docusaurus-theme-classic to provide custom schema
      path.resolve(__dirname, 'docusaurus-theme-classic'),
      {
        customCss: [
          require.resolve('./node_modules/modern-normalize/modern-normalize.css'),
          require.resolve('./src/styles/custom.scss'),
        ],
      },
    ],
    path.resolve(__dirname, './node_modules/@docusaurus/theme-search-algolia'),
  ],
  customFields: {},
};
