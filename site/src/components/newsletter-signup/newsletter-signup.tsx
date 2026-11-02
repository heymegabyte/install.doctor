import { Component, Host, State, h, Prop } from '@stencil/core';
import { Heading, Paragraph } from 'ionic-ds-no-fonts';
import { defaults } from '../../store';

@Component({
  tag: 'newsletter-signup',
  styleUrl: 'newsletter-signup.scss',
})
export class NewsletterSignup {
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
      if (xhr.readyState === 4 && xhr.status === 200) {
        const json = JSON.parse(xhr.responseText);
        this.inlineMessage = json.inlineMessage;
        this.isLoading = false;
        this.hasSubmitted = true;
        this.isValid = true;
      } else if (xhr.readyState == 4 && xhr.status == 400) {
        this.inlineMessage = 'Please enter a valid e-mail address.';
        this.isLoading = false;
        this.isValid = false;
      } else if (xhr.readyState == 4) {
        this.inlineMessage = 'Unknown error occurred';
        this.isLoading = false;
        this.isValid = false;
      } else {
        this.inlineMessage = 'Adding your e-mail..';
        this.isLoading = true;
        this.isValid = true;
      }
    };

    xhr.send(
      JSON.stringify({
        list_ids: this.defaults.sendGridListId,
        contacts: [
          {
            email: this.email,
          },
        ],
      })
    );
  }

  handleEmailChange(ev: any) {
    this.email = ev.target.value;
    this.isValid = true;
  }

  handleInlineMessage(returnMessage: string) {
    const messageMatch = returnMessage.match && returnMessage.match(/<p>(.*?)<\/p>/);
    return messageMatch ? messageMatch[1] : undefined;
  }

  render() {
    return (
      <Host>
        <div class="wrapper">
          <div class="heading-group">
            <Heading>The latest updates. Delivered monthly.</Heading>
            <Paragraph>
              {this.defaults.brandName} is getting better every day. Sign up for a monthly email on the latest updates,
              releases, articles, news, and exclusive beta features!
            </Paragraph>
          </div>
          <div class="form-group" aria-live="polite">
            {this.hasSubmitted ? (
              <div class="form-message" role="status">
                <ion-icon name="checkmark-circle" aria-hidden="true"></ion-icon>
                <Paragraph>{this.handleInlineMessage(this.inlineMessage)}</Paragraph>
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
      </Host>
    );
  }
}
