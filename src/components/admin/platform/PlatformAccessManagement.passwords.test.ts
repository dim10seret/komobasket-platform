import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "PlatformAccessManagement.tsx"), "utf8");

describe("Platform Users & Access password controls", () => {
  it("supports optional initial password and confirmation without client persistence", () => {
    expect(source).toContain('name="password" type="password"');
    expect(source).toContain('name="confirmPassword" type="password"');
    expect(source).toContain('autoComplete="new-password"');
    expect(source).toContain("password.length < 10 || password.length > 128");
    expect(source).toContain("password !== confirmPassword");
    expect(source).not.toMatch(/localStorage|sessionStorage|console\.log/);
  });

  it("shows only safe configured status and controls for non-Super-Admins", () => {
    expect(source).toContain("credential_configured");
    expect(source).toContain('"Έχει οριστεί" : "Δεν έχει οριστεί"');
    expect(source).toContain('"Αλλαγή κωδικού" : "Ορισμός κωδικού"');
    expect(source).toContain("passwordUser.is_super_admin !== 1");
    expect(source).not.toMatch(/password_hash|credential_version|salt|derived key/i);
  });

  it("uses the protected credential resource and clears forms after success", () => {
    expect(source).toContain('managementRequest("user-credentials", "POST"');
    expect(source).toContain("form.reset();");
    expect(source).toContain("setPasswordUser(null);");
  });

  it("reports partial create safely when user creation succeeds but password setup fails", () => {
    expect(source).toContain("Ο χρήστης δημιουργήθηκε, αλλά ο κωδικός δεν ορίστηκε.");
    expect(source).toContain("await load();");
  });
});

// Execute the real component and handlers with an isolated hook/transport adapter.
// No browser globals, D1 connection, credentials, or production requests are used.
type Element = { type: string | ((props: Record<string, unknown>) => unknown); props: Record<string, any> };
function nodes(value: any): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !value.props) return [];
  if (typeof value.type === "function") return nodes(value.type(value.props));
  return [value, ...nodes(value.props.children)];
}
function text(value: any): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && value.props) return text(value.props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function passwordHarness() {
  const users = ["one", "two"].map((name) => ({ id: name, email: `${name}@example.test`, display_name: name, status: "active", is_super_admin: 0, credential_configured: 0, password_set_at: null }));
  // Slots follow the component's existing useState declaration order.
  const state: any[] = [users, [], [], false, "", "", "", false, null, null, ""];
  const writes: { slot: number; value: unknown }[] = [];
  let cursor = 0;
  let outcome: () => Promise<Response> = async () => Response.json({ error: "Synthetic failure" }, { status: 400 });
  const transport = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") return outcome();
    if (url.endsWith("/users")) return Response.json({ users: users.map((u) => ({ ...u, credential_configured: 1 })) });
    if (url.endsWith("/memberships")) return Response.json({ memberships: [] });
    return Response.json({ organizations: [] });
  });
  const nativeRequire = createRequire(import.meta.url);
  const hooks = {
    useState: () => {
      const slot = cursor++;
      return [state[slot], (value: unknown) => { state[slot] = value; writes.push({ slot, value }); }];
    },
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => {},
  };
  class FormValues {
    constructor(private form: { values: Record<string, string> }) {}
    entries() { return Object.entries(this.form.values); }
  }
  const module = { exports: {} as { PlatformAccessManagement?: () => unknown } };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", "FormData", "fetch", compiled)((name: string) => {
    if (name === "react") return hooks;
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "next/image") return { __esModule: true, default: "img" };
    if (name === "lucide-react") return { ShieldCheck: () => null, UserPlus: () => null, Users: () => null };
    if (name === "react/jsx-runtime") return nativeRequire(name);
    throw new Error(`Unexpected UI test dependency: ${name}`);
  }, module, module.exports, FormValues, transport);
  const render = () => { cursor = 0; return module.exports.PlatformAccessManagement!(); };
  const dialog = () => nodes(render()).find((n) => n.props.role === "dialog");
  const open = (index = 0) => nodes(render()).filter((n) => n.type === "button" && text(n) === "Ορισμός κωδικού")[index].props.onClick();
  const form = { values: { password: "Synthetic test password", confirmPassword: "Synthetic test password" }, reset: vi.fn(() => { form.values.password = ""; form.values.confirmPassword = ""; }) };
  const submit = () => nodes(dialog()).find((n) => n.type === "form")!.props.onSubmit({ preventDefault() {}, currentTarget: form });
  const settled = () => vi.waitFor(() => expect(state[4]).toBe(""));
  return { state, writes, transport, form, render, dialog, open, submit, settled, respond: (next: () => Promise<Response>) => { outcome = next; } };
}

