import { chromium } from "playwright-core";

/**
 * Rendered-size assertions via headless Chrome (no attribute sniffing).
 *
 * Uses the system Chrome (`channel: "chrome"`, present on dev machines and
 * GitHub-hosted runners) so no browser download is needed.
 */
export interface RenderedBox {
  width: number;
  height: number;
}

/** Serve `fetch` on 127.0.0.1, load `path` with `cookie`, measure `selector`. */
export async function renderedBox(options: {
  fetch: (req: Request) => Response | Promise<Response>;
  cookie: string;
  path: string;
  selector: string;
}): Promise<RenderedBox> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: options.fetch,
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const [name, ...rest] = options.cookie.split("=");
    const context = await browser.newContext();
    await context.addCookies([
      { name: name!, value: rest.join("="), domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.port}${options.path}`);
    const box = await page.locator(options.selector).first().boundingBox();
    if (!box) {
      throw new Error(`no visible element matches ${options.selector}`);
    }
    return { width: box.width, height: box.height };
  } finally {
    await browser.close();
    server.stop();
  }
}
