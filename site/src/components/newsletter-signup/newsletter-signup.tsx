import { Component, Host, State, h, Prop } from '@stencil/core';
import { NewsletterSubscriptionError, submitNewsletterSubscription } from '@theme-tools/ui/newsletter';
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

  async handleNewsletterSubmit(e: Event) {
    e.preventDefault();

    this.isLoading = true;
    this.inlineMessage = 'Adding your e-mail..';
    this.isValid = true;
    try {
      const response = await submitNewsletterSubscription({
        email: this.email,
        endpoint: this.defaults.emailForm.url,
        createBody: (email) => ({
          list_ids: this.defaults.sendGridListId,
          contacts: [{ email }],
        }),
      });
      const body = response as { inlineMessage?: string } | undefined;
      this.inlineMessage = body?.inlineMessage ?? 'Subscription confirmed.';
      this.hasSubmitted = true;
    } catch (error) {
      this.inlineMessage =
        error instanceof NewsletterSubscriptionError && error.status === 400
          ? 'Please enter a valid e-mail address.'
          : error instanceof Error
            ? error.message
            : 'Unknown error occurred';
      this.isValid = false;
    } finally {
      this.isLoading = false;
    }
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
