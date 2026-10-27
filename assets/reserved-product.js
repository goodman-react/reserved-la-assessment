(() => {
  if (customElements.get('reserved-product')) return;

  const DESKTOP_QUERY = '(min-width: 990px)';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const scrollBehavior = () => (reducedMotion.matches ? 'auto' : 'smooth');

  function formatMoney(cents, format = '${{amount}}') {
    const placeholder = /\{\{\s*(\w+)\s*\}\}/;
    const toAmount = (precision, thousands = ',', decimal = '.') => {
      const [whole, fraction] = (Number(cents) / 100).toFixed(precision).split('.');
      const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return fraction ? `${grouped}${decimal}${fraction}` : grouped;
    };

    const formatters = {
      amount: () => toAmount(2),
      amount_no_decimals: () => toAmount(0),
      amount_with_comma_separator: () => toAmount(2, '.', ','),
      amount_no_decimals_with_comma_separator: () => toAmount(0, '.', ','),
      amount_with_apostrophe_separator: () => toAmount(2, "'", '.'),
      amount_with_space_separator: () => toAmount(2, ' ', ','),
      amount_no_decimals_with_space_separator: () => toAmount(0, ' ', ','),
    };

    const key = (format.match(placeholder) || [])[1];
    const html = format.replace(placeholder, (formatters[key] || formatters.amount)());

    // money_format can contain HTML/entities set by the merchant; decode to plain text.
    const decoder = document.createElement('div');
    decoder.innerHTML = html;
    return decoder.textContent;
  }

  class ReservedGallery {
    constructor(root) {
      this.root = root;
      this.track = root.querySelector('[data-gallery-track]');
      this.thumbList = root.querySelector('[data-gallery-thumbs]');
      this.thumbs = [...root.querySelectorAll('[data-thumb]')];
      this.counter = root.querySelector('[data-gallery-current]');
      this.isGrid = root.dataset.layout === 'grid';
      this.desktop = window.matchMedia(DESKTOP_QUERY);
      this.index = Math.max(this.slides.findIndex((slide) => slide.classList.contains('is-active')), 0);
      this.ticking = false;

      this.track.addEventListener('scroll', this.onScroll, { passive: true });
      this.thumbs.forEach((thumb) => thumb.addEventListener('click', () => this.goToMedia(thumb.dataset.mediaId)));
      root.querySelector('[data-gallery-prev]')?.addEventListener('click', () => this.goToIndex(this.index - 1));
      root.querySelector('[data-gallery-next]')?.addEventListener('click', () => this.goToIndex(this.index + 1));
      root.addEventListener('keydown', this.onKeydown);

      if (root.dataset.zoom === 'true') this.initZoom();
      this.initModels();
      this.connect();
    }

    get slides() {
      return [...this.track.children];
    }

    get isSlider() {
      return !(this.isGrid && this.desktop.matches);
    }

    connect() {
      this.desktop.addEventListener('change', this.sync);
      this.sync();
    }

    disconnect() {
      this.desktop.removeEventListener('change', this.sync);
    }

    sync = () => {
      this.promote(this.isSlider ? null : this.slides[this.index]);
      if (this.isSlider) this.scrollToIndex(this.index, 'auto');
      this.setActive(this.index);
    };

    onScroll = () => {
      if (this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => {
        this.ticking = false;
        if (!this.isSlider || !this.track.clientWidth) return;
        const index = Math.round(this.track.scrollLeft / this.track.clientWidth);
        if (index !== this.index && this.slides[index]) this.setActive(index);
      });
    };

    onKeydown = (event) => {
      if (event.target.closest('video, iframe, model-viewer, input, select, textarea')) return;
      if (event.key === 'ArrowLeft') this.goToIndex(this.index - 1);
      if (event.key === 'ArrowRight') this.goToIndex(this.index + 1);
    };

    goToMedia(mediaId) {
      const index = this.slides.findIndex((slide) => slide.dataset.mediaId === String(mediaId));
      if (index < 0) return;
      if (this.isSlider) {
        this.goToIndex(index);
      } else {
        this.promote(this.slides[index]);
        this.setActive(index);
      }
    }

    goToIndex(index, behavior = scrollBehavior()) {
      const count = this.slides.length;
      if (!count || !this.isSlider) return;
      const target = (index + count) % count;
      this.scrollToIndex(target, behavior);
      this.setActive(target);
    }

    scrollToIndex(index, behavior) {
      const slide = this.slides[index];
      if (slide) this.track.scrollTo({ left: slide.offsetLeft, behavior });
    }

    // Grid layout shows the selected media first via CSS order, so DOM order (and slide labels) never change.
    promote(slide) {
      this.slides.forEach((item) => item.style.removeProperty('order'));
      if (slide) slide.style.order = '-1';
    }

    setActive(index) {
      this.index = index;
      const slides = this.slides;
      slides.forEach((slide, i) => {
        const active = i === index;
        slide.classList.toggle('is-active', active);
        if (!active) this.pauseMedia(slide);
      });

      const activeId = slides[index]?.dataset.mediaId;
      this.thumbs.forEach((thumb) => {
        const active = thumb.dataset.mediaId === activeId;
        thumb.classList.toggle('is-active', active);
        thumb.setAttribute('aria-current', String(active));
        if (active) this.revealThumb(thumb);
      });

      if (this.counter) this.counter.textContent = String(index + 1);
    }

    pauseMedia(slide) {
      slide.querySelectorAll('video').forEach((video) => video.pause());
      slide.querySelectorAll('iframe').forEach((iframe) => {
        const src = iframe.src || '';
        if (src.includes('youtube')) {
          iframe.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
        } else if (src.includes('vimeo')) {
          iframe.contentWindow?.postMessage('{"method":"pause"}', '*');
        }
      });
    }

    revealThumb(thumb) {
      const list = this.thumbList;
      if (!list) return;
      // Scroll only the thumbnail strip; scrollIntoView would also move the page.
      list.scrollTo({
        top: thumb.offsetTop - list.clientHeight / 2 + thumb.offsetHeight / 2,
        left: thumb.offsetLeft - list.clientWidth / 2 + thumb.offsetWidth / 2,
        behavior: scrollBehavior(),
      });
    }

    initZoom() {
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      this.root.querySelectorAll('.rp-gallery__media--image').forEach((media) => {
        media.addEventListener('mousemove', (event) => {
          if (!this.desktop.matches) return;
          const rect = media.getBoundingClientRect();
          media.style.setProperty('--zoom-x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
          media.style.setProperty('--zoom-y', `${((event.clientY - rect.top) / rect.height) * 100}%`);
          media.classList.add('is-zoomed');
        });
        media.addEventListener('mouseleave', () => media.classList.remove('is-zoomed'));
      });
    }

    initModels() {
      const models = this.root.querySelectorAll('model-viewer');
      if (!models.length || !window.Shopify?.loadFeatures) return;
      window.Shopify.loadFeatures([
        {
          name: 'model-viewer-ui',
          version: '1.0',
          onLoad: (error) => {
            if (error || !window.Shopify.ModelViewerUI) return;
            models.forEach((model) => new window.Shopify.ModelViewerUI(model));
          },
        },
      ]);
    }
  }

  class ReservedProduct extends HTMLElement {
    connectedCallback() {
      if (this.initialized) {
        this.attachGlobalListeners();
        return;
      }

      const dataElement = this.querySelector('[data-product-json]');
      if (!dataElement) return;
      this.initialized = true;

      const data = JSON.parse(dataElement.textContent);
      this.variants = data.variants;
      this.moneyFormat = data.moneyFormat;

      this.form = this.querySelector('[data-product-form]');
      this.idInput = this.querySelector('[data-variant-id-input]');
      this.addButtons = [...this.querySelectorAll('[data-add-button], [data-sticky-button]')];
      this.errorElement = this.querySelector('[data-error]');
      this.successContent = this.querySelector('[data-success-content]');
      this.quantityInput = this.querySelector('[data-qty-input]');
      this.quantityMinus = this.querySelector('[data-qty-minus]');
      this.quantityPlus = this.querySelector('[data-qty-plus]');
      this.hasOptionInputs = Boolean(this.querySelector('[data-option-index]'));

      this.currentVariant =
        this.variants.find((variant) => String(variant.id) === this.idInput?.value) ||
        this.findVariant(this.getSelectedOptions()) ||
        this.variants[0];

      this.initSwatches();

      const galleryRoot = this.querySelector('[data-gallery]');
      if (galleryRoot) this.gallery = new ReservedGallery(galleryRoot);

      this.addEventListener('change', this.onChange);
      this.addEventListener('click', this.onClick);
      this.form?.addEventListener('submit', this.onSubmit);

      // Browsers can restore radio selections from history while the server-rendered price is stale.
      if (this.hasOptionInputs && this.findVariant(this.getSelectedOptions()) !== this.currentVariant) {
        this.onOptionChange();
      } else {
        this.updateOptionAvailability();
      }
      this.updateQuantityButtons();
      this.attachGlobalListeners(false);
    }

    disconnectedCallback() {
      this.stickyObserver?.disconnect();
      this.gallery?.disconnect();
      document.removeEventListener('shopify:block:select', this.onBlockSelect);
    }

    // The theme editor detaches and re-inserts sections; restore what disconnectedCallback removed.
    attachGlobalListeners(reconnecting = true) {
      if (reconnecting) this.gallery?.connect();
      document.addEventListener('shopify:block:select', this.onBlockSelect);
      this.initStickyBar();
    }

    // Without Shopify swatch data the color name is used as a CSS color; names that
    // aren't valid colors (e.g. "Oatmeal") fall back to a text button.
    initSwatches() {
      this.querySelectorAll('[data-swatch-name]').forEach((swatch) => {
        if (window.CSS?.supports?.('color', swatch.dataset.swatchName)) return;
        swatch.closest('.rp__option-btn')?.classList.add('rp__option-btn--text');
      });
    }

    /* ---------- Variants ---------- */

    getSelectedOptions() {
      const selected = [];
      this.querySelectorAll('[data-option-index]').forEach((element) => {
        if (element.type === 'radio' && !element.checked) return;
        selected[Number(element.dataset.optionIndex)] = element.value;
      });
      return selected;
    }

    findVariant(selected) {
      return this.variants.find((variant) => variant.options.every((value, i) => value === selected[i]));
    }

    onChange = (event) => {
      if (event.target.matches('[data-option-index]')) this.onOptionChange();
      if (event.target === this.quantityInput) this.normalizeQuantity();
    };

    onOptionChange() {
      const selected = this.getSelectedOptions();
      this.querySelectorAll('[data-selected-value]').forEach((element) => {
        element.textContent = selected[Number(element.dataset.selectedValue)] || '';
      });

      this.currentVariant = this.findVariant(selected) || null;
      this.updateOptionAvailability(selected);
      this.renderVariant(this.currentVariant);
    }

    updateOptionAvailability(selected = this.getSelectedOptions()) {
      const isAvailable = (index, value) =>
        this.variants.some(
          (variant) =>
            variant.available &&
            variant.options[index] === value &&
            variant.options.every((optionValue, j) => j === index || optionValue === selected[j])
        );

      this.querySelectorAll('[data-option-index]').forEach((element) => {
        const index = Number(element.dataset.optionIndex);
        if (element.tagName === 'SELECT') {
          [...element.options].forEach((option) => {
            option.textContent = isAvailable(index, option.value)
              ? option.value
              : `${option.value} - ${this.dataset.soldOutText}`;
          });
          return;
        }

        const unavailable = !isAvailable(index, element.value);
        const label = element.nextElementSibling;
        label?.classList.toggle('is-unavailable', unavailable);
        const srLabel = label?.querySelector('[data-unavailable-label]');
        if (srLabel) srLabel.hidden = !unavailable;
      });
    }

    renderVariant(variant) {
      const available = Boolean(variant?.available);

      if (this.idInput) {
        this.idInput.value = variant ? variant.id : '';
        this.idInput.disabled = !variant;
        this.idInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      this.addButtons.forEach((button) => {
        button.disabled = !available;
        const label = button.querySelector('[data-add-text]') || button;
        if (!variant) label.textContent = this.dataset.unavailableText;
        else label.textContent = available ? this.dataset.addText : this.dataset.soldOutText;
      });

      this.querySelectorAll('[data-btn-price]').forEach((element) => {
        element.hidden = !available;
      });
      this.querySelectorAll('[data-sticky-variant]').forEach((element) => {
        element.textContent = variant ? variant.title : this.dataset.unavailableText;
      });

      this.renderPrice(variant);
      this.hideMessages();
      this.querySelector('pickup-availability')?.update?.(variant);

      if (!variant) return;

      this.applyQuantityRule(variant.quantity_rule);

      if (this.dataset.updateUrl === 'true') {
        const url = new URL(window.location.href);
        url.searchParams.set('variant', variant.id);
        window.history.replaceState(window.history.state, '', url);
      }

      if (variant.featured_media) this.gallery?.goToMedia(variant.featured_media.id);

      this.dispatchEvent(new CustomEvent('reserved:variant-change', { bubbles: true, detail: { variant } }));
    }

    renderPrice(variant) {
      const onSale = Boolean(variant && variant.compare_at_price > variant.price);
      const toggle = (selector, hidden) => {
        this.querySelectorAll(selector).forEach((element) => {
          element.hidden = hidden;
        });
      };

      this.querySelectorAll('[data-price]').forEach((element) => {
        element.hidden = !variant;
        if (!variant) return;
        element.textContent = formatMoney(variant.price, this.moneyFormat);
        element.classList.toggle('is-sale', onSale);
      });
      this.querySelectorAll('[data-compare-price]').forEach((element) => {
        element.textContent = onSale ? formatMoney(variant.compare_at_price, this.moneyFormat) : '';
      });

      toggle('[data-price-unavailable]', Boolean(variant));
      toggle('[data-compare-wrap], [data-sale-label]', !onSale);
      toggle('[data-soldout-badge]', !variant || variant.available);

      this.querySelectorAll('[data-sale-badge]').forEach((badge) => {
        badge.hidden = !onSale;
        if (!onSale) return;
        const percent = Math.round(((variant.compare_at_price - variant.price) * 100) / variant.compare_at_price);
        badge.textContent = badge.dataset.badgeStyle === 'percent' ? `-${percent}%` : badge.dataset.badgeText;
      });

      const measurement = variant?.unit_price_measurement;
      this.querySelectorAll('[data-unit-price]').forEach((element) => {
        element.hidden = !measurement;
        if (!measurement) return;
        const amount = element.querySelector('[data-unit-price-amount]');
        const base = element.querySelector('[data-unit-price-base]');
        if (amount) amount.textContent = formatMoney(variant.unit_price, this.moneyFormat);
        if (base) {
          const value = measurement.reference_value === 1 ? '' : measurement.reference_value;
          base.textContent = `${value}${measurement.reference_unit}`;
        }
      });
    }

    /* ---------- Quantity ---------- */

    getQuantityBounds() {
      const input = this.quantityInput;
      return {
        min: parseInt(input.min, 10) || 1,
        max: parseInt(input.max, 10) || Infinity,
        step: parseInt(input.step, 10) || 1,
      };
    }

    onClick = (event) => {
      const button = event.target.closest('[data-qty-minus], [data-qty-plus]');
      if (!button || !this.quantityInput) return;
      const { min, step } = this.getQuantityBounds();
      const direction = button === this.quantityPlus ? 1 : -1;
      this.quantityInput.value = (parseInt(this.quantityInput.value, 10) || min) + direction * step;
      this.normalizeQuantity();
      this.quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    normalizeQuantity() {
      const input = this.quantityInput;
      if (!input) return;
      const { min, max, step } = this.getQuantityBounds();
      let value = parseInt(input.value, 10);
      if (Number.isNaN(value) || value < min) value = min;
      if (value > max) value = max;
      value -= (value - min) % step;
      input.value = value;
      this.updateQuantityButtons();
    }

    applyQuantityRule(rule) {
      const input = this.quantityInput;
      if (!input || !rule) return;
      input.min = rule.min || 1;
      input.step = rule.increment || 1;
      if (rule.max) input.max = rule.max;
      else input.removeAttribute('max');
      this.normalizeQuantity();
    }

    updateQuantityButtons() {
      if (!this.quantityInput) return;
      const { min, max } = this.getQuantityBounds();
      const value = parseInt(this.quantityInput.value, 10) || min;
      if (this.quantityMinus) this.quantityMinus.disabled = value <= min;
      if (this.quantityPlus) this.quantityPlus.disabled = value >= max;
    }

    /* ---------- Cart ---------- */

    onSubmit = async (event) => {
      event.preventDefault();
      if (this.isSubmitting || !this.currentVariant?.available || this.idInput?.disabled) return;

      this.setLoading(true);
      this.hideMessages();

      // Dawn exposes <cart-drawer> or <cart-notification>; reuse it when present.
      const cartUI = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
      const canRenderCart = typeof cartUI?.renderContents === 'function';
      const canPublish = typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined';
      const variantId = this.currentVariant.id;

      const formData = new FormData(this.form);
      if (canRenderCart) {
        formData.append('sections', cartUI.getSectionsToRender().map((section) => section.id));
        formData.append('sections_url', window.location.pathname);
        cartUI.setActiveElement?.(document.activeElement);
      } else {
        formData.append('sections', 'cart-icon-bubble');
      }

      try {
        const response = await fetch(`${this.dataset.cartAddUrl}.js`, {
          method: 'POST',
          headers: { Accept: 'application/javascript', 'X-Requested-With': 'XMLHttpRequest' },
          body: formData,
        });
        const result = await response.json().catch(() => null);

        if (!response.ok || !result || result.status) {
          this.showError(result?.description || result?.message || this.dataset.cartErrorText);
          if (canPublish) {
            publish(PUB_SUB_EVENTS.cartError, {
              source: 'reserved-product',
              productVariantId: variantId,
              errors: result?.errors || result?.description,
              message: result?.message,
            });
          }
          return;
        }

        if (canRenderCart) {
          cartUI.classList.remove('is-empty');
          cartUI.renderContents(result);
        } else {
          this.updateCartIcon(result.sections?.['cart-icon-bubble']);
          if (this.successContent) this.successContent.hidden = false;
        }

        if (canPublish) {
          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'reserved-product', productVariantId: variantId, cartData: result });
        }
        document.dispatchEvent(new CustomEvent('reserved:cart-added', { detail: result }));
      } catch {
        this.showError(this.dataset.cartErrorText);
      } finally {
        this.setLoading(false);
      }
    };

    updateCartIcon(html) {
      const bubble = document.getElementById('cart-icon-bubble');
      if (!html || !bubble) return;
      const markup = new DOMParser().parseFromString(html, 'text/html').querySelector('.shopify-section');
      if (markup) bubble.innerHTML = markup.innerHTML;
    }

    setLoading(loading) {
      this.isSubmitting = loading;
      this.addButtons.forEach((button) => {
        button.classList.toggle('is-loading', loading);
        button.setAttribute('aria-busy', String(loading));
        button.disabled = loading || !this.currentVariant?.available;
      });
    }

    // Message containers stay in the DOM so screen readers reliably announce text changes.
    showError(message) {
      if (this.errorElement) this.errorElement.textContent = message;
    }

    hideMessages() {
      if (this.errorElement) this.errorElement.textContent = '';
      if (this.successContent) this.successContent.hidden = true;
    }

    /* ---------- Sticky bar ---------- */

    initStickyBar() {
      const bar = this.querySelector('[data-sticky-bar]');
      const mainButton = this.querySelector('[data-add-button]');
      if (!bar || !mainButton || !('IntersectionObserver' in window)) return;

      this.stickyObserver = new IntersectionObserver(([entry]) => {
        const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        bar.classList.toggle('is-visible', show);
        bar.inert = !show;
        bar.setAttribute('aria-hidden', String(!show));
      });
      this.stickyObserver.observe(mainButton);
    }

    /* ---------- Theme editor ---------- */

    onBlockSelect = (event) => {
      if (event.detail?.sectionId !== this.dataset.sectionId) return;
      if (event.target instanceof HTMLDetailsElement) event.target.open = true;
    };
  }

  customElements.define('reserved-product', ReservedProduct);
})();
