document.addEventListener('DOMContentLoaded', () => {
  const authButton = document.getElementById('auth-button');
  const storageKey = 'pelaxyAuthState';
  const loginPage = 'login.html';
  const homePage = 'index.html';
  const getAuthState = () => sessionStorage.getItem(storageKey) === 'loggedIn';
  const setAuthState = (value) => sessionStorage.setItem(storageKey, value ? 'loggedIn' : 'loggedOut');

  if (!getAuthState()) {
    window.location.replace(loginPage);
    return;
  }

  if (!authButton) return;

  const updateButton = () => {
    authButton.textContent = getAuthState() ? 'Đăng xuất' : 'Đăng nhập Google';
  };

  authButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (getAuthState()) {
      setAuthState(false);
      window.location.replace(loginPage);
      return;
    }

    window.location.href = homePage;
  });

  updateButton();
});

function initializeRealtime() {
  if (!('WebSocket' in window) || window.attendanceSocket) {
    return;
  }

  const apiOrigin = window.APP_API_ORIGIN
    || (window.location.port === '3000'
      ? window.location.origin
      : (!/^https?:$/.test(window.location.protocol)
        ? 'http://localhost:3001'
        : `${window.location.protocol}//${window.location.hostname || 'localhost'}:3001`));
  const socketUrl = `${apiOrigin.replace(/^http/, 'ws')}/ws`;
  let socket = null;
  let reconnectTimer = null;
  let manuallyClosed = false;

  const dispatchStatus = (status) => {
    window.dispatchEvent(
      new CustomEvent('attendance:ws-status', {
        detail: {
          status,
          url: socketUrl
        }
      })
    );
  };

  const connect = () => {
    dispatchStatus('connecting');
    socket = new WebSocket(socketUrl);

    socket.addEventListener('open', () => {
      dispatchStatus('connected');
      socket.send(
        JSON.stringify({
          type: 'system:hello',
          payload: {
            page: window.location.pathname
          }
        })
      );
    });

    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        window.dispatchEvent(
          new CustomEvent('attendance:ws-message', {
            detail: message
          })
        );
      } catch (error) {
        console.error('WebSocket message parse error:', error);
      }
    });

    socket.addEventListener('close', () => {
      dispatchStatus('disconnected');

      if (!manuallyClosed) {
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    });

    socket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
    });
  };

  connect();

  window.attendanceSocket = {
    close() {
      manuallyClosed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (socket) {
        socket.close();
      }
    },
    send(type, payload = {}) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }

      socket.send(JSON.stringify({ type, payload }));
      return true;
    }
  };

  // Handle logout signal from server
  window.addEventListener('attendance:ws-message', (event) => {
    const message = event.detail;

    if (message.type === 'auth:logout') {
      const currentUser = JSON.parse(sessionStorage.getItem('user') || 'null');
      if (currentUser && message.payload.email === currentUser.email) {
        alert('Tài khoản của bạn đã bị xóa. Bạn sẽ được đăng xuất.');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        window.location.replace(loginPage);
      }
      return;
    }

    if (message.type === 'ring') {
      alert('Có khách hàng nhấn chuông!');
    }
  });
}

initializeRealtime();
