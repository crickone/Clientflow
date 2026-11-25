/**
 * Test support for the lead-flow tests: import it FIRST in a test file.
 * Stubs the modules plain Node cannot load outside Next, makes every fetch
 * fail (no real provider is ever reached), and fixes the app URL and the
 * unsubscribe-token secret to obvious test values.
 */
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("redirect stub");
      },
      notFound: () => {
        throw new Error("notFound stub");
      },
    };
  }
  if (request === "next/headers") {
    return {
      cookies: () => {
        throw new Error("no request scope");
      },
      headers: () => {
        throw new Error("no request scope");
      },
    };
  }
  if (request === "next/cache") return { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
process.env.APP_URL = "http://app.test";
process.env.EMAIL_TOKEN_SECRET = process.env.EMAIL_TOKEN_SECRET || "test-secret-not-real";

export {};
