import { Component, h, Host } from '@stencil/core';

@Component({
  tag: 'more-button',
  styleUrl: 'more-button.scss',
})
export class MoreButton {
  render() {
    return (
      <Host>
        <button type="button" aria-label="More options">
          <svg xmlns="http://www.w3.org/2000/svg" class="ionicon" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
            <circle cx="256" cy="256" r="48" />
            <circle cx="256" cy="416" r="48" />
            <circle cx="256" cy="96" r="48" />
          </svg>
        </button>
      </Host>
    );
  }
}
