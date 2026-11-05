import { getBreakpoint } from '../../common/index.mjs';
import { Component } from '../../component.mjs';
import { ElementError } from '../../errors/index.mjs';

/**
 * Tabs component
    }
    this.mql = window.matchMedia(`(min-width: ${breakpoint.value})`);
    if ('addEventListener' in this.mql) {
      this.mql.addEventListener('change', () => this.checkMode());
    } else {
      this.mql.addListener(() => this.checkMode());
    }
    this.checkMode();
  }
  checkMode() {
    var _this$mql;
    if ((_this$mql = this.mql) != null && _this$mql.matches) {
      this.setup();
    } else {
      this.teardown();
    }
  }
  setup() {
    var _this$getTab;
    this.$tabList.setAttribute('role', 'tablist');
    this.$tabListItems.forEach($item => {
      $item.setAttribute('role', 'presentation');
    });
    this.$tabs.forEach($tab => {
      this.setAttributes($tab);
      $tab.addEventListener('click', this.boundTabClick, true);
      $tab.addEventListener('keydown', this.boundTabKeydown, true);
      this.hideTab($tab);
    });
    const $activeTab = (_this$getTab = this.getTab(window.location.hash)) != null ? _this$getTab : this.$tabs[0];
    this.showTab($activeTab);
    window.addEventListener('hashchange', this.boundOnHashChange, true);
  }
  teardown() {
    this.$tabList.removeAttribute('role');
    this.$tabListItems.forEach($item => {
      $item.removeAttribute('role');
    });
    this.$tabs.forEach($tab => {
      $tab.removeEventListener('click', this.boundTabClick, true);
      $tab.removeEventListener('keydown', this.boundTabKeydown, true);
      this.unsetAttributes($tab);
    });
    window.removeEventListener('hashchange', this.boundOnHashChange, true);
  }
  onHashChange() {
    const hash = window.location.hash;
    const $tabWithHash = this.getTab(hash);
    if (!$tabWithHash) {
      return;
    }
    if (this.changingHash) {
      this.changingHash = false;
      return;
    }
    const $previousTab = this.getCurrentTab();
    if (!$previousTab) {
      return;
    }
    this.hideTab($previousTab);
    this.showTab($tabWithHash);
    $tabWithHash.focus();
  }
  hideTab($tab) {
    this.unhighlightTab($tab);
    this.hidePanel($tab);
  }
  showTab($tab) {
    this.highlightTab($tab);
    this.showPanel($tab);
  }
  getTab(hash) {
    return this.$root.querySelector(`a.govuk-tabs__tab[href="${hash}"]`);
  }
  setAttributes($tab) {
    const panelId = $tab.hash.replace('#', '');
    if (!panelId) {
      return;
    }
    $tab.setAttribute('id', `tab_${panelId}`);
    $tab.setAttribute('role', 'tab');
    $tab.setAttribute('aria-controls', panelId);
    $tab.setAttribute('aria-selected', 'false');
    $tab.setAttribute('tabindex', '-1');
    const $panel = this.getPanel($tab);
    if (!$panel) {
      return;
    }
    $panel.setAttribute('role', 'tabpanel');
    $panel.setAttribute('aria-labelledby', $tab.id);
    $panel.classList.add(this.jsHiddenClass);
  }
  unsetAttributes($tab) {
    $tab.removeAttribute('id');
    $tab.removeAttribute('role');
    $tab.removeAttribute('aria-controls');
    $tab.removeAttribute('aria-selected');
    $tab.removeAttribute('tabindex');
    const $panel = this.getPanel($tab);
    if (!$panel) {
      return;
    }
    $panel.removeAttribute('role');
    $panel.removeAttribute('aria-labelledby');
    $panel.classList.remove(this.jsHiddenClass);
  }
  onTabClick(event) {
    const $currentTab = this.getCurrentTab();
    const $nextTab = event.currentTarget;
    if (!$currentTab || !($nextTab instanceof HTMLAnchorElement)) {
      return;
    window.location.hash = panelId;
    $panel.id = panelId;
  }
  onTabKeydown(event) {
    switch (event.key) {
      case 'ArrowLeft':
      case 'Left':
        this.activatePreviousTab();
        event.preventDefault();
        break;
      case 'ArrowRight':
      case 'Right':
        this.activateNextTab();
        event.preventDefault();
        break;
    }
  }
  activateNextTab() {
    const $currentTab = this.getCurrentTab();
    if (!($currentTab != null && $currentTab.parentElement)) {
      return;
