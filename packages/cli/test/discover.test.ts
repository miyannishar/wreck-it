import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { discover } from "../src/discover/index.js";
import { flatRoutePath } from "../src/discover/remix.js";
import { redactUrl } from "../src/discover/database.js";
import { tmpRoot, runCli } from "./helpers.js";
import { writeTree } from "./fixtures.js";

const pkg = (deps: Record<string, string>, scripts: Record<string, string> = { dev: "x" }) => JSON.stringify({ scripts, dependencies: deps });
async function scan(tree: Record<string, string>) { const root = await tmpRoot(); await writeTree(root, tree); return discover(root); }
const paths = (d: { pages: { path: string }[] }) => d.pages.map((p) => p.path);
const eps = (d: { api: { method: string; path: string }[] }) => d.api.map((a) => `${a.method} ${a.path}`);

describe("discover adapters", () => {
  it("next app + pages router", async () => {
    const d = await scan({
      "package.json": pkg({ next: "15" }, { dev: "next dev -p 4000" }),
      "src/app/page.tsx": "export default function P(){}",
      "src/app/(shop)/products/[id]/page.tsx": "",
      "src/app/@modal/login/page.tsx": "",
      "src/app/_lib/page.tsx": "",
      "src/app/api/items/route.ts": "export async function GET() {}\nexport const POST = async () => {};",
      "src/app/api/raw/route.ts": "const h = 1;",
      "pages/about.tsx": "", "pages/_app.tsx": "", "pages/blog/index.tsx": "",
      "pages/api/hello.ts": "export default function h(req, res) { if (req.method === 'POST') {} }",
      "pages/api/any.ts": "export default function h(req, res) {}",
      "node_modules/x/app/page.tsx": "",
    });
    expect(d.frameworks).toEqual(["nextjs-app", "nextjs-pages"]);
    expect(paths(d)).toEqual(["/", "/about", "/blog", "/products/[id]"]);
    expect(d.pages.find((p) => p.path === "/products/[id]")).toMatchObject({ dynamic: true, file: "src/app/(shop)/products/[id]/page.tsx" });
    expect(eps(d).sort()).toEqual(["ANY /api/any", "ANY /api/raw", "GET /api/items", "POST /api/hello", "POST /api/items"]);
    expect(d.api.find((a) => a.method === "POST" && a.path === "/api/items")?.line).toBe(2);
    expect(d.baseUrl).toBe("http://localhost:4000");
    expect(d.devScript).toBe("npm run dev");
  });

  it("express", async () => {
    const d = await scan({
      "package.json": pkg({ express: "4" }, { dev: "PORT=8080 node server.js" }),
      "pnpm-lock.yaml": "",
      "server.js": "const app = express();\napp.get('/health', h);\nrouter.post(\"/users/:id\", h);\napp.all(`/x`, h);\naxios.get('/nope');\napp.use('/api', router);",
      "test/server.test.js": "app.get('/test-only', h)",
    });
    expect(d.frameworks).toEqual(["express"]);
    expect(d.api).toContainEqual({ method: "GET", path: "/health", file: "server.js", line: 2 });
    expect(eps(d).sort()).toEqual(["ANY /x", "GET /health", "POST /users/:id"]);
    expect(d.baseUrl).toBe("http://localhost:8080");
    expect(d.devScript).toBe("pnpm run dev");
    expect(d.warnings.join()).toMatch(/\/api/);
  });

  it("fastify", async () => {
    const d = await scan({
      "package.json": pkg({ fastify: "5" }),
      "src/index.ts": "fastify.get('/a', h)\nfastify.route({\n  method: ['GET', 'POST'],\n  url: '/b',\n  handler })\nfastify.route({ method: 'DELETE', url: '/c', handler })",
    });
    expect(d.frameworks).toEqual(["fastify"]);
    expect(eps(d).sort()).toEqual(["DELETE /c", "GET /a", "GET /b", "POST /b"]);
    expect(d.api.find((a) => a.path === "/b")?.line).toBe(2);
    expect(d.baseUrl).toBe("http://localhost:3000");
  });

  it("hono", async () => {
    const d = await scan({ "package.json": pkg({ hono: "4" }), "src/index.ts": "const app = new Hono()\napp.get('/', c => c.text('hi'))\napp.on('PURGE', '/cache', h)\napp.delete('/posts/:id', h)" });
    expect(d.frameworks).toEqual(["hono"]);
    expect(eps(d).sort()).toEqual(["DELETE /posts/:id", "GET /", "PURGE /cache"]);
  });

  it("react-router (vite)", async () => {
    const d = await scan({
      "package.json": JSON.stringify({ scripts: { dev: "vite" }, dependencies: { "react-router-dom": "6" }, devDependencies: { vite: "6" } }),
      "src/main.tsx": "const router = createBrowserRouter([{ path: \"/\", element: <Home/> }, { path: '/users/:id', element: <U/> }, { path: '*', element: <NF/> }]);",
      "src/App.tsx": "<Routes><Route path=\"/about\" element={<A/>} /><Route path={'/docs/:slug?'} element={<D/>} /></Routes>",
      "vite.config.ts": "export default { resolve: { alias: { path: '/ignored' } } }",
    });
    expect(d.frameworks).toEqual(["react-router"]);
    expect(paths(d)).toEqual(["/", "/about", "/docs/[[slug]]", "/users/[id]"]);
    expect(d.baseUrl).toBe("http://localhost:5173");
  });

  it("react-router v7 routes.ts config", async () => {
    const d = await scan({
      "package.json": pkg({ "@react-router/dev": "7", "react-router": "7" }),
      "app/routes.ts": "export default [index('routes/home.tsx'), route('products/:id', './routes/product.tsx')]",
    });
    expect(d.pages).toEqual([{ path: "/", file: "app/routes/home.tsx", dynamic: false }, { path: "/products/[id]", file: "app/routes/product.tsx", dynamic: true }]);
  });

  it("sveltekit", async () => {
    const d = await scan({
      "package.json": pkg({ "@sveltejs/kit": "2" }, { dev: "vite dev --port 5555" }),
      "src/routes/+page.svelte": "",
      "src/routes/(app)/blog/[slug=word]/+page.svelte": "",
      "src/routes/login/+page.svelte": "<form method=\"POST\" action=\"?/login\"><input name=\"email\"><input name=\"password\" type=\"password\"></form>",
      "src/routes/login/+page.server.ts": "export const actions = { login: async () => {} };",
      "src/routes/api/todos/+server.ts": "export async function GET() {}\nexport const POST: RequestHandler = async () => {};",
    });
    expect(d.frameworks).toEqual(["sveltekit"]);
    expect(paths(d)).toEqual(["/", "/blog/[slug]", "/login"]);
    expect(eps(d).sort()).toEqual(["GET /api/todos", "POST /api/todos", "POST /login"]);
    expect(d.baseUrl).toBe("http://localhost:5555");
    expect(d.forms).toEqual([{ file: "src/routes/login/+page.svelte", line: 1, fields: ["email", "password"], action: "?/login" }]);
    expect(d.auth.kind).toBe("unknown");
  });

  it("remix flat routes", async () => {
    const d = await scan({
      "package.json": JSON.stringify({ scripts: { dev: "remix vite:dev" }, dependencies: { "@remix-run/react": "2", "@remix-run/node": "2" }, devDependencies: { vite: "5" } }),
      "app/routes/_index.tsx": "export default function I(){}",
      "app/routes/products.$id.tsx": "export async function loader() {}\nexport default function P(){}",
      "app/routes/_auth.login.tsx": "export const action = async () => {};\nexport default function L(){}",
      "app/routes/api.webhook.ts": "export async function action() {}",
      "app/routes/settings/route.tsx": "export default function S(){}",
      "app/routes/settings/helper.ts": "",
    });
    expect(d.frameworks).toEqual(["remix"]);
    expect(paths(d)).toEqual(["/", "/login", "/products/[id]", "/settings"]);
    expect(eps(d).sort()).toEqual(["GET /products/[id]", "POST /api/webhook", "POST /login"]);
    expect(d.baseUrl).toBe("http://localhost:5173");
    expect(flatRoutePath("($lang).docs.$")).toBe("/[[lang]]/docs/[...splat]");
    expect(flatRoutePath("sitemap[.]xml")).toBe("/sitemap.xml");
    expect(flatRoutePath("concerts_.mine")).toBe("/concerts/mine");
  });

  it("unknown framework → empty result, not an error", async () => {
    const d = await scan({ "package.json": JSON.stringify({ dependencies: { lodash: "4" } }), "index.js": "app.get('/x', h)" });
    expect(d).toMatchObject({ frameworks: [], pages: [], api: [], forms: [], auth: { kind: "none" } });
    expect(d.baseUrl).toBeUndefined();
    expect(d.database).toBeUndefined();
    expect(d.warnings.join()).toMatch(/no known framework/);
  });

  it("no package.json at all", async () => {
    const d = await discover(await tmpRoot());
    expect(d.frameworks).toEqual([]);
    expect(d.warnings.join()).toMatch(/no package.json/);
  });
});

