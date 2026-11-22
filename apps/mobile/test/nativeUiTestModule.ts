import React, { type ReactNode } from "react";

const hostComponent = (name: string) => {
  const component = ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement(name, props, children);
  return Object.assign(component, {
    Label: component,
    Icon: component,
    Badge: component,
    Trigger: component,
    Items: component,
    Preview: component,
    Thumb: component,
    Track: component,
  });
};

export const createNativeUiTestModule = (prefix: string) =>
  new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name !== "string" || name === "then") return undefined;
        if (name === "__esModule") return true;
        if (/^[A-Z]/.test(name)) return hostComponent(`${prefix}-${name}`);
        return (...args: unknown[]) => ({ modifier: name, args });
      },
    },
  );
