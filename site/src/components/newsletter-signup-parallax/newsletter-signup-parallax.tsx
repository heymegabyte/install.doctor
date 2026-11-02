import { Component, Host, State, h, Prop, Event, EventEmitter } from '@stencil/core';
import { Paragraph } from 'ionic-ds-no-fonts';
import { defaults } from 'src/store';

@Component({
  tag: 'newsletter-signup-parallax',
  styleUrl: 'newsletter-signup-parallax.scss',
})
export class NewsletterSignupParallax {
  @Prop() defaults: typeof defaults;
  @State() email: string = '';
  @State() isLoading: boolean = false;
  @State() hasSubmitted: boolean = false;
  @State() isValid: boolean = true;
  @State() inlineMessage: string = '';
  @Event() emailInputBlur: EventEmitter<any>;
  @Event() submissionSuccess: EventEmitter<any>;
  blurTimeout: any;

  componentWillLoad() {}

  handleNewsletterSubmit(e: Event) {
    e.preventDefault();
    this.clearBlur(e);

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
        this.submissionSuccess.emit();
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
    customFields.join_type = 'parallax';
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

  inputBlur(ev) {
    this.blurTimeout = setTimeout(() => {
      if (!this.email) {
        this.emailInputBlur.emit(ev);
      }
    }, 50);
  }

  clearBlur(ev) {
    ev.preventDefault();
    clearTimeout(this.blurTimeout);
  }

  handleInlineMessage(returnMessage: string) {
    const messageMatch = returnMessage && returnMessage.match && returnMessage.match(/<p>(.*?)<\/p>/);
    return messageMatch ? messageMatch[1] : undefined;
  }

  render() {
    return (
      <Host
        class={{
          nopointer: this.hasSubmitted,
        }}
      >
        <div class="wrapper" aria-live="polite">
          {this.hasSubmitted ? (
            <div class="form-message" role="status">
              <Paragraph level={5} class="form-message-p">
                {this.inlineMessage}
              </Paragraph>
            </div>
          ) : (
            <div class="form-group">
              <form class="hs-form parallax-form" onSubmit={(e) => this.handleNewsletterSubmit(e)}>
                <div class="hs_email hs-email hs-fieldtype-text field hs-form-field">
                  <div class="input">
                    <input
                      id="parallax-input"
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
                      onBlur={(ev) => {
                        this.inputBlur(ev);
                      }}
                      onFocus={(ev) => {
                        this.clearBlur(ev);
                      }}
                      required
                    />
                  </div>
                </div>
                <div class="hs_submit hs-submit">
                  <div class="actions">
                    <input
                      type="submit"
                      class="hs-button ui-button primary large"
                      onFocus={(ev) => {
                        this.clearBlur(ev);
                      }}
                      onBlur={(ev) => {
                        this.inputBlur(ev);
                      }}
                      value=" ->"
                    />
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
        {!this.isValid && (
          <Paragraph level={5} class={{ 'error-message': !this.isValid }}>
            {this.inlineMessage}
          </Paragraph>
        )}
      </Host>
    );
  }
}
