import { Component, Prop, h, Host, Element, State } from '@stencil/core';
import { Heading, Paragraph, DateTime, ResponsiveContainer, Breakpoint } from 'ionic-ds-no-fonts';
import { Components as DS } from 'ionic-ds-no-fonts/dist/types/components';
import { JSXBase } from '@stencil/core/internal';

import parseISO from 'date-fns/parseISO';

import { BlogData } from 'src/data.server/blog';
import ResponsiveImage from 'src/components/ResponsiveImage/ResponsiveImage';
import { defaults } from 'src/store';

const twitterLogo = ({ main = '#1DA1F2' } = {}, props?: JSXBase.SVGAttributes) => (
  <svg viewBox="0.630000114440918 -0.003784056520089507 14.744999885559082 12.00379753112793" {...props}>
    <path
      fill={main}
      d="M15.375 1.422a6.116 6.116 0 01-1.738.478A3.036 3.036 0 0014.97.225c-.585.347-1.232.6-1.922.734A3.026 3.026 0 007.89 3.72 8.574 8.574 0 011.653.553a3.029 3.029 0 00.94 4.044c-.5-.013-.968-.15-1.374-.378v.037a3.028 3.028 0 002.428 2.969 3.045 3.045 0 01-.797.106c-.194 0-.384-.019-.569-.056A3.03 3.03 0 005.11 9.378a6.066 6.066 0 01-4.48 1.253A8.457 8.457 0 005.258 12c5.572 0 8.616-4.616 8.616-8.619 0-.131-.003-.262-.01-.39a6.158 6.158 0 001.51-1.57z"
    ></path>
  </svg>
);

const facebookRoundedLogo = ({ main = 'gray' } = {}, props?: JSXBase.SVGAttributes) => (
  <svg viewBox="0 0 20 20" {...props}>
    <path
      fill={main}
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M20 10.06C20 4.5 15.52 0 10 0S0 4.5 0 10.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H5.9v-2.91h2.54V7.84c0-2.52 1.5-3.91 3.77-3.91 1.1 0 2.24.2 2.24.2V6.6H13.2c-1.24 0-1.63.78-1.63 1.57v1.9h2.78l-.45 2.9h-2.33V20A10.04 10.04 0 0020 10.06z"
    />
  </svg>
);

const linkedInLogo = ({ main = '#0072b1' } = {}, props?: JSXBase.SVGAttributes) => (
  <svg viewBox="0 0 12 12" {...props}>
    <path
      fill={main}
      d="M11.04 0H1.03C.48 0 0 .4 0 .93v10.04C0 11.52.48 12 1.03 12h10c.56 0 .97-.49.97-1.03V.93c0-.54-.41-.93-.96-.93zM3.72 10H2V4.66h1.72V10zm-.8-6.16h-.01c-.55 0-.9-.4-.9-.92S2.36 2 2.92 2s.9.4.92.92c0 .52-.36.92-.93.92zM10 10H8.28V7.08c0-.7-.25-1.18-.87-1.18-.47 0-.76.32-.88.64-.05.1-.06.26-.06.42V10H4.75V4.66h1.72v.74c.25-.35.64-.87 1.55-.87 1.13 0 1.98.75 1.98 2.35V10z"
    />
  </svg>
);

@Component({
  tag: 'blog-post',
  styleUrl: 'blog-post.scss',
  assetsDirs: ['assets'],
})
export class BlogPost {
  @Prop() preview?: boolean = false;
  @Prop() data: BlogData;
  @Prop() defaults: typeof defaults;

  @State() ogAssetPath!: string;
  @State() moreResources: DS.MoreResources = {
    resources: [],
    routing: [],
  };
  popupHeight = 0;
  popupWidth = 0;
  private twitterUrl = [
    'https://twitter.com/intent/tweet?',
    `url=${encodeURIComponent(`${window.location.origin}${window.location.pathname}`)}`,
  ];
  private facebookUrl = [
    'https://www.facebook.com/sharer/sharer.php?',
    `u=${encodeURIComponent(`${window.location.origin}${window.location.pathname}`)}`,
  ];
  private linkedInUrl = [
    'https://www.linkedin.com/sharing/share-offsite',
    `?url=${encodeURIComponent(`${window.location.origin}${window.location.pathname}`)}`,
  ];

  @Element() el!: HTMLElement;

  componentWillLoad() {
    // const { slug, getRelatedResources, preview } = this;
    // this.data = (posts as RenderedBlog[]).find(p => p.slug === slug);
    // if (!this.data) console.error('Could not find blog post by slug.');
    // if (!preview) getRelatedResources();
  }

