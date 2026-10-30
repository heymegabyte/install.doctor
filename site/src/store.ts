import { createStore } from '@stencil/store';

export interface State {
  pageTheme: 'light' | 'dark';
}

const { state } = createStore<State>({
  pageTheme: 'light',
});

export const defaults = {
  blogRssTitle: 'Install Doctor: The Multi-OS Provisioning Community Blog',
  share: {
    twitter: {
      defaultTweet: 'Cool open-source stuff:',
      username: 'InstallDoc',
      hashtags: 'opensource,GitHub,GitLab',
    },
    linkedin: {
      summary: 'Cool open-source stuff:',
      source: 'pwa',
    },
  },
  disqusSiteId: 'install-doctor',
  facebookAppId: '669135071652897',
  pageTitle: 'Install Doctor: Provision fully-configured desktops automatically',
  brandName: 'Install Doctor',
  authorTwitter: '@InstallDoc',
  ogType: 'website',
  documentationFooterLinks: [
    {
      title: 'Getting Started',
      href: '/docs/getting-started',
    },
    {
      title: 'Features',
      href: '/docs/features',
    },
    {
      title: 'Customization',
      href: '/docs/customization',
    },
    {
      title: 'Contributing',
      href: '/docs/contributing',
    },
  ],
  landingPage: {
    meta: {
      pageTitle: 'Provision fully configured desktops automatically',
      description:
        'Setup your workstation automatically with the best, free open-source software using Install Doctor, an open-source, multi-OS provisioning system.',
    },
    parallax: {
      reveal1: 'Open',
      reveal2: 'Source',
      reveal3: 'Wizardry',
      text: 'Join us in our quest to build the ultimate device deployment tools, scripts, and software or follow us to reap the benefits of expert-configured, open-source software built with paranoid-level security practices.',
      newsletterButtonText: 'Get Beta Access',
      newsletterButtonSecondaryText: 'Join Community',
      newsletterButtonSecondaryLink: '/community',
      secondButtonHref: 'https://gitlab.com/megabyte-labs',
      secondButtonText: 'Browse Code',
    },
    topSection: {
      leftButtonHref: '/docs/getting-started',
      rightButtonHref: '/docs/features',
      smallTextHref: '/docs/customization',
    },
    featureGridTopLinkHref: '/docs/features',
    ctaLink: '/enterprise',
    getStartedLeftButtonHref: '/docs/getting-started',
    getStartedRightButtonHref: '/docs/features',
  },
  brandEmail: 'help@install.doctor',
  emailForm: {
    url: 'https://install.doctor/api/email',
  },
  enterprisePage: {
    meta: {
      pageTitle: 'Open-Source Enterprise Provisioning Solutions',
      description:
        'Learn about the enterprise-grade support and exclusive features offered to our clientel. Find out how to amplify your business with Install Doctor.',
    },
    inquiryParagraph1:
      'Install Doctor is a well-known and respected provider of technical support services. By engaging with the support team, you can tap into expertise and knowledge to help solve any problems or issues you may be experiencing with your product or business. This can save you valuable time and resources that would otherwise be spent trying to figure things out on your own.',
    inquiryParagraph2:
      "Secondly, you can gain insights into best practices and industry trends that can help you improve your product or business by leveraging our support's expertise. Our support team may have worked with other companies in your industry and can share their experiences and recommendations with you. We also have access to data and analytics that can help you make better-informed decisions about your product or business strategy. Overall, engaging with Install Doctor's support can help you stay ahead of the curve and position your product or business for success.",
    topCTA2: {
      text: 'Enterprise Docs',
      href: '/docs/enterprise',
    },
    bottomCTA2: {
      text: 'Enterprise Docs',
      href: '/docs/enterprise',
    },
  },
  eBookSiteModal: {
    title: 'Free Install Doctor eBook',
    eBookTitle: 'Open-Source, Cross-OS Workstations with Install Doctor',
  },
  communityPage: {
    meta: {
      pageTitle: 'Community Hub',
      description:
        'Get connected and get help from the Install Doctor community. Find out how you can join our thriving community.',
    },
    whyJoin: {
      title: 'Why join the Install Doctor community?',
      paragraph1:
        "Joining Install Doctor's community pages can be incredibly useful and important for the project's growth. These platforms provide an avenue for the project's developers and contributors to communicate, collaborate, and share their ideas, issues, and solutions. By joining these platforms, users can stay up-to-date with the latest project developments, contribute to ongoing discussions, and offer feedback on the project's progress.",
      paragraph2:
        "For developers and contributors, joining these community pages can be an excellent opportunity to learn and grow their skills. By interacting with other developers and contributors, they can gain insight into best practices, troubleshoot problems, and receive guidance on how to improve their code. Furthermore, these platforms also provide a space for users to contribute to the project's documentation, which can be a valuable asset for other users and new contributors.",
      paragraph3:
        "Finally, joining Install Doctor's community pages can also help to promote the project and increase its visibility. By engaging with users on social media platforms like Twitter, the project can reach a wider audience and attract new contributors. Moreover, by participating in discussions and sharing their experiences, users can help to build a sense of community around the project, which can be a significant factor in the project's long-term success. In summary, joining Install Doctor's community pages can be a mutually beneficial experience for both users and the project.",
    },
  },
  blogPage: {
    meta: {
      pageTitle: 'The Blog: Articles by the team and community',
      description:
        'Read about all things related to Install Doctor. Find information about Kubernetes, Docker, virtualization, CLIs, and other tools included in the Install Doctor stack.',
    },
    title: 'Install Doctor Blog',
    subheader:
      'Explore engaging articles from the Install Doctor dream team and thriving community! Learn about amazing free open-source software and how to integrate your workflow with the cloud.',
  },
  solutionPage: {
    meta: {
      pageTitle: (solutionName) => 'Provision ' + solutionName + ' using a powerful, customizable one-liner',
      description: (solutionName) =>
        'Headlessly deploy a fully configured workstation on ' +
        solutionName +
        ' using Install Doctor, an intuitive, well-designed provisioning system compatible with most operating systems.',
    },
    enterpriseSupport: {
      title: 'Install Doctor Enterprise Support',
      paragraph1:
        'Guaranteed response SLAs to support your business needs. Our professional support team is on-hand to help you troubleshoot and address issues.',
      paragraph2:
        'Our team of experts will work with your teams to provide open-source based recommendations, strategies, and custom solutions that fits your unique goals and challenges. We are here to help ensure your success.',
    },
    subHeader: {
      text1: 'Get more out of',
      text2: 'by provisioning it with Install Doctor',
    },
    solutions: [
      {
        id: 'archlinux',
        name: 'Archlinux',
        theme: '#1793d1',
        logo: '/assets/img/solutions/archlinux.png',
        dimensions: '252x224',
      },
      {
        id: 'centos',
        name: 'CentOS',
        theme: '#212078',
        logo: '/assets/img/solutions/centos.png',
        dimensions: '252x224',
      },
      {
        id: 'debian',
        name: 'Debian',
        theme: '#d70a53',
        logo: '/assets/img/solutions/debian.png',
        dimensions: '252x224',
      },
      {
        id: 'fedora',
        name: 'Fedora',
        theme: '#0B57A4',
        logo: '/assets/img/solutions/fedora.png',
        dimensions: '252x224',
      },
      {
        id: 'macos',
        name: 'macOS',
        theme: '#000000',
        logo: '/assets/img/solutions/macos.png',
        dimensions: '252x224',
      },
      {
        id: 'qubes',
        name: 'Qubes',
        theme: '#3874d8',
        logo: '/assets/img/solutions/qubes.png',
        dimensions: '252x224',
      },
      {
        id: 'ubuntu',
        name: 'Ubuntu',
        theme: '#dd4814',
        logo: '/assets/img/solutions/ubuntu.png',
        dimensions: '252x224',
      },
      {
        id: 'windows',
        name: 'Windows',
        theme: '#00a1f1',
        logo: '/assets/img/solutions/windows.png',
        dimensions: '252x224',
      },
    ],
  },
  description:
    'Setup your workstation automatically with the best, free open-source software using Install Doctor, an open-source, multi-OS provisioning system.',
  image: 'https://install.doctor/assets/img/og.png',
  companyLegalName: 'Megabyte LLC',
  companyAlias: 'Megabyte Labs',
  companyUrl: 'https://megabyte.space',
  homepage: 'https://install.doctor',
  companyFooterBrandName: 'Megabyte Labs Open Source',
  sendGridListId: '94a28ff4-6712-4f62-8d9b-5036de3c5ea9',
  sendGridEnterpriseListId: '7bd2df72-96e9-417c-adb9-f91501affebb',
  license: 'MIT',
  companyEmail: 'help@megabyte.space',
  companyAddress: {
    line1: '63 James Street',
    line2: 'Morristown, New Jersey 07960',
    line3: 'United States of America',
  },
  header: {
    customLinks: [
      {
        title: 'Features',
        href: '/docs/features',
        templateId: 'cli',
      },
      {
        title: 'Docs',
        href: '/docs',
        templateId: 'docs',
      },
    ],
    actionButton: {
      title: 'Fork',
      href: 'https://github.com/heymegabyte/install.doctor/fork',
      svgId: 'fork',
    },
  },
  prefooter: {
    left: {
      title: 'Installation Guide',
      text: 'Provision your operating system, learn how to customize it, and unlock integrations with free cloud services.',
      href: '/docs/getting-started',
    },
    right: {
      title: 'Explore Features',
      text: 'Explore the features and apps that are included with Install Doctor.',
      href: '/docs/features',
    },
  },
  hubspot: {
    emailForm: {
      id: '24052635',
      key: 'eb0d85ad-67a2-41fe-bebe-ca909073f286',
    },
    fullForm: {
      id: '24052635',
    },
    eBookForm: {
      formId: 'df7c28cd-d123-4ea2-aa2c-d7cb304fd398',
    },
    enterpriseContactForm: {
      formId: 'b74a09f0-f963-47d2-b7d0-43d74dae366f',
    },
  },
  algolia: {
    appId: 'KFVMJ7I0DW',
    apiKey: '25aa5bf8d990c53c40c7571859290207',
    indexName: 'installtor',
  },
  social: {
    discord: 'https://discord.com/channels/1077138419953713222/1077138479928049734',
    facebook: 'https://www.facebook.com/InstallDoctor',
    github: 'https://github.com/heymegabyte/install.doctor',
    githubDiscussions: 'https://github.com/heymegabyte/install.doctor/discussions',
    gitlab: 'https://gitlab.com/megabyte-labs/install.doctor',
    linkedin: 'https://linkedin.com/company/megabyte-labs',
    slack: 'https://app.slack.com/client/T01ABCG4NK1/C04TDHV564E',
    twitter: 'https://twitter.com/InstallDoc',
    youtube: 'https://www.youtube.com/@InstallDoctor',
    telegram: 'https://t.me/InstallDoctor',
    matrix: 'https://app.element.io/#/room/#install.doctor:matrix.org',
    pinterest: 'https://www.pinterest.com/InstallDoc/',
    instagram: 'https://www.instagram.com/installdoctor/',
    threads: 'https://www.threads.net/@installdoctor',
  },
};

