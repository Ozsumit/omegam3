import { useState, useEffect, useRef, useCallback } from "react";

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const unreadCountRef = useRef(0);
  const originalTitleRef = useRef(typeof document !== "undefined" ? document.title : "");
  const notificationSoundRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }
    if (typeof Audio !== "undefined") {
      notificationSoundRef.current = new Audio("/sounds/notification.mp3");
      notificationSoundRef.current.load();
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && unreadCountRef.current > 0) {
        unreadCountRef.current = 0;
        document.title = originalTitleRef.current;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const requestPermission = useCallback(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then(setPermission);
    }
  }, []);

  const showNotification = useCallback(
    (title: string, options: NotificationOptions) => {
      if (document.hidden && permission === "granted") {
        const notification = new Notification(title, {
          ...options,
          icon: "/favicon.ico",
          badge: "/favicon.ico",
        });
        notification.onclick = () => window.focus();
      }
    },
    [permission]
  );

  const playSoundNotification = useCallback(() => {
    if (notificationSoundRef.current) {
      const sound = notificationSoundRef.current.cloneNode() as HTMLAudioElement;
      sound.play().catch((error) => console.warn("Failed to play notification sound:", error));
    }
  }, []);

  const updateTabTitle = useCallback((peerName: string | null) => {
    if (document.hidden) {
      unreadCountRef.current += 1;
      if (peerName) {
        document.title = `(${unreadCountRef.current}) Message from ${peerName}`;
      } else {
        document.title = `(${unreadCountRef.current}) New Messages`;
      }
    } else {
      unreadCountRef.current = 0;
      document.title = originalTitleRef.current;
    }
  }, []);

  return {
    requestPermission,
    showNotification,
    playSoundNotification,
    updateTabTitle,
  };
}