  scrubUrl(url) {
    return url.replace(/http:\/\/localhost:\d\d\d\d/g, this.defaults.homepage);
  }

  openPopup(url) {
    this.calculatePopupSize();
    let leftPosition;
    let topPosition;
    leftPosition = window.screen.width / 2 - (this.popupWidth / 2 + 10);
    topPosition = window.screen.height / 2 - (this.popupHeight / 2 + 50);
    window.open(
      url,
      'Window2',
      'status=no,height=' +
        this.popupHeight +
        ',width=' +
        this.popupWidth +
        ',resizable=yes,left=' +
        leftPosition +
        ',top=' +
        topPosition +
        ',screenX=' +
        leftPosition +
        ',screenY=' +
        topPosition +
        ',toolbar=no,menubar=no,scrollbars=no,location=no,directories=no'
    );
  }

  // TODO: Add this at compile time instead of after DOM is loaded in browser
  componentDidLoad() {
    setTimeout(() => {
      for (var links = document.links, i = 0, a; (a = links[i]); i++) {
        if (a.host !== location.host) {
          a.target = '_blank';
          a.rel = 'noopener';
        }
      }
    }, 100);
  }

  calculatePopupSize() {
    if (window.screen.width > 630) {
      this.popupHeight = 500;
      this.popupWidth = 600;
    } else {
      this.popupHeight = 300;
      this.popupWidth = 450;
    }
  }

  shareFacebook(e) {
    e.preventDefault();
    this.openPopup(
      'https://www.facebook.com/dialog/share?app_id=' +
        this.defaults.facebookAppId +
        '&display=popup&href=' +
        encodeURIComponent(this.scrubUrl(`${window.location.origin}${window.location.pathname}`))
    );
  }

  shareTwitter(e) {
    e.preventDefault();
    this.openPopup(
      'https://twitter.com/intent/tweet?url=' +
        encodeURIComponent(this.scrubUrl(`${window.location.origin}${window.location.pathname}`)) +
        '&text=' +
        encodeURIComponent(this.defaults.share.twitter.defaultTweet) +
        '&via=' +
        this.defaults.share.twitter.username +
        '&hashtags=' +
        this.defaults.share.twitter.hashtags +
        (this.data.tags.length ? ',' + this.data.tags : '')
    );
  }

  shareLinkedIn(e) {
    e.preventDefault();
    this.openPopup(
      'https://www.linkedin.com/shareArticle?mini=true&url=' +
        encodeURIComponent(`${window.location.origin}${window.location.pathname}`) +
        '&title=' +
        encodeURIComponent(this.data!.title) +
        '&summary=' +
        encodeURIComponent(this.defaults.share.linkedin.summary) +
        '&source=' +
        encodeURIComponent(this.defaults.share.linkedin.source)
    );
  }

  // getRelatedResources = async () => {
  //   const { related } = this.data!;
  //   if (!related) return;

  //   await Promise.all(
  //     related.map(async resource => {
  //       const info = await this.getRelatedDetails(resource);
  //       if (!info || !info.type || !info.uid)
  //         return console.error('Couldnt get type or uid of related resources');

  //       const doc = await this.client.getByUID(
  //         resourceTypeToPrismicType(info.type),
  //         info.uid,
  //         {},
  //       );
  //       this.moreResources.resources?.push(prismicDocToResource(doc));
  //       (this.moreResources.routing as DS.ResourceCard['routing'][]).push(
  //         info.routing,
  //       );
  //     }),
  //   );

  //   this.moreResources = {
  //     resources: [...this.moreResources.resources!],
  //     routing: [
  //       ...(this.moreResources.routing! as DS.ResourceCard['routing'][]),
  //     ],
  //   };
  //   // this.moreResources = {...this.moreResources)};
  // };

  // getRelatedDetails = async (url: string) => {
  //   const matchResults = url.match(/\/resources\/(.*?)$/);
  //   if (!matchResults || !matchResults[1])
  //     return console.error('Invalid url for markdown blog related resources');

  //   const relatedInfo = matchResults[1].split('/');
  //   const uid = relatedInfo.pop();
  //   const type = relatedInfo.pop();
  //   if (!uid)
  //     return console.error(
  //       'Error getting uid from markdown blog related resource url',
  //     );

