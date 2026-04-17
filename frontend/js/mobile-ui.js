document.addEventListener('DOMContentLoaded', () => {
  const storageKey = 'pelaxyAuthState';
  const getAuthState = () => sessionStorage.getItem(storageKey) === 'loggedIn';
  const setAuthState = (value) => sessionStorage.setItem(storageKey, value ? 'loggedIn' : 'loggedOut');

  const updateAuthButtons = () => {
    document.querySelectorAll('[data-auth-toggle="true"]').forEach((button) => {
      button.textContent = getAuthState() ? 'Dang xuat' : 'Dang nhap';
    });
  };

  const bindAuthButton = (button) => {
    if (!button || button.dataset.authBound === 'true') {
      return;
    }

    button.dataset.authToggle = 'true';
    button.dataset.authBound = 'true';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      setAuthState(!getAuthState());
      updateAuthButtons();
    });
  };

  bindAuthButton(document.getElementById('auth-button'));
  setupMobileNavigation(bindAuthButton);
  updateAuthButtons();
});

function setupMobileNavigation(bindAuthButton) {
  const body = document.body;
  const headerInner = document.querySelector('.header-inner');
  const mainNav = document.querySelector('.main-nav');
  const sidePanel = document.querySelector('.report-sidebar, .config-sidebar, .sidebar');
  const desktopAuthButton = document.getElementById('auth-button');

  if (!headerInner || (!mainNav && !sidePanel)) {
    return;
  }

  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'mobile-toggle-group';

  const overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.className = 'mobile-overlay';
  overlay.setAttribute('aria-label', 'Dong dieu huong');
  overlay.hidden = true;
  body.appendChild(overlay);

  let navToggle = null;
  let sidebarToggle = null;

  const syncOverlayState = () => {
    const hasOpenPanel = body.classList.contains('is-nav-open') || body.classList.contains('is-sidebar-open');
    overlay.hidden = !hasOpenPanel;
    body.classList.toggle('mobile-overlay-open', hasOpenPanel);
  };

  const closePanels = () => {
    body.classList.remove('is-nav-open', 'is-sidebar-open');
    if (navToggle) {
      navToggle.setAttribute('aria-expanded', 'false');
    }
    if (sidebarToggle) {
      sidebarToggle.setAttribute('aria-expanded', 'false');
    }
    syncOverlayState();
  };

  if (mainNav) {
    navToggle = document.createElement('button');
    navToggle.type = 'button';
    navToggle.className = 'mobile-toggle mobile-nav-toggle';
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Mo menu chinh');
    navToggle.innerHTML = '<span class="mobile-toggle-icon">|||</span><span class="mobile-toggle-label">Menu</span>';
    navToggle.addEventListener('click', () => {
      const willOpen = !body.classList.contains('is-nav-open');
      body.classList.toggle('is-nav-open', willOpen);
      body.classList.remove('is-sidebar-open');
      navToggle.setAttribute('aria-expanded', String(willOpen));
      if (sidebarToggle) {
        sidebarToggle.setAttribute('aria-expanded', 'false');
      }
      syncOverlayState();
    });
    toggleGroup.appendChild(navToggle);

    if (desktopAuthButton && !mainNav.querySelector('.mobile-nav-auth')) {
      const mobileAuthButton = desktopAuthButton.cloneNode(true);
      mobileAuthButton.removeAttribute('id');
      mobileAuthButton.classList.add('mobile-nav-auth');
      bindAuthButton(mobileAuthButton);
      mainNav.appendChild(mobileAuthButton);
    }

    mainNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        closePanels();
      });
    });
  }

  if (sidePanel) {
    sidebarToggle = document.createElement('button');
    sidebarToggle.type = 'button';
    sidebarToggle.className = 'mobile-toggle mobile-sidebar-toggle';
    sidebarToggle.setAttribute('aria-expanded', 'false');
    sidebarToggle.setAttribute('aria-label', 'Mo thanh ben');
    sidebarToggle.innerHTML = '<span class="mobile-toggle-icon">[]</span><span class="mobile-toggle-label">Muc</span>';
    sidebarToggle.addEventListener('click', () => {
      const willOpen = !body.classList.contains('is-sidebar-open');
      body.classList.toggle('is-sidebar-open', willOpen);
      body.classList.remove('is-nav-open');
      sidebarToggle.setAttribute('aria-expanded', String(willOpen));
      if (navToggle) {
        navToggle.setAttribute('aria-expanded', 'false');
      }
      syncOverlayState();
    });
    toggleGroup.appendChild(sidebarToggle);
  }

  if (toggleGroup.childElementCount) {
    headerInner.insertBefore(toggleGroup, desktopAuthButton || mainNav || headerInner.lastElementChild);
  }

  overlay.addEventListener('click', closePanels);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePanels();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) {
      closePanels();
    }
  });
}
