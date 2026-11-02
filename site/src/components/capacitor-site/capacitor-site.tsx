import { Component, h } from '@stencil/core';
import { Routes } from '../../router';
import state from '../../store';

@Component({
  tag: 'capacitor-site',
  styleUrl: 'capacitor-site.scss',
})
export class App {
  render() {
    return (
      <site-root>
        <div class={`page-theme--${state.pageTheme}`}>
          <Routes />
        </div>
      </site-root>
    );
  }
}