  //   if (!type) {
  //     const type = await this.getResourceType(uid);
  //     const routing = {
  //       base: '/resources',
  //       includeType: false,
  //       router: Router,
  //     };
  //     return { type, uid, routing };
  //   } else {
  //     return { type: getResourceTypeForParam(type), uid, routing: url };
  //   }
  // };

  // async getResourceType(uid: string) {
  //   const { data } = await this.client.getSingle('appflow_resources', {});

  //   const { type } = Object.values(data).find(
  //     (link: any) => link.hasOwnProperty('uid') && link.uid === uid,
  //   ) as ResourceLink;
  //   if (!type)
  //     console.error(
  //       'Markdown Blog related resource link not found in appflow resource center',
  //     );

  //   return typeToResourceType(type);
  // }

  render() {
    if (!this.data) return;

    const { PostDetail, PostPreview, preview } = this;

    return (
      <Host
        class={{
          'sc-blog-post': true,
          preview: preview!,
          detail: !preview,
        }}
      >
        {preview ? <PostPreview /> : <PostDetail />}
      </Host>
    );
  }

  getShareKeyword = () => {
    const keywords = [
      'Obey',
      'Laugh',
      'Prosper',
      'Smile',
      'Snicker',
      'Twiddle',
      'Praise',
      'Dream',
      'Thrive',
      'Advance',
      'Flourish',
      'Multiply',
      'Blossom',
    ];
    return keywords[Math.floor(Math.random() * keywords.length)];
  };

  PostHelmet = () => {
    const path = this.data!.featuredImage
      ? `${window.location.origin}/assets/img/blog${this.data!.featuredImage}`
      : this.defaults.image;

    return (
      <meta-tags
        defaults={this.defaults}
        pageTitle={this.data.title}
        description={this.data.description}
        image={path}
      />
    );
  };
  PostDetail = () => {
    const { PostAuthor, PostAuthorLarge, PostFeaturedImage, MoreResources, PostHelmet, PostTags, data } = this;

    return [
      <PostHelmet />,
      <site-header defaults={this.defaults} class="heading-container" sticky={true} />,
      <blog-subnav
        breadcrumbs={[
          ['Blog', '/blog'],
          [data?.title!, `/blog/${data.slug}`],
        ]}
      />,
      <ResponsiveContainer>
        <article class="post">
          <Breakpoint md={true} class="sticky-wrapper">
            <blog-social-actions defaults={this.defaults} post={data} column class="top" />
          </Breakpoint>

          <Heading class="ui-theme--editorial" level={1}>
            {data!.title}
          </Heading>
          <PostAuthor post={data!} />
          <PostTags post={data!} />
          <PostFeaturedImage preview={this.preview} post={data} />

          <div class="post-content" innerHTML={data!.html} />
          <PostAuthorLarge post={data!} />
          <MoreResources />
          <disqus-comments url={`${window.location.origin}/blog/${data.slug}`} siteId={this.defaults.disqusSiteId} />
        </article>
      </ResponsiveContainer>,
      <ResponsiveContainer id="footer-social-container">
        <div class="blog-footer-social">
          <h4>
            <span>{this.getShareKeyword()}</span> & Share:
          </h4>
          <a
            class="footer-social facebook hint--top hint--rounded"
            href={this.facebookUrl.join('')}
            onClick={(e) => this.shareFacebook(e)}
            target="_blank"
            rel="noopener"
            aria-label="Facebook"
          >
            {facebookRoundedLogo({ main: '#3b5998' }, { width: 24, height: 24, class: 'facebook' })}
          </a>
          <a
            class="footer-social twitter hint--top hint--rounded"
            href={this.twitterUrl.join('')}
            onClick={(e) => this.shareTwitter(e)}
            target="_blank"
            rel="noopener"
            aria-label="Twitter (X)"
          >
            {twitterLogo({ main: '#00acee' }, { width: 24, height: 24, class: 'twitter' })}
          </a>
          <a
            class="footer-social linkedin hint--top hint--rounded"
            href={this.linkedInUrl.join('')}
            onClick={(e) => this.shareLinkedIn(e)}
            target="_blank"
            rel="noopener"
            aria-label="LinkedIn"
          >
            {linkedInLogo({ main: '#0072b1' }, { width: 24, height: 24, class: 'linkedin' })}
          </a>
        </div>
      </ResponsiveContainer>,
      <capacitor-site-footer defaults={this.defaults} />,
    ];
  };

