import { els } from "./app-state.js";

export function panel(title, children) {
  return el("section", { className: "panel" }, [
    el("div", { className: "panel-header" }, [el("h3", {}, title)]),
    el("div", { className: "panel-body stack" }, children),
  ]);
}

export function sectionTitle(text) {
  return el("h3", {}, text);
}

export function portList(ports) {
  if (!ports.length) {
    return emptyNode("No ports");
  }
  return el("div", { className: "port-list" }, ports.map((port) =>
    el("div", { className: "port-row" }, [
      el("strong", {}, port.name),
      el("code", {}, port.type),
      el("div", {}, [
        el("div", { className: "inline-list" }, [
          port.required ? badge("warn", "required") : badge(null, "optional"),
          port.widget ? badge(null, port.widget) : null,
          port.artifact_kind ? badge(null, port.artifact_kind) : null,
          port.model_requirement ? badge(null, port.model_requirement) : null,
        ].filter(Boolean)),
        port.description ? el("small", { className: "muted" }, port.description) : null,
      ].filter(Boolean)),
    ]),
  ));
}

export function runtimeList(runtimes) {
  return el("div", { className: "stack" }, runtimes.map((runtime) =>
    el("div", { className: "metric" }, [
      el("strong", {}, runtime.capability),
      el("span", {}, runtime.engine || runtime.id),
      el("div", { className: "inline-list" }, runtime.executors.map((executor) =>
        badge(executor.available ? "ok" : "warn", `${executor.kind}:${executor.id}`),
      )),
    ]),
  ));
}

export function metric(label, value) {
  return el("div", { className: "metric" }, [
    el("span", {}, label),
    el("strong", {}, value),
  ]);
}

export function table(headers, rows) {
  return el("div", { className: "table-wrap" }, [
    el("table", {}, [
      el("thead", {}, [el("tr", {}, headers.map((header) => el("th", {}, header)))]),
      el("tbody", {}, rows.map((row) => el("tr", {}, row.map((cell) => {
        const value = cell instanceof Node ? cell : String(cell);
        return el("td", {}, value);
      })))),
    ]),
  ]);
}

export function jsonBlock(value) {
  return el("pre", {}, JSON.stringify(value, null, 2));
}

export function badge(kind, text) {
  return el("span", { className: ["badge", kind].filter(Boolean).join(" ") }, text);
}

export function option(value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

export function kv(key, value) {
  return el("div", {}, [el("dt", {}, key), el("dd", {}, value)]);
}

export function emptyNode(text) {
  const node = els.emptyTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("h2").textContent = text;
  node.querySelector("p").textContent = "";
  return node;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (key === "className") {
      node.className = value;
    } else if (key === "htmlFor") {
      node.htmlFor = value;
    } else {
      node.setAttribute(key, value);
    }
  });
  const childList = Array.isArray(children) ? children : [children];
  childList.filter((child) => child !== null && child !== undefined).forEach((child) => {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}