export const LandingPageData = {
  defaults,
  top: [
    {
      type: 'heading1',
      spans: [],
      text: 'Multi-OS provisioning made easy.',
    },
    {
      type: 'paragraph',
      spans: [],
      text: 'Experience Install Doctor, the free, versatile provisioning tool that simplifies your system setup across multiple operating systems. Instantly provision devices with top open-source projects from GitHub, no customization needed. With its customizable framework, tailor your system effortlessly to fit your exact needs. Elevate your setup with Install Doctor—where efficiency meets simplicity.',
    },
  ],
  top__ctas: [
    {
      primary: 'Get Started',
      secondary: 'Explore Features',
    },
  ],
  top__link: 'Customize your build',
  top__hero: {
    dimensions: {},
    alt: 'Install Doctor connected to Archlinux, CentOS, Debian, Fedora, macOS, Ubuntu, Qubes, and Windows as a mind map',
    copyright: null,
    url: 'https://install.doctor/assets/img/enterprise/os-wheel.png',
    '2x': {},
  },
  top__icons: {
    dimensions: {},
    alt: 'Archlinux, CentOS, Debian, Fedora, macOS, Qubes, Ubuntu, and Windows icons',
    copyright: null,
    url: 'https://install.doctor/assets/img/landing/megabyte-labs-heart.png',
    '2x': {},
  },
  announcement: {
    tag_text: 'Blog',
    desktop_text: 'The Switch from Gas Station to Install Doctor',
    mobile_text: 'From Gas Station to Install Doctor',
    link: {
      url: '/blog/gas-station-predecessor',
      target: null,
    },
  },
  started: [
    {
      type: 'heading2',
      spans: [
        {
          start: 12,
          end: 19,
          type: 'em',
        },
      ],
      text: 'Get started easily.',
    },
  ],
  started__list: [
    {
      number: '01',
      title: 'Get started with a one-liner and guided prompts.',
      text: `Getting started with Install Doctor is a breeze. Just launch the one-liner, and you'll be seamlessly guided through interactive prompts to easily input any additional details needed. Dive right in and experience the simplicity of setting up your system with Install Doctor.`,
    },
    {
      number: '02',
      title: 'Customize the script with your own fork.',
      text: `Take control of your setup by forking the Install Doctor project on GitHub. Then, effortlessly provision your devices with the same convenient script, simply by setting an environment variable to include your username/project-name. It's your gateway to a customized, efficient provisioning process. Join the Install Doctor community and start shaping your ideal setup today!`,
    },
    {
      number: '03',
      title: 'Automate everything.',
      text: 'Elevate your security with Install Doctor by safeguarding your sensitive data. Opt to seamlessly integrate your confidential information through environment variables or embed them as encrypted secrets within your fork, ensuring a secure, automated one-line installation. This approach guarantees your setup is not just efficient, but also fortified against vulnerabilities, providing peace of mind in every deployment.',
    },
    {
      number: '04',
      title: 'Manage software across operating systems.',
      text: `Simplify your setup with our custom installer, effortlessly defining package requirements across different operating systems. All you need to do is specify the OS-specific package names within a straightforward YAML file. It's the hassle-free way to ensure your software runs smoothly, regardless of the operating system. Easy, efficient, and effective—just how it should be.`,
    },
    {
      number: '05',
      title: 'Pin all your plugins, packages, and extensions.',
      text: `Streamline your future setups with Install Doctor by pre-configuring it to automatically install your favorite packages. Simply define your preferences in a YAML file, and let Install Doctor take care of the provisioning for you. This one-time setup promises to save you countless hours down the line, making every device setup as efficient as the first. It's smart, simple, and designed to give you back your valuable time.`,
    },
    {
      number: '06',
      title: 'Configure once, deploy headlessly in the future.',
      text: 'Some settings are not easily stored in code, like Google Chrome extension settings. Other settings are sensitive and should be encrypted (like API keys). Install Doctor allows you to store these settings in a secure, encrypted files that can be decrypted during the provisioning process. This way, you can keep your settings secure and your provisioning process automated after you are satisfied with your application settings.',
    },
  ],
  ebook: [
    {
      text: [
        {
          type: 'paragraph',
          spans: [
            {
              start: 0,
              end: 45,
              type: 'em',
            },
          ],
          text: 'Provision your computing environments faster. Our free guide details the benefits of leveraging Install Doctor to define the state of your PCs.',
        },
      ],
      cta1: 'Read the free eBook',
      background: {
        dimensions: {},
        alt: 'See-through tiles',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/see-thru-tiles.png',
        '2x': {},
      },
      book: {
        dimensions: {},
        alt: 'Book cover with title reading "Provisioning Operating Systems with Install Doctor"',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/ebook-text-box.png',
        '2x': {},
      },
    },
  ],
  native: [
    {
      type: 'heading2',
      spans: [
        {
          start: 14,
          end: 42,
          type: 'em',
        },
      ],
      text: 'Automatically provision your devices.',
    },
  ],
  native__list: [
    {
      icon: {
        dimensions: {},
        alt: 'Triple phone icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/triple-phone-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'OS-independent',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Bring your devices to roughly equivalent states, regardless of the operating system you choose.',
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'Cube with sphere inside icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/cube-sphere-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Security-focused',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Provision your devices with clever security measures that will mitigate security risks and give hackers a PITA.',
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'Tripe stack layered icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/triple-stack-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Virtualization-friendly',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Use Install Doctor to provision VMs, leverage pre-configured Docker sandboxing, and even provision a fully configured Qubes environment.',
        },
      ],
    },
  ],
  features: [
    {
      type: 'heading2',
      spans: [
        {
          start: 21,
          end: 44,
          type: 'em',
        },
      ],
      text: 'Consistent features, any operating system.',
    },
  ],
  features__list: [
    {
      icon: {
        dimensions: {},
        alt: 'Camera icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/camera-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Stunning UI',
        },
        {
          type: 'paragraph',
          spans: [],
          text: `Our custom theme brings a stunning visual experience to both KDE and GNOME Linux systems, ensuring a sleek interface. Additionally, the boot screens are streamlined, displaying only what's necessary, free from unnecessary log messages for a cleaner startup.`,
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'File system icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/file-system-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'File System',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Enjoy a secure, read-only network file sharing folder, effortless backups to S3 buckets, and seamless integration with operating system-specific technologies like BTRFS for enhanced performance and reliability.',
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'Antenna icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/pin-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Pin Everything',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Our platform empowers you to customize your configuration to your exact preferences. Easily manage and maintain your favorite addons, tools, and extensions by pinning software packages, Chrome extensions, VSCode extensions, and more, ensuring everything you need is always at your fingertips.',
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'Spherical rings icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/sphere-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Developer-First',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'The default setup is expertly crafted to meet the demands of developers, incorporating essential development software and advanced tools, including fully-enhanced terminal settings, to empower power users with everything they need for efficient workflow.',
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'Bell icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/notifications-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Notifications',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Keep an eye on your devices with a personal web dashboard and stay informed with notifications the moment anything goes off track.',
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'Person with circle around icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/network-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Network',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Access your devices and services from anywhere through a VPN-based LAN and secure your web services with Single Sign-On (SSO) protection.',
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'Three encompassing circles icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/three-circles-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Multi-Layer Security',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Enhance your security with multiple pre-configured layers, including app-specific firewalls, sandboxing, and honeypots, designed to protect your system comprehensively.',
        },
      ],
    },
    {
      icon: {
        dimensions: {},
        alt: 'Slider adjustment icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/configure-icon-1x.png',
      },
      item: [
        {
          type: 'heading4',
          spans: [],
          text: 'Configurable',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Effortlessly create and host your personalized version of Install Doctor on GitHub, with the option to include your encrypted secrets for added security.',
        },
      ],
    },
  ],
  features__link: 'Explore Features',
  framework: [
    {
      type: 'heading2',
      spans: [
        {
          start: 15,
          end: 34,
          type: 'em',
        },
      ],
      text: 'Bring your own operating system.',
    },
    {
      type: 'paragraph',
      spans: [
        {
          start: 194,
          end: 203,
          type: 'hyperlink',
          data: {
            link_type: 'Web',
            url: 'https://install.doctor/solution/archlinux',
          },
        },
        {
          start: 205,
          end: 211,
          type: 'hyperlink',
          data: {
            link_type: 'Web',
            url: 'https://install.doctor/solution/centos',
          },
        },
        {
          start: 213,
          end: 219,
          type: 'hyperlink',
          data: {
            link_type: 'Web',
            url: 'https://install.doctor/solution/debian',
          },
        },
        {
          start: 221,
          end: 227,
          type: 'hyperlink',
          data: {
            link_type: 'Web',
            url: 'https://install.doctor/solution/fedora',
          },
        },
        {
          start: 229,
          end: 234,
          type: 'hyperlink',
          data: {
            link_type: 'Web',
            url: 'https://install.doctor/solution/macos',
          },
        },
        {
          start: 236,
          end: 241,
          type: 'hyperlink',
          data: {
            link_type: 'Web',
            url: 'https://install.doctor/solution/qubes',
          },
        },
        {
          start: 243,
          end: 249,
          type: 'hyperlink',
          data: {
            link_type: 'Web',
            url: 'https://install.doctor/solution/ubuntu',
          },
        },
        {
          start: 255,
          end: 262,
          type: 'hyperlink',
          data: {
            link_type: 'Web',
            url: 'https://install.doctor/solution/windows',
          },
        },
      ],
      text: 'Leverage the power of Install Doctor to provision an impressive array of operating systems and virtualization platforms. Officially supporting the latest x86-64 releases from major players like Archlinux, CentOS, Debian, Fedora, macOS, Qubes, Ubuntu, and Windows, Install Doctor stands out in its versatility. Additionally, its capability extends to supporting other operating systems, showcasing its adaptability and wide-reaching applicability.',
    },
  ],
  framework__list: [
    {
      logo: {
        dimensions: {},
        alt: 'Archlinux logo tile',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/archlinux-box.png',
        '2x': {},
      },
      link: '/solution/archlinux',
    },
    {
      logo: {
        dimensions: {},
        alt: 'CentOS logo tile',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/centos-box.png',
        '2x': {},
      },
      link: '/solution/centos',
    },
    {
      logo: {
        dimensions: {},
        alt: 'Debian logo tile',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/debian-box.png',
        '2x': {},
      },
      link: '/solution/debian',
    },
    {
      logo: {
        dimensions: {},
        alt: 'Fedora logo tile',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/fedora-box.png',
        '2x': {},
      },
      link: '/solution/fedora',
    },
    {
      logo: {
        dimensions: {},
        alt: 'macOS logo tile',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/macos-box.png',
        '2x': {},
      },
      link: '/solution/macos',
    },
    {
      logo: {
        dimensions: {},
        alt: 'Qubes logo tile',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/qubes-box.png',
        '2x': {},
      },
      link: '/solution/qubes',
    },
    {
      logo: {
        dimensions: {},
        alt: 'Ubuntu logo tile',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/ubuntu-box.png',
        '2x': {},
      },
      link: '/solution/ubuntu',
    },
    {
      logo: {
        dimensions: {},
        alt: 'Windows logo tile',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/windows-box.png',
        '2x': {},
      },
      link: '/solution/windows',
    },
  ],
  tweets: [
    {
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 23,
              end: 46,
              type: 'em',
            },
          ],
          text: 'What people are saying about Install Doctor.',
        },
      ],
    },
  ],
  tweets__list: [
    {
      name: 'Brian Zalewski',
      handle: '@HillBillyHack3r',
      text: [
        {
          type: 'paragraph',
          spans: [
            {
              start: 29,
              end: 40,
              type: 'hyperlink',
              data: {
                target: '_blank',
                link_type: 'Web',
                url: 'https://twitter.com/InstallDoc',
              },
            },
          ],
          text: 'The default configuration of @InstallDoc is an educational tool that helps me learn about emerging open-source technologies.. Hopefully people find it as useful as I do',
        },
      ],
      image: {
        dimensions: {},
        alt: 'Brian Zalewski Twitter profile picture',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/twitter-brian-zalewski.png',
        '2x': {},
      },
      verified: false,
    },
  ],
  tweets__bottom: [
    {
      emoji: '',
      text: [
        {
          type: 'paragraph',
          spans: [
            {
              start: 40,
              end: 79,
              type: 'em',
            },
          ],
          text: 'The Install Doctor Community is growing. Connect with us, your opinion matters.',
        },
      ],
    },
  ],
  tweets__bottom__list: [
    {
      icon: {
        dimensions: {},
        alt: 'Twitter icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/twitter-icon-1x.png',
      },
      text: 'Follow us on Twitter',
      link: {
        url: 'https://twitter.com/InstallDoc',
        target: '_blank',
      },
    },
    {
      icon: {
        dimensions: {},
        alt: 'Github icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/github-icon-1x.png',
      },
      text: 'Star us on GitHub',
      link: {
        url: 'https://github.com/heymegabyte/install.doctor',
        target: '_blank',
      },
    },
    {
      icon: {
        dimensions: {},
        alt: 'Chat bubble icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/chat-icon-1x.png',
      },
      text: 'Connect on Slack',
      link: {
        url: 'https://app.slack.com/client/T01ABCG4NK1/C01AKCQS2RL',
        target: '_blank',
      },
    },
  ],
  cta: [
    {
      image: {
        dimensions: {},
        alt: 'Raised platforms with app icons',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/cap-enterprise-cta.png',
        '2x': {},
      },
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 25,
              end: 59,
              type: 'em',
            },
          ],
          text: 'Supercharge your workflow with enterprise-grade solutions.',
        },
      ],
      text: [
        {
          type: 'paragraph',
          spans: [
            {
              start: 0,
              end: 21,
              type: 'em',
            },
          ],
          text: 'Ready for enterprise. Choose Install Doctor Enterprise for top-notch security, easy SSO, and exclusive read-only file system access. A smart investment in superior infrastructure protection.',
        },
      ],
      cta1: 'Learn more',
    },
  ],
  get_started2: [
    {
      title: 'Ready to get started?',
      text: 'Dive in and start provisioning your devices with Install Doctor',
    },
  ],
  get_started__ctas: [
    {
      primary: 'Get Started',
      secondary: 'Explore Features',
    },
  ],
};