  PostPreview = () => {
    const { PostAuthor, PostFeaturedImage } = this;

    return (
      <article class="post">
        <Heading
          class="ui-theme--editorial"
          level={2}
          onClick={() => {
            window.scrollTo(0, 0);
          }}
        >
          <a
            class="post-link post-title"
            data-tags={this.data.tags ? this.data.tags : ''}
            href={`/blog/${this.data.slug}`}
          >
            {this.data!.title}
          </a>
        </Heading>
        <PostAuthor />
        <PostFeaturedImage preview={this.preview} post={this.data} />

        <div class="post-content" innerHTML={this.data!.html} />

        <a class="underline-hover continue-reading ui-paragraph-2" href={`/blog/${this.data.slug}`}>
          <span onClick={() => window.scrollTo(0, 0)}>
            Continue reading <span class="arrow">-&gt;</span>
          </span>
        </a>
      </article>
    );
  };

  PostTags = () => {
    const { tags } = this.data!;
    if (!tags.length) return;
    const tagArray = tags as any;
    return (
      <div class="tag-pills" data-tags={tags}>
        {tagArray.map((tag) => (
          <div class="tag-pill">{tag}</div>
        ))}
      </div>
    );
  };

  PostAuthor = () => {
    const { date, authorName, authorUrl, authorImageName, modifiedDate } = this.data!;
    const dateString = parseISO(date);
    let modifiedDateString;
    if (modifiedDate) {
      modifiedDateString = parseISO(modifiedDate as string);
    }
    const imageParts = authorImageName?.split('.');
    if (!imageParts || !imageParts[0] || !imageParts[1])
      return console.error(
        'Markdown Blog author image name not formatted correctly.  It should look like: max-lynch.png'
      );

    const data = {
      name: imageParts[0],
      type: imageParts[1],
    };

    return (
      <div class="author-date">
        {authorImageName ? (
          <ResponsiveImage {...data} path="/assets/img/blog/author/" dimensions="69x69" alt={authorName} />
        ) : null}
        <Paragraph class="publish-date">
          By{' '}
          {authorUrl ? (
            <a href={authorUrl} class="underline-hover" target="_blank" rel="noopener">
              {authorName}
            </a>
          ) : (
            authorName
          )}{' '}
          on <DateTime date={dateString} />
        </Paragraph>
        {modifiedDate ? (
          <Paragraph class="modified-date">
            <span>
              &nbsp;(modified on <DateTime date={modifiedDateString} />)
            </span>
          </Paragraph>
        ) : (
          ''
        )}
      </div>
    );
  };

  PostAuthorLarge = () => {
    const { authorImageName, authorName, authorUrl, authorDescription } = this.data!;
    if (!authorImageName) return null;

    return (
      <a href={authorUrl} target="_blank" rel="noopener" class="author-info">
        <webp-image src={`/assets/img/blog/author/${authorImageName}`} alt={authorName} width="128" height="128" />
        <div class="description">
          <Heading level={5}>{authorName}</Heading>
          {authorDescription ? <Paragraph level={4}>{authorDescription}</Paragraph> : null}
        </div>
      </a>
    );
  };

  MoreResources = () => {
    if (!this.moreResources.resources || this.moreResources.resources.length <= 0) return;

    return [
      <Heading level={4} class="more-resources__title | ui-theme--editorial">
        You might also like...
      </Heading>,
      <more-resources {...this.moreResources} />,
    ];
  };

  PostFeaturedImage = ({ post, preview }: { post: BlogData; preview: boolean }) => {
    if (!post.featuredImage) return null;

    const imageParts = post.featuredImage?.split('.');
    if (!imageParts || !imageParts[0] || !imageParts[1]) {
      console.log(post);
      return console.error(
        'Markdown Blog featured image name not formatted correctly.  It should look like: what-is-mobile-ci-cd.png'
      );
    }

    const data = {
      name: imageParts[0],
      type: imageParts[1],
      alt: post.featuredImageAlt,
    };

    const dimensions = imageParts[0].substring(imageParts[0].lastIndexOf('-') + 1);

    return (
      <div class="featured-image-wrapper">
        {preview ? (
          <a href={`/blog/${post.slug}`}>
            <ResponsiveImage
              {...data}
              fallback
              onClick={() => {
                window.scrollTo(0, 0);
              }}
              class="featured-image"
              dimensions={dimensions}
              path={'/assets/img/blog'}
              loading="eager"
            />
          </a>
        ) : (
          <ResponsiveImage
            {...data}
            fallback
            class="featured-image"
            dimensions={dimensions}
            path={'/assets/img/blog'}
            loading="eager"
          />
        )}
      </div>
    );
  };
}
