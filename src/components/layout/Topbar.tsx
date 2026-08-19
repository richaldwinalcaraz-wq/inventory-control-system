import { Breadcrumb } from "./Breadcrumb";
import { signOutAction } from "./actions";

function formatRole(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((word) => (word[0] ?? "").toUpperCase() + word.slice(1))
    .join(" ");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export function Topbar({
  userName,
  role,
  branchLabel,
}: {
  userName: string;
  role: string;
  branchLabel: string;
}) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <Breadcrumb />

      <div className="flex items-center gap-4">
        <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800">
          {branchLabel}
        </span>

        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
            {initials(userName)}
          </div>
          <div className="leading-tight">
            <p className="text-sm font-medium text-slate-900">{userName}</p>
            <p className="text-xs text-slate-500">{formatRole(role)}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="ml-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