export const EnterprisePageData = {
  defaults,
  top: [
    {
      title: 'Secure, reliable multi-OS provisioning for enterprise teams',
      text: "Elevate your team's efficiency and expand their capabilities by seamlessly integrating Install Doctor across all operating systems and virtualization platforms. Empower them with the tools they need to excel, no matter the environment.",
      cta_1: 'Talk to sales',
      background: {
        dimensions: {},
        alt: 'Raised platforms with app and company icons',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/platform-elevated-graphic.png',
        '2x': {},
      },
    },
  ],
  native: [
    {
      supertext: 'SUPERCHARGED EFFICIENCY',
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 24,
              end: 44,
              type: 'em',
            },
          ],
          text: 'Unlock enterprise-grade security and support',
        },
      ],
      subtext: `Boost your team's performance and streamline their workflow by equipping them with top-tier, enterprise-grade tools and services. Elevate their productivity and ensure success with the right resources at their fingertips.`,
    },
  ],
  native__list: [
    {
      title: 'Build with confidence',
      text: 'Secure a competitive edge for your business with the assurance that your team is equipped with the finest open-source productivity tools. Each tool is meticulously pre-installed, pre-configured, and supported by essential, mission-critical assistance, ensuring your operations run smoothly and efficiently.',
    },
    {
      title: 'Protect your users & data',
      text: "It's imperative for your business's integrity and safety to have all security measures meticulously pre-configured on your team's devices. With comprehensive sandboxing and robust firewall protection, safeguard your operations against vulnerabilities and threats, ensuring a secure and resilient working environment.",
    },
    {
      title: 'Accelerate your projects',
      text: 'Accelerate your path to market and gain valuable time by equipping your team with tools and services designed to enhance their efficiency and capabilities. Streamline processes and unlock greater potential, propelling your business forward at an unprecedented pace.',
    },
  ],
  ebook: [
    {
      text: [
        {
          type: 'paragraph',
          spans: [
            {
              start: 0,
              end: 45,
              type: 'em',
            },
          ],
          text: 'Provision your computing environments faster. Our free guide details the benefits of leveraging Install Doctor to define the state of your PCs.',
        },
      ],
      cta: 'Read the free eBook',
      background: {
        dimensions: {},
        alt: 'See-through tiles',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/see-thru-tiles.png',
        '2x': {},
      },
      book: {
        dimensions: {},
        alt: 'Book cover with title reading "Provisioning Operating Systems with Install Doctor"',
        copyright: null,
        url: 'https://install.doctor/assets/img/landing/ebook-text-box.png',
        '2x': {},
      },
    },
  ],
  micro_frontends: [
    {
      supertext: 'SPEED UP DEVELOPMENT',
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 17,
              end: 41,
              type: 'em',
            },
          ],
          text: 'Development-ready VMs for large-scale dev',
        },
      ],
      subtext: [
        {
          type: 'paragraph',
          spans: [],
          /*  {
              start: 215,
              end: 235,
              type: 'hyperlink',
              data: {
                target: '_blank',
                link_type: 'Web',
                url: 'https://install.doctor/blog/self-service-portal',
              },
            },
          ],*/
          text: 'Unlock unparalleled efficiency and innovation for your developers without compromising on device security. Our Enterprise subscription offers a game-changing solution: access to a self-service portal where developers can effortlessly request temporary, pre-configured VMs tailored to their needs. This approach not only accelerates their coding process but also significantly reduces software licensing expenses. Plus, it centralizes control over development environments, ensuring seamless management and oversight. Empower your team with the tools they need to excel, all while maintaining stringent security and cost-effectiveness.',
        },
      ],
      image: {
        dimensions: {},
        alt: 'Graphic depicting system connections',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/development-graphic.png',
      },
    },
  ],
  plugins: [
    {
      supertext: 'OS-Independent',
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 14,
              end: 39,
              type: 'em',
            },
          ],
          text: 'Avoid lock-in, use any operating system',
        },
      ],
      subtext:
        'Embrace unparalleled flexibility in your business operations with Install Doctor. Recognizing that diverse tasks demand diverse operating systems, we provide a solution that ensures your team can seamlessly transition between platforms with ease and confidence. With the ability to apply a single system configuration across any operating system or virtualization platform, Install Doctor empowers your business with the adaptability to meet any challenge head-on, ensuring productivity and efficiency regardless of the technological landscape.',
      image: {
        dimensions: {},
        alt: 'Wheel of operating system icons around Install Doctor icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/os-wheel.png',
        '2x': {},
      },
    },
  ],
  security: [
    {
      supertext: 'Enterprise-Grade Protection',
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 11,
              end: 42,
              type: 'em',
            },
          ],
          text: 'Zero-Trust, hardware-backed authentication',
        },
      ],
      subtext: [
        {
          type: 'paragraph',
          spans: [],
          /*  {
              start: 118,
              end: 139,
              type: 'hyperlink',
              data: {
                link_type: 'Web',
                url: 'https://install.doctor/blog/single-sign-on',
              },
            },
          ],*/
          text: 'Gain a formidable competitive edge with our state-of-the-art Zero-Trust, hardware-backed authentication system, setting a new standard in cybersecurity for your web services. By mandating Multi-Factor Authentication (MFA) and supporting advanced hardware-based methods like FIDO2, we ensure that every access point is fortified. This rigorous security protocol not only elevates your defenses but also positions your business as a trusted leader in protecting data and user privacy, giving you an unparalleled advantage in today’s digital landscape.',
        },
      ],
      image: {
        dimensions: {},
        alt: 'Security icons around Install Doctor icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/security-wheel.png',
        '2x': {},
      },
    },
  ],
  delivery: [
    {
      supertext: 'ULTRA SECURE',
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 16,
              end: 32,
              type: 'em',
            },
          ],
          text: 'Reboot to reset, read-only disks',
        },
      ],
      subtext: [
        {
          type: 'paragraph',
          spans: [],
          /*  {
              start: 148,
              end: 170,
              type: 'hyperlink',
              data: {
                target: '_blank',
                link_type: 'Web',
                url: 'https://install.doctor/blog/immutable-golden-image',
              },
            },
          ],*/
          text: "Elevate your cybersecurity strategy with Install Doctor's cutting-edge Immutable Golden Image (IGI) feature, a testament to our commitment to bleeding-edge technology. By utilizing a USB-C hard drive equipped with specialized firmware, your system's core files become immutable, drastically reducing the attack surface that traditional systems cannot protect against. This innovative approach, combined with the flexibility of traditional disks through a union file system, offers a unique solution: the ability to reboot and eliminate ransomware threats while preserving essential stateful data on hard disks, S3 buckets, and similar storage solutions. Embrace the future of secure system management and resilience with Install Doctor, where advanced technology meets unparalleled security.",
        },
      ],
      image: {
        dimensions: {},
        alt: 'Tablet connected to USB hard disk',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/usb-drive-graphic.png',
        '2x': {},
      },
    },
  ],
  support_guidance: [
    {
      image: {
        dimensions: {},
        alt: 'Message popup with timer',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/support-icon.png',
        '2x': {},
      },
      title: 'Mission-Critical Support',
      text: 'Rest assured with our commitment to reliable service and support. We offer guaranteed response times under our Service Level Agreements (SLAs) throughout the provisioning process. Our expert support team stands ready to assist you with any troubleshooting or issues, ensuring a seamless and trustworthy experience.',
    },
    {
      image: {
        dimensions: {},
        alt: 'Three person icons with sliders',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/guidance-icon.png',
        '2x': {},
      },
      title: 'Expert Guidance',
      text: 'Unlock tailored solutions and strategic guidance with our seasoned team of provisioning experts. Collaborating closely with your teams, we offer personalized architecture recommendations and strategies aligned with your distinct objectives and challenges. Our commitment is to partner with you every step of the way, ensuring your success is not just a goal but a guarantee.',
    },
  ],
  features: [
    {
      supertext: 'Enterprise Key Features',
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 21,
              end: 62,
              type: 'em',
            },
          ],
          text: 'Everything you need. Exclusive features and SME-level support.',
        },
      ],
      subtext: [
        {
          type: 'paragraph',
          spans: [],
          text: "Elevate your team's performance with Install Doctor, your gateway to an extensive suite of free, open-source tools and services designed for power users seeking efficiency enhancements. Navigating the wealth of open-source projects integrated into Install Doctor's ecosystem has never been easier.",
        },
        {
          type: 'paragraph',
          spans: [],
          /*  {
              start: 204,
              end: 230,
              type: 'hyperlink',
              data: {
                target: '_self',
                link_type: 'Web',
                url: 'https://install.doctor/blog/single-sign-on',
              },
            },
            {
              start: 234,
              end: 253,
              type: 'hyperlink',
              data: {
                target: '_self',
                link_type: 'Web',
                url: 'https://install.doctor/blog/self-service-portal',
              },
            },
            {
              start: 278,
              end: 305,
              type: 'hyperlink',
              data: {
                target: '_self',
                link_type: 'Web',
                url: 'https://install.doctor/blog/immutable-golden-image',
              },
            },
          ],*/
          text: 'By opting for an Enterprise agreement, you gain direct access to a dedicated subject matter expert (SME) poised to tailor solutions that cater precisely to your needs, utilizing the best of free, open-source projects. Enjoy exclusive Enterprise benefits such as seamless single sign-on integration, a convenient self-service portal, and a cutting-edge, hardware-backed, write-protected file system, all designed to optimize your operations and safeguard your data. Transform your workflow with Install Doctor, where innovation meets practicality.',
        },
      ],
    },
  ],
  features__list: [
    {
      icon: {
        dimensions: {},
        alt: 'Open source sphere in cube icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/open-source-icon.png',
        '2x': {},
      },
      title: 'Enterprise + Open-Source Features',
      text: `Elevate your enterprise experience with Install Doctor's unparalleled suite of exclusive features, marking it as a standout, robust solution in the tech landscape. It's truly 1 OAK - One Of A Kind, offering unmatched innovation and performance that set your operations apart.`,
    },
    {
      icon: {
        dimensions: {},
        alt: 'Paper icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/paper-icon.png',
        '2x': {},
      },
      title: 'Guaranteed SLA',
      text: 'Experience unwavering reliability with our prompt support and troubleshooting services, available precisely when you need them. Benefit from direct access to the expert Install Doctor team, complete with guaranteed response times, ensuring you receive professional assistance swiftly and efficiently.',
    },
    {
      icon: {
        dimensions: {},
        alt: 'Calendar icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/calendar-icon.png',
        '2x': {},
      },
      title: 'Regular Release Cycles',
      text: `Depend on a release timeline that delivers with precision and speed, moving at the pace of your business needs rather than the unpredictable schedules of community maintainers. With us, it's about days, not months or years, ensuring you stay ahead and reliable in every step of your journey.`,
    },
    {
      icon: {
        dimensions: {},
        alt: 'Shield icon with checkmark',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/shield-icon.png',
        '2x': {},
      },
      title: 'Critical Security Updates & Fixes',
      text: 'Safeguard your users with proactive security notifications and updates that align seamlessly with OS releases, patches, and emerging vulnerabilities. Our vigilant approach ensures your environment remains secure, keeping you one step ahead in protection.',
    },
    {
      icon: {
        dimensions: {},
        alt: 'Head icon with light bulb',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/head-icon.png',
        '2x': {},
      },
      title: 'Guidance & Expertise',
      text: `Our dedicated team is at your service to guarantee that you're leveraging the finest open-source tools and provisioning practices available. We're here to help you meet your project deadlines efficiently, steering clear of expensive technical debt and setting the stage for your success.`,
    },
  ],
  editions: [
    {
      supertext: 'READY FOR ENTERPRISE',
      title: [
        {
          type: 'heading2',
          spans: [
            {
              start: 20,
              end: 39,
              type: 'em',
            },
          ],
          text: 'Slay requirements, leverage open-source',
        },
      ],
      paragraph_1: [
        {
          type: 'paragraph',
          spans: [],
          text: 'Discover the transformative potential of low-code and no-code solutions based on open-source software with Install Doctor.',
        },
      ],
      paragraph_2: [
        {
          type: 'paragraph',
          spans: [],
          text: 'We invite you to explore how our use of freely accessible, open-source tools can dramatically reduce your requirements while providing secure, enterprise-grade solutions more swiftly. Engage with our sales team to see the real-world impact and efficiency gains Install Doctor can bring to your organization.',
        },
      ],
      cta_1: 'Talk to sales',
      image: {
        dimensions: {},
        alt: 'Open source icon graphic',
        copyright: null,
        url: 'https://install.doctor/assets/img/enterprise/open-source-icon-graphic.png',
        '2x': {},
      },
    },
  ],
  demo: [
    {
      supertext: 'Talk to Sales',
      title: 'Install Doctor for Enterprise',
    },
  ],
};