describe("discover details", () => {
  it("forms: fields, action, multi-line JSX, line numbers", async () => {
    const d = await scan({
      "package.json": pkg({}),
      "src/Signup.jsx": "export const S = () => (\n  <div>\n    <form id=\"signup\" onSubmit={(e) => e.preventDefault() > 0} action={\"/api/signup\"}>\n      <input name=\"email\" id=\"email-input\" />\n      <input id=\"pw\" type=\"password\" />\n      <button aria-label='Submit form'>Go</button>\n    </form>\n    <form><select name={\"plan\"}></select></form>\n  </div>);",
      "public/index.html": "<html>\n<FORM></FORM>\n<form action=\"/search\"><input name='q'></form></html>",
    });
    expect(d.forms).toContainEqual({ file: "src/Signup.jsx", line: 3, fields: ["email", "pw", "Submit form"], action: "/api/signup" });
    expect(d.forms).toContainEqual({ file: "src/Signup.jsx", line: 8, fields: ["plan"] });
    expect(d.forms).toContainEqual({ file: "public/index.html", line: 3, fields: ["q"], action: "/search" });
    expect(d.auth).toMatchObject({ kind: "unknown" });
  });

  it("auth from dependencies", async () => {
    const d = await scan({ "package.json": JSON.stringify({ dependencies: { next: "15", "next-auth": "5", jose: "5" } }) });
    expect(d.auth.kind).toBe("next-auth");
    expect(d.auth.evidence).toEqual(["dependency next-auth → next-auth", "dependency jose → jwt"]);
    for (const [dep, kind] of [["@clerk/nextjs", "clerk"], ["@supabase/ssr", "supabase"], ["lucia", "lucia"], ["better-auth", "better-auth"], ["passport-local", "passport"], ["jsonwebtoken", "jwt"], ["express-session", "custom-session"], ["iron-session", "custom-session"]])
      expect((await scan({ "package.json": JSON.stringify({ dependencies: { [dep]: "1" } }) })).auth.kind).toBe(kind);
  });

  it("remote database detected and password redacted", async () => {
    const d = await scan({
      "package.json": pkg({ next: "15" }),
      ".env": "DATABASE_URL=postgres://localhost/dev\n",
      ".env.local": "# prod!\nexport DATABASE_URL=\"postgresql://admin:s3cr3t/p@ss@db.prod.example.com:5432/app?sslmode=require&password=xyz\"\n",
    });
    expect(d.database).toEqual({ kind: "postgres", url: "postgresql://admin:***@db.prod.example.com:5432/app?sslmode=require&password=***", remote: true });
    expect(JSON.stringify(d)).not.toMatch(/s3cr3t|xyz/);
  });

  it("local databases: localhost, private ip, docker service, sqlite, mongo+srv remote", async () => {
    const db = async (env: string) => (await scan({ ".env.development": env })).database;
    expect(await db("DATABASE_URL=postgres://u:p@127.0.0.1:5432/x")).toMatchObject({ remote: false, url: "postgres://u:***@127.0.0.1:5432/x" });
    expect(await db("DATABASE_URL=mysql://root:pw@db:3306/x")).toMatchObject({ kind: "mysql", remote: false });
    expect(await db("DATABASE_URL=postgres://u:p@192.168.1.10/x")).toMatchObject({ remote: false });
    expect(await db("DATABASE_URL=file:./dev.db")).toEqual({ kind: "sqlite", url: "file:./dev.db", remote: false });
    expect(await db("MONGODB_URI=mongodb+srv://u:p@cluster0.abc.mongodb.net/db")).toMatchObject({ kind: "mongodb", remote: true });
    expect(await db("SUPABASE_URL=https://abc.supabase.co")).toMatchObject({ kind: "supabase", remote: true });
    expect(await db("OTHER=1")).toBeUndefined();
    expect(redactUrl("postgres://u@h/x")).toBe("postgres://u@h/x");
  });

  it("port detection: --port, -p=, framework defaults, vite config", async () => {
    const base = async (tree: Record<string, string>) => (await scan(tree)).baseUrl;
    expect(await base({ "package.json": pkg({ next: "15" }, { dev: "next dev --port 3100" }) })).toBe("http://localhost:3100");
    expect(await base({ "package.json": pkg({ next: "15" }, { dev: "next dev" }) })).toBe("http://localhost:3000");
    expect(await base({ "package.json": pkg({ "@sveltejs/kit": "2" }, { dev: "vite dev" }), "vite.config.ts": "export default { server: { port: 4321 } }" })).toBe("http://localhost:4321");
    expect(await base({ "package.json": pkg({ "@remix-run/node": "2" }, { dev: "remix dev" }) })).toBe("http://localhost:3000");
    const y = await scan({ "package.json": pkg({ express: "4" }, { start: "node s.js" }), "yarn.lock": "" });
    expect([y.baseUrl, y.devScript]).toEqual(["http://localhost:3000", "yarn start"]);
  });

  it("caps scanned files with a warning", async () => {
    const { walk } = await import("../src/discover/walk.js");
    const root = await tmpRoot();
    await writeTree(root, Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`src/f${i}.ts`, ""])));
    expect(await walk(root, 3)).toMatchObject({ capped: true, files: ["src/f0.ts", "src/f1.ts", "src/f2.ts"] });
  });
});

describe("discover CLI", () => {
  it("writes discovery.json, prints summary and --json", async () => {
    const root = await tmpRoot();
    await writeTree(root, { "package.json": pkg({ next: "15" }), "app/page.tsx": "", "app/users/[id]/page.tsx": "", ".env": "DATABASE_URL=postgres://u:hunter2@prod.example.com/db" });
    const r = await runCli(["discover", "--root", root]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/nextjs-app/);
    expect(r.stdout).toMatch(/pages: 2 \(1 dynamic\)/);
    expect(r.stdout).toMatch(/REMOTE/);
    expect(r.stdout).not.toMatch(/hunter2/);
    const saved = JSON.parse(await readFile(join(root, ".wreck-it", "discovery.json"), "utf8"));
    expect(saved.pages.map((p: { path: string }) => p.path)).toEqual(["/", "/users/[id]"]);
    const j = await runCli(["discover", "--root", root, "--json"]);
    expect(JSON.parse(j.stdout)).toMatchObject({ frameworks: ["nextjs-app"], baseUrl: "http://localhost:3000", database: { remote: true } });
    expect(j.stdout).not.toMatch(/hunter2/);
  });
});
