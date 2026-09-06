const BASE_PATH = self.registration.scope;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "BAPS Rajkot",
      message: event.data ? event.data.text() : "New notification",
    };
  }

  const title = data.title || "BAPS Rajkot";

  const options = {
    body: data.message || data.body || "You have a new notification.",
    icon: data.icon || `${BASE_PATH}icon-192.png`,
    badge: data.badge || `${BASE_PATH}icon-192.png`,
    tag: data.id
      ? `notification-${data.id}`
      : "baps-notification",
    renotify: true,
    requireInteraction: false,

    data: {
      url: data.url || BASE_PATH,
      notificationId: data.id || data.notificationId || null,
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url =
    event.notification?.data?.url ||
    self.registration.scope;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
