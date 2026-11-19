import { LogManager, TransformRequestManager } from "@maplibre/maplibre-react-native";

type LogHandler = Parameters<typeof LogManager.onLog>[0];

const urlTransformUsers = new Map<string, number>();
const logHandlers: LogHandler[] = [];

export const retainUrlTransform = (id: string) => {
  urlTransformUsers.set(id, (urlTransformUsers.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const users = (urlTransformUsers.get(id) ?? 1) - 1;
    if (users > 0) {
      urlTransformUsers.set(id, users);
      return;
    }
    urlTransformUsers.delete(id);
    TransformRequestManager.removeUrlTransform(id);
  };
};

export const subscribeToMapLibreLogs = (handler: LogHandler) => {
  if (logHandlers.length === 0) {
    LogManager.onLog((log) => logHandlers.at(-1)?.(log) ?? false);
  }
  logHandlers.push(handler);
  return () => {
    const index = logHandlers.lastIndexOf(handler);
    if (index === -1) return;
    logHandlers.splice(index, 1);
    if (logHandlers.length === 0) LogManager.onLog(() => false);
  };
};
