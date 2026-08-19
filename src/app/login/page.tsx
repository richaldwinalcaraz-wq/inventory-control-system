"use client";

import { useActionState } from "react";
import { StackIcon } from "@phosphor-icons/react/dist/ssr";
import { loginAction } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, {
    error: null,
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-950 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-700 text-white">
            <StackIcon size={20} weight="bold" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight text-slate-900">Inventory Control</h1>
            <p className="text-sm leading-tight text-slate-500">System</p>
          </div>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="username"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
            />
          </div>

          {state.error ? (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-md bg-brand-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
