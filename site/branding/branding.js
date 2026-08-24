(function () {
  const BRAND_NAME = 'EverywherePoster';
  const MARKETING_ORIGIN = 'https://everywhereposter.com';
  const BRAND_ASSET_BLACK = '/branding/everywhereposter-icon-black.svg';
  const BRAND_ASSET_WHITE = '/branding/everywhereposter-icon-white.svg';
  const FAVICON_ASSET = '/branding/favicon.svg?v=20260823-3';
  const IMAGE_ASSET_PATHS = [
    '/logo.svg',
    '/logo-text.svg',
    '/postiz.svg',
    '/postiz-text.svg',
    '/no-picture.jpg',
    BRAND_ASSET_BLACK,
    BRAND_ASSET_WHITE,
  ];
  const LOGO_SIGNATURES = [
    {
      viewBox: '0 0 101 33',
      snippet: 'M41.7953 5.76801',
    },
    {
      viewBox: '0 0 60 60',
      snippet: 'M12.8816 11.4648',
    },
  ];
  const LEGAL_BAR_ID = 'publish-everywhere-legal-links';
  const LEGAL_BAR_STYLE_ID = 'publish-everywhere-legal-links-style';

  const textReplacements = [
    ['Postiz To Grow Their Social Presence', 'EverywherePoster To Grow Their Social Presence'],
    ['How to Use Postiz', 'How to Use EverywherePoster'],
    ['Use Postiz', 'Use EverywherePoster'],
    ['Join 10,000+ Entrepreneurs Who Use Postiz', 'Join 10,000+ Entrepreneurs Who Use EverywherePoster'],
    ['watch this short video to learn how to get the most out of Postiz', 'watch this short video to learn how to get the most out of EverywherePoster'],
    ['Watch this short video to learn how to get the most out of Postiz', 'Watch this short video to learn how to get the most out of EverywherePoster'],
    ['Postiz', BRAND_NAME],
  ];

  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);

  function replaceText(value) {
    let next = value;
    for (const [from, to] of textReplacements) {
      next = next.split(from).join(to);
    }
    return next;
  }

  function rewriteText(root) {
    if (!root) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      const parentTag = node.parentElement && node.parentElement.tagName;
      if (
        node.nodeValue &&
        parentTag &&
        !skipTags.has(parentTag) &&
        node.nodeValue.includes('Postiz')
      ) {
        const nextValue = replaceText(node.nodeValue);
        if (nextValue !== node.nodeValue) {
          node.nodeValue = nextValue;
        }
      }

      node = walker.nextNode();
    }
  }

  function rewriteLinks(root) {
    const scope = root && root.querySelectorAll ? root : document;
    for (const link of scope.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (!href) {
        continue;
      }

      if (href.includes('postiz.com/terms')) {
        link.setAttribute('href', `${MARKETING_ORIGIN}/terms`);
        link.setAttribute('rel', 'nofollow');
      }

      if (href.includes('postiz.com/privacy')) {
        link.setAttribute('href', `${MARKETING_ORIGIN}/privacy`);
        link.setAttribute('rel', 'nofollow');
      }

      const title = link.getAttribute('title');
      if (title && title.includes('Postiz')) {
        link.setAttribute('title', replaceText(title));
      }
    }
  }

  function rewriteTitle() {
    if (document.title && document.title.includes('Postiz')) {
      document.title = replaceText(document.title);
    }
  }

  function getBrandAsset() {
    return document.body && document.body.classList.contains('dark')
      ? BRAND_ASSET_WHITE
      : BRAND_ASSET_BLACK;
  }

  function applyFavicon() {
    const links = document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]');
    if (!links.length) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      link.href = FAVICON_ASSET;
      document.head.appendChild(link);
      return;
    }

    for (const link of links) {
      link.setAttribute('href', FAVICON_ASSET);
      link.setAttribute('type', 'image/svg+xml');
      if (!link.getAttribute('rel')) {
        link.setAttribute('rel', 'icon');
      }
    }
  }

  function buildLogoImage(source) {
    const width = source && source.getAttribute('width') ? source.getAttribute('width') : '84';
    const height = source && source.getAttribute('height') ? source.getAttribute('height') : '84';
    const className = source && source.getAttribute('class') ? source.getAttribute('class') : '';
    const img = document.createElement('img');
    img.src = getBrandAsset();
    img.alt = BRAND_NAME;
    img.width = Number(width) || 84;
    img.height = Number(height) || 84;
    img.dataset.publishEverywhereLogo = 'true';
    if (className) {
      img.setAttribute('class', className);
    }
    img.style.display = 'block';
    img.style.width = /^\d+$/.test(width) ? `${width}px` : width;
    img.style.height = /^\d+$/.test(height) ? `${height}px` : height;
    img.style.maxWidth = '100%';
    img.style.objectFit = 'contain';
    return img;
  }

  function matchesAssetPath(value) {
    if (!value) {
      return false;
    }

    try {
      const url = new URL(value, window.location.origin);
      return IMAGE_ASSET_PATHS.includes(url.pathname);
    } catch (_error) {
      return IMAGE_ASSET_PATHS.some(function (path) {
        return value === path || value.endsWith(path);
      });
    }
  }

  function rewriteImages(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const brandAsset = getBrandAsset();
    for (const img of scope.querySelectorAll('img')) {
      const src = img.getAttribute('src') || img.currentSrc || '';
      const srcset = img.getAttribute('srcset') || '';
      const firstSrcsetValue = srcset.split(',')[0].trim().split(/\s+/)[0];

      if (!matchesAssetPath(src) && !matchesAssetPath(firstSrcsetValue)) {
        continue;
      }

      if (img.getAttribute('src') !== brandAsset) {
        img.setAttribute('src', brandAsset);
      }
      if (img.hasAttribute('srcset')) {
        img.removeAttribute('srcset');
      }
      img.setAttribute('alt', BRAND_NAME);
      img.dataset.publishEverywhereLogo = 'true';

      if (!img.style.maxWidth) {
        img.style.maxWidth = '100%';
      }
      img.style.objectFit = 'contain';
    }
  }

  function rewriteLogos(root) {
    const scope = root && root.querySelectorAll ? root : document;
    for (const svg of scope.querySelectorAll('svg')) {
      if (svg.dataset.publishEverywhereLogo === 'true') {
        continue;
      }

      const viewBox = svg.getAttribute('viewBox') || '';
      const inner = svg.innerHTML || '';
      const isKnownLogo = LOGO_SIGNATURES.some(function (signature) {
        return viewBox === signature.viewBox && inner.includes(signature.snippet);
      });
      if (isKnownLogo) {
        const replacement = buildLogoImage(svg);
        svg.replaceWith(replacement);
      }
    }
  }

  function rewriteAttributes(root) {
    const scope = root && root.querySelectorAll ? root : document;
    for (const node of scope.querySelectorAll('[aria-label],[title],[alt]')) {
      for (const attribute of ['aria-label', 'title', 'alt']) {
        const value = node.getAttribute(attribute);
        if (value && value.includes('Postiz')) {
          node.setAttribute(attribute, replaceText(value));
        }
      }
    }
  }

  function ensureLegalBarStyles() {
    if (document.getElementById(LEGAL_BAR_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = LEGAL_BAR_STYLE_ID;
    style.textContent = [
      'body { padding-bottom: max(72px, env(safe-area-inset-bottom)); }',
      '#' + LEGAL_BAR_ID + ' {',
      '  position: fixed;',
      '  left: 50%;',
      '  bottom: max(16px, env(safe-area-inset-bottom));',
      '  transform: translateX(-50%);',
      '  z-index: 2147483647;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 12px;',
      '  padding: 10px 16px;',
      '  border: 1px solid rgba(15, 23, 42, 0.12);',
      '  border-radius: 999px;',
      '  background: rgba(255, 255, 255, 0.94);',
      '  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.12);',
      '  backdrop-filter: blur(12px);',
      '  color: #334155;',
      '  font: 600 13px/1.2 Arial, sans-serif;',
      '  white-space: nowrap;',
      '}',
      '#' + LEGAL_BAR_ID + ' a {',
      '  color: #0f766e;',
      '  text-decoration: none;',
      '}',
      '#' + LEGAL_BAR_ID + ' a:hover,',
      '#' + LEGAL_BAR_ID + ' a:focus-visible {',
      '  text-decoration: underline;',
      '}',
      '#' + LEGAL_BAR_ID + ' .separator {',
      '  color: #94a3b8;',
      '}',
      '@media (max-width: 640px) {',
      '  body { padding-bottom: max(96px, env(safe-area-inset-bottom)); }',
      '  #' + LEGAL_BAR_ID + ' {',
      '    width: calc(100% - 24px);',
      '    justify-content: center;',
      '    padding: 12px 14px;',
      '    white-space: normal;',
      '    text-align: center;',
      '  }',
      '}',
    ].join('');
    document.head.appendChild(style);
  }

  function ensureLegalBar() {
    ensureLegalBarStyles();

    let bar = document.getElementById(LEGAL_BAR_ID);
    if (!bar) {
      bar = document.createElement('nav');
      bar.id = LEGAL_BAR_ID;
      bar.setAttribute('aria-label', 'Legal');
      bar.innerHTML = [
        '<a href="' + MARKETING_ORIGIN + '/terms" rel="nofollow">Terms of Service</a>',
        '<span class="separator" aria-hidden="true">|</span>',
        '<a href="' + MARKETING_ORIGIN + '/privacy" rel="nofollow">Privacy Policy</a>',
      ].join('');
    }

    if (document.body && bar.parentElement !== document.body) {
      document.body.appendChild(bar);
    }
  }

  function applyBranding(root) {
    rewriteTitle();
    applyFavicon();
    rewriteText(root || document.body || document.documentElement);
    rewriteLinks(root || document);
    rewriteAttributes(root || document);
    rewriteImages(root || document);
    rewriteLogos(root || document);
  }

  let scheduled = false;
  function scheduleBranding() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      applyBranding(document.body || document.documentElement);
    });
  }

  applyBranding(document.body || document.documentElement);

  const observer = new MutationObserver(function () {
    scheduleBranding();
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'src', 'srcset'],
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener('popstate', scheduleBranding);
  window.addEventListener('pageshow', scheduleBranding);
})();