export const CommunityPageData = {
  defaults,
  top: [
    {
      type: 'heading1',
      spans: [],
      text: 'Community Hub',
    },
    {
      type: 'paragraph',
      spans: [],
      text: 'Discover the thriving ecosystem of Install Doctor—an expansive and dynamic project fueled by a passionate community. Dive into lively discussions, collaborate with the Install Doctor team, and connect with other supportive members across various platforms including Discord, GitHub Discussions, Twitter, and beyond. Join us on this exciting journey of innovation and collaboration!',
    },
  ],
  community_list_1: [
    {
      image: {
        dimensions: {},
        alt: 'Card with Discord icon',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/discord-graphic.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'Join the Discord',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Join our lively Discord community to discuss new features, ask questions, and help others get started!',
        },
      ],
      link: {
        target: '_blank',
        url: 'https://discord.com/channels/1077138419953713222/1077138479928049734',
      },
    },
    {
      image: {
        dimensions: {},
        alt: 'GitHub discussions forum on card',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/support-community.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'GitHub Discussions',
        },
        {
          type: 'paragraph',
          spans: [],
          text: 'Dive into our GitHub Discussions for updates, ideas, polls, Q&A, and user examples of Install Doctor implementations. Join the conversation and get inspired!',
        },
      ],
      link: {
        target: '_blank',
        url: 'https://github.com/heymegabyte/install.doctor/discussions',
      },
    },
    {
      image: {
        dimensions: {},
        alt: 'Message icons with world map behind representing the Matrix chat',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/community-graphic.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'Matrix Chat',
        },
        {
          type: 'paragraph',
          spans: [],
          text: "Join our Install Doctor matrix chat room on Matrix. Whether you have questions or want to help others, we're here for you!",
        },
      ],
      link: {
        target: '_blank',
        url: 'https://app.element.io/#/room/#install.doctor:matrix.org',
      },
    },
  ],
  community_list_2: [
    {
      image: {
        dimensions: {},
        alt: 'Card with Twitter graphic',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/twitter-graphic.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'Stay Connected on Twitter',
        },
        {
          type: 'paragraph',
          spans: [],
          text: `Stay connected and engaged—follow us on Twitter! Get the latest updates, discover trending topics, and dive into engaging discussions. Don't miss out, join the conversation today!`,
        },
      ],
      link: {
        target: '_blank',
        url: 'https://twitter.com/InstallDoc',
      },
    },
    {
      image: {
        dimensions: {},
        alt: 'Card with Slack graphic',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/slack-graphic.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'Slack Discussions',
        },
        {
          type: 'paragraph',
          spans: [],
          text: "Connect with us on Slack for real-time chats and collaboration. Join our workspace to engage with our team, ask questions, and stay updated on the latest news and announcements. Let's chat!",
        },
      ],
      link: {
        target: '_blank',
        url: 'https://github.com/heymegabyte/install.doctor/discussions',
      },
    },
    {
      image: {
        dimensions: {},
        alt: 'Card with Facebook graphic',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/facebook-graphic.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'Follow on Facebook',
        },
        {
          type: 'paragraph',
          spans: [],
          text: `Follow us on Facebook to stay connected! Get exclusive updates, content, and join lively discussions. Don't miss the latest news and behind-the-scenes access. Join our community today!`,
        },
      ],
      link: {
        target: '_blank',
        url: 'https://www.facebook.com/InstallDoctor/',
      },
    },
  ],
  community_list_3: [
    {
      image: {
        dimensions: {},
        alt: 'Card with LinkedIn graphic',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/linkedin-graphic.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'Link up on LinkedIn',
        },
        {
          type: 'paragraph',
          spans: [],
          text: `Join our professional network and unlock a world of opportunities and connections! Don't miss the chance to elevate your career—connect with us today!`,
        },
      ],
      link: {
        target: '_blank',
        url: 'https://linkedin.com/company/megabyte-labs',
      },
    },
    {
      image: {
        dimensions: {},
        alt: 'Card with YouTube graphic',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/youtube-graphic.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'YouTube Channel',
        },
        {
          type: 'paragraph',
          spans: [],
          text: "Join our YouTube channel to dive into a world of engaging content tailored just for you, where every video promises to enlighten, entertain, and inspire. Don't miss out on the journey to discover, learn, and grow together with our vibrant community!",
        },
      ],
      link: {
        target: '_blank',
        url: 'https://www.youtube.com/@InstallDoctor',
      },
    },
    {
      image: {
        dimensions: {},
        alt: 'Card with GitLab graphic',
        copyright: null,
        url: 'https://install.doctor/assets/img/community/gitlab-graphic.png',
        '2x': {},
      },
      text: [
        {
          type: 'heading4',
          spans: [],
          text: 'Connect on GitLab',
        },
        {
          type: 'paragraph',
          spans: [],
          text: `We deeply value our GitLab family, but we've made the exciting move to GitHub to broaden our reach and enhance community engagement. However, our commitment to our GitLab supporters remains strong, and we'd be thrilled to have you join us there too!`,
        },
      ],
      link: {
        target: '_blank',
        url: 'https://gitlab.com/megabyte-labs/install.doctor',
      },
    },
  ],
};

export default state;
