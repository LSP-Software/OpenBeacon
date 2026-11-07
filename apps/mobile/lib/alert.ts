import type { AlertButton, AlertOptions } from "react-native";

let alerts: {
  title: string;
  message: string | undefined;
  buttons: AlertButton[];
  options: AlertOptions | undefined;
}[] = [];
const listeners = new Set<() => void>();
const notify = () =>
  listeners.forEach((listener) => {
    listener();
  });
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getSnapshot = () => alerts;

export const Alert = {
  alert: (title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) => {
    alerts = [
      ...alerts,
      { title, message, buttons: buttons?.length ? buttons : [{ text: "OK" }], options },
    ];
    notify();
  },
};

export const dismissAlert = () => {
  alerts = alerts.slice(1);
  notify();
};
