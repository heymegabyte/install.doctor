import { Component, Element, Prop, h } from '@stencil/core';
import { defaults } from 'src/store';

@Component({
  tag: 'prismic-image',
})
export class PrismicImage {
  @Prop() image;
  @Prop() defaults: typeof defaults;
  @Prop() params;
  @Prop() height: number | string;
  @Prop() width: number | string;
  @Prop() loading: 'eager' | 'lazy' = 'lazy';
  @Prop() alt: string;
  @Prop() class: string;
  __rest;

  @Element() el;

  render() {
    // Interop shim for ionic-ds-no-fonts compiled output.
    const __rest =
      (this && this.__rest) ||
      function (s, e) {
        var t = {};
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
        if (s != null && typeof Object.getOwnPropertySymbols === 'function')
          // @ts-ignore
          for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
          }
        return t;
      };
    // @ts-ignore
    var { image, params } = this.image,
      props = __rest(this.image, ['image', 'params']);
    const regex = new RegExp(this.defaults.homepage, 'gi');
    const strippedUrl = props.url.replace(regex, '');
    const webpSrc = strippedUrl.replace(/.png/gi, '.webp');
    const webpSrc2x = strippedUrl.replace(/.png/gi, '-2x.webp');
    const pngSrc2x = strippedUrl.replace(/.png/gi, '-2x.png');
    const imgSrcSet = strippedUrl + ' 1x, ' + pngSrc2x + ' 2x';
    if (strippedUrl.match(/-1x.png$/gi)) {
      return (
        <picture>
          <source type="image/webp" src={webpSrc} />
          <source type="image/png" src={strippedUrl} />
          <img
            src={strippedUrl}
            alt={props.alt}
            width={this.width}
            height={this.height}
            class={this.class}
            loading={this.loading}
          />
        </picture>
      );
    } else {
      return (
        <picture>
          <source type="image/webp" src={webpSrc + ' 1x'} />
          <source type="image/webp" src={webpSrc2x + ' 2x'} />
          <source type="image/png" src={props.url + ' 1x'} />
          <source type="image/png" src={pngSrc2x + ' 2x'} />
          <img
            src={strippedUrl}
            alt={props.alt}
            width={this.width}
            height={this.height}
            class={this.class}
            loading={this.loading}
            srcset={imgSrcSet}
          />
        </picture>
      );
    }
  }
}