describe("Password modal handler and rendering regressions", () => {
  it("keeps failed saves open with an alert inside the dialog and retains entered fields", async () => {
    const h = passwordHarness(); h.open(); h.submit(); await h.settled();
    expect(h.dialog()).toBeDefined();
    expect(nodes(h.dialog()).find((n) => n.props.role === "alert")).toBeDefined();
    expect(text(h.dialog())).toContain("Ο κωδικός δεν αποθηκεύτηκε.");
    expect(h.state[6]).toBe("");
    expect(h.form.reset).not.toHaveBeenCalled();
    expect(h.form.values.password).toBe("Synthetic test password");
    expect(h.transport.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(1);
  });

  it.each(["password", "confirmPassword"])("clears stale errors when %s changes", async (name) => {
    const h = passwordHarness(); h.open(); h.submit(); await h.settled();
    nodes(h.dialog()).find((n) => n.type === "input" && n.props.name === name)!.props.onChange();
    expect(nodes(h.dialog()).some((n) => n.props.role === "alert")).toBe(false);
  });

  it("clears errors on close and when opening another user's modal", async () => {
    const h = passwordHarness(); h.open(); h.submit(); await h.settled();
    nodes(h.dialog()).find((n) => n.type === "button" && text(n) === "Κλείσιμο")!.props.onClick();
    expect(h.state[10]).toBe(""); expect(h.dialog()).toBeUndefined();
    h.state[10] = "Stale error"; h.open(1);
    expect(text(h.dialog())).toContain("two@example.test");
    expect(nodes(h.dialog()).some((n) => n.props.role === "alert")).toBe(false);
  });

  it("clears errors at the next attempt, disables Save, then resets and closes once before refreshing", async () => {
    const h = passwordHarness(); h.open(); h.submit(); await h.settled();
    let resolve!: (response: Response) => void;
    h.respond(() => new Promise<Response>((done) => { resolve = done; }));
    h.submit();
    expect(nodes(h.dialog()).some((n) => n.props.role === "alert")).toBe(false);
    expect(nodes(h.dialog()).find((n) => n.type === "button" && n.props.type === "submit")!.props.disabled).toBe(true);
    resolve(Response.json({ credential: { userId: "one", credentialConfigured: true } }));
    await h.settled();
    expect(h.form.reset).toHaveBeenCalledTimes(1);
    expect(h.dialog()).toBeUndefined();
    expect(h.writes.filter((w) => w.slot === 9 && w.value === null)).toHaveLength(1);
    expect(text(h.render())).toContain("Έχει οριστεί");
    expect(text(h.render())).toContain("Αλλαγή κωδικού");
    expect(h.transport.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(2);
    expect(h.transport.mock.calls.filter(([, o]) => !o?.method)).toHaveLength(3);
  });

  it("shows local confirmation validation inside the dialog without a mutation", async () => {
    const h = passwordHarness(); h.open(); h.form.values.confirmPassword = "Different synthetic password"; h.submit();
    expect(text(nodes(h.dialog()).find((n) => n.props.role === "alert"))).toContain("Οι δύο κωδικοί πρέπει να είναι ίδιοι.");
    expect(h.transport).not.toHaveBeenCalled();
  });

  it("never renders untrusted server errors containing password, hash, salt, token or stack material", async () => {
    const h = passwordHarness(); h.open();
    h.respond(async () => Response.json({ error: "Synthetic test password; v1$pbkdf2-sha256$100000$secret-salt$secret-hash; token=secret-token\n at server.js:1" }, { status: 500 }));
    h.submit(); await h.settled();
    const rendered = text(h.render());
    for (const forbidden of ["Synthetic test password", "pbkdf2-sha256", "secret-salt", "secret-hash", "secret-token", "server.js"]) expect(rendered).not.toContain(forbidden);
    expect(text(h.dialog())).toContain("Ο κωδικός δεν αποθηκεύτηκε.");
  });
});
