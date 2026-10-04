import type { Step, Target } from "../schema.js";

export function describeTarget(t: Target): string {
  switch (t.by) {
    case "role": return t.name ? `the ${t.role} "${t.name}"` : `the ${t.role}`;
    case "label": return `the field labelled "${t.value}"`;
    case "text": return `the element with text "${t.value}"`;
    case "placeholder": return `the field with placeholder "${t.value}"`;
    case "testId": return `[data-testid=${t.value}]`;
    case "css": return `\`${t.value}\``;
  }
}

export function describeStep(s: Step): string {
  switch (s.action) {
    case "goto": return `Go to \`${s.url}\``;
    case "click": return `Click ${describeTarget(s.target)}${s.count && s.count > 1 ? ` ×${s.count}` : ""}`;
    case "fill": return `Type "${s.value}" into ${describeTarget(s.target)}`;
    case "select": return `Select "${s.value}" in ${describeTarget(s.target)}`;
    case "check": return `Check ${describeTarget(s.target)}`;
    case "uncheck": return `Uncheck ${describeTarget(s.target)}`;
    case "hover": return `Hover ${describeTarget(s.target)}`;
    case "press": return `Press ${s.key}${s.target ? ` in ${describeTarget(s.target)}` : ""}`;
    case "wait": return `Wait ${s.ms} ms`;
    case "reload": return "Reload the page";
    case "back": return "Go back";
    case "forward": return "Go forward";
    case "setOffline": return s.offline ? "Go offline" : "Go back online";
    case "setViewport": return `Resize viewport to ${s.width}x${s.height}`;
    case "http": return `Send \`${s.method} ${s.url}\``;
  }
}
