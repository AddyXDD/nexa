import { api } from "@/convex/_generated/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, Check, ChevronsUpDown, Plus, UserRound } from "lucide-react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router";

/**
 * Workspace switcher: personal Nexa plus every organization the signed-in
 * account belongs to. The list is the server's answer, never a client cache
 * of memberships.
 */
export function OrgSwitcher({
  currentSlug,
  compact = false,
}: {
  currentSlug?: string;
  compact?: boolean;
}) {
  const mine = useQuery(api.organizations.mine);
  const navigate = useNavigate();
  const organizations = mine?.organizations ?? [];
  const current = organizations.find((org) => org.slug === currentSlug);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 max-w-[15rem] items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm transition-colors hover:bg-muted"
        >
          {current ? (
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <UserRound className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium">
            {compact ? null : (current?.name ?? "Personal workspace")}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => navigate("/dashboard")}
          className="cursor-pointer"
        >
          <UserRound className="mr-2 size-4" />
          <span className="flex-1">Personal</span>
          {currentSlug === undefined && <Check className="size-3.5" />}
        </DropdownMenuItem>
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => navigate(`/org/${org.slug}`)}
            className="cursor-pointer"
          >
            <Building2 className="mr-2 size-4" />
            <span className="flex-1 truncate">{org.name}</span>
            {org.role !== "member" && (
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {org.role}
              </span>
            )}
            {currentSlug === org.slug && <Check className="ml-1 size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigate("/org/new")}
          className="cursor-pointer"
        >
          <Plus className="mr-2 size-4" />
          Create a workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
