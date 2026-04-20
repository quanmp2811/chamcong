document.addEventListener('DOMContentLoaded', () => {
  const loginPage = 'login.html';
  const homePage = 'index.html';
  
  const getAuthState = () => {
    const token = sessionStorage.getItem('token');
    let user = null;
    try {
      user = JSON.parse(sessionStorage.getItem('user'));
    } catch (e) {
      user = null;
    }
    return token && user && typeof user.email === 'string' && user.email.trim() ? user : null;
  };
  
  const setAuthState = (value) => {
    if (!value) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
    }
  };

  const user = getAuthState();
  // Removed redirect to login for view-only access
  console.log('User:', user); // Debug log

  const currentPage = window.location.pathname.split('/').pop();
  const configPages = ['cau-hinh.html', 'nguoi-dung.html'];
  if (configPages.includes(currentPage) && user.role !== 'admin') {
    window.location.replace(homePage);
    return;
  }

  if (!user || user.role !== 'admin') {
    document.querySelectorAll('nav.main-nav a[href="cau-hinh.html"]').forEach((link) => {
      link.style.display = 'none';
    });
    document.querySelectorAll('.config-sidebar .config-nav-item').forEach((link) => {
      link.style.display = 'none';
    });
  }

  if (!user) {
    // Ẩn sidebar nếu chưa đăng nhập
    const sidebar = document.querySelector('.sidebar.app-sidepanel');
    if (sidebar) sidebar.style.display = 'none';

    // Ẩn bảng lịch chỉnh sửa nếu chưa đăng nhập
    const scheduleEditor = document.querySelector('.schedule-editor');
    if (scheduleEditor) scheduleEditor.style.display = 'none';
  }

  initializeRealtime();

  // Hiển thị user info chỉ nếu đã đăng nhập
  const userInfoDiv = document.getElementById('user-info');
  const userNameSpan = document.getElementById('user-name');
  const userRoleSpan = document.getElementById('user-role');
  const logoutButton = document.getElementById('logout-button');

  const loginButton = document.getElementById('login-button');
  if (loginButton) {
    if (!user) {
      loginButton.style.display = 'block';
      loginButton.addEventListener('click', () => {
        window.location.replace(loginPage);
      });
    } else {
      loginButton.style.display = 'none';
    }
  }

  if (user && userInfoDiv && userNameSpan && userRoleSpan && logoutButton) {
    userNameSpan.textContent = user.name || user.email;
    
    // Hiển thị vai trò; admin không kèm đơn vị
    if (user.role === 'admin') {
      userRoleSpan.textContent = 'Admin';
    } else {
      const unitLabel = user.store_code ? user.store_code : 'Chưa có đơn vị';
      userRoleSpan.textContent = `Quản lý · ${unitLabel}`;
    }
    
    userInfoDiv.style.display = 'block';
    
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      setAuthState(false);
      window.location.replace(loginPage);
    });
  }
});

function initializeRealtime() {
  if (!('WebSocket' in window) || window.attendanceSocket) {
    return;
  }

  const apiOrigin = window.APP_API_ORIGIN
    || (window.location.protocol === 'file:'
      ? 'http://localhost:3001'
      : window.location.origin);
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
      alert('🔔 Có người bấm chuông!');
    }
  });
}
