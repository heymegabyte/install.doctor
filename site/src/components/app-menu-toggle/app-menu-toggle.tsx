import { Component, Event, EventEmitter, Host, Prop, h } from '@stencil/core';

@Component({
  tag: 'app-menu-toggle',
  styleUrl: 'app-menu-toggle.scss',
})
export class AppBurger {
  @Prop() icon = 'menu-outline';

  @Event() menuToggleClick: EventEmitter;

  handleButtonClick() {
    this.menuToggleClick.emit();
  }

  render() {
    return (
      <Host>
        <button type="button" aria-label="Toggle navigation menu" class="menu-toggle-button" onClick={() => this.handleButtonClick()}>
          <ion-icon icon={this.icon} aria-hidden="true"></ion-icon>
        </button>
      </Host>
    );
  }
}
