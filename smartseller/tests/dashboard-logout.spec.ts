import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

type CookieRecord = {
  name: string;
  value: string;
  options?: {
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
  };
};

type StoreRecord = {
  store_id: string;
  tenant_id: string;
};

function readEnvFile(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env.local");
  const raw = fs.readFileSync(envPath, "utf8");
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1");
    values[key] = value;
  }

  return values;
}

const envFile = readEnvFile();

function requireEnv(name: string): string {
  const value = process.env[name] ?? envFile[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function toPlaywrightSameSite(value: string | undefined): "Lax" | "None" | "Strict" {
  if (value === "strict" || value === "Strict") return "Strict";
  if (value === "none" || value === "None") return "None";
  return "Lax";
}

async function ensureStore(admin: ReturnType<typeof createClient>): Promise<StoreRecord> {
  const { data, error } = await admin
    .from("v2_stores")
    .select("store_id,tenant_id")
    .limit(1)
    .maybeSingle<StoreRecord>();

  if (error) {
    throw new Error(`Failed to fetch v2 store fixture: ${error.message}`);
  }

  if (!data) {
    throw new Error("No v2_stores row available for logout E2E");
  }

  return data;
}

async function createAuthenticatedSession(baseURL: string) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const store = await ensureStore(admin);
  const email = `logout-e2e-${Date.now()}@example.com`;
  const password = "LogoutFixturePass!2026";

  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createUserError || !createdUser.user?.id) {
    throw new Error(`Failed to create auth user for logout E2E: ${createUserError?.message ?? "missing user id"}`);
  }

  const { error: membershipError } = await admin
    .from("v2_store_memberships")
    .upsert(
      {
        tenant_id: store.tenant_id,
        store_id: store.store_id,
        user_id: createdUser.user.id,
        role: "owner",
      },
      { onConflict: "user_id,store_id" },
    );

  if (membershipError) {
    throw new Error(`Failed to create membership for logout E2E: ${membershipError.message}`);
  }

  const requestCookies: CookieRecord[] = [];
  const responseCookies: CookieRecord[] = [];
  const serverClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => requestCookies,
      setAll: (cookiesToSet) => {
        responseCookies.splice(0, responseCookies.length, ...cookiesToSet);
      },
    },
  });

  const { error: signInError } = await serverClient.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`Failed to sign in auth user for logout E2E: ${signInError.message}`);
  }

  return {
    storeId: store.store_id,
    cookies: responseCookies,
  };
}

test.use({
  baseURL: "http://localhost:3000",
  screenshot: "only-on-failure",
});

test("private dashboard logout removes session and blocks private re-entry", async ({ browser, baseURL }) => {
  const appBaseUrl = baseURL ?? "http://localhost:3000";
  const { cookies, storeId } = await createAuthenticatedSession(appBaseUrl);
  const context = await browser.newContext();

  await context.addCookies(
    cookies
      .filter((cookie) => Boolean(cookie.name))
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: "localhost",
        path: cookie.options?.path ?? "/",
        httpOnly: cookie.options?.httpOnly ?? false,
        secure: cookie.options?.secure ?? false,
        sameSite: toPlaywrightSameSite(cookie.options?.sameSite),
      })),
  );

  const page = await context.newPage();
  const privateRoute = `/dashboard/${storeId}`;
  await page.goto(privateRoute);

  const header = page.locator("header").first();
  await expect(header.getByRole("button", { name: "Logout" })).toBeVisible();
  await expect(header.locator("button")).toHaveCount(1);
  await expect(header.locator("form[action='/api/auth/logout']")).toHaveCount(1);

  await header.getByRole("button", { name: "Logout" }).click();
  await page.waitForURL(/\/enter$/);
  await expect(page).toHaveURL(/\/enter$/);

  await page.goto(privateRoute);
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/enter$/);

  await context.close();
});
