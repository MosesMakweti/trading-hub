"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, Plug, ShieldAlert, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { createApiTokenAction, listApiTokensAction, revokeApiTokenAction } from "@/actions/api-tokens.actions";
import type { ApiTokenSummary } from "@/server/services/api-tokens.service";

/**
 * TradingView Extension — Step 9, Part 10. The trader's own token
 * management surface. Every mutation goes through the existing
 * `api-tokens.actions.ts` functions — this component has no fetch/API call
 * of its own. The raw token value only ever exists in `justCreatedToken`
 * state, set once from `createApiTokenAction`'s own return value and
 * cleared the moment the trader dismisses the reveal panel or navigates
 * away — never re-fetched, never logged, never sent anywhere else.
 */

function formatDate(value: Date | string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function IntegrationsView({ initialTokens }: { initialTokens: ApiTokenSummary[] }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [justCreated, setJustCreated] = useState<{ rawToken: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    const result = await listApiTokensAction();
    if (result.success) setTokens(result.tokens);
  }

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createApiTokenAction(trimmed);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setJustCreated({ rawToken: result.rawToken, name: trimmed });
      setName("");
      await refresh();
    });
  }

  function handleRevoke(tokenId: string) {
    startTransition(async () => {
      const result = await revokeApiTokenAction(tokenId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      await refresh();
    });
  }

  async function copyToken() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.rawToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select and copy the token manually.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Extension &amp; API Tokens</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect the TradingView Companion extension, or any other tool that speaks Traditorium&apos;s API, with a personal access token.
        </p>
      </div>

      {justCreated ? (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" />
              &ldquo;{justCreated.name}&rdquo; created
            </CardTitle>
            <CardDescription>
              Copy this token now. For security, Traditorium cannot display it again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
                {justCreated.rawToken}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={copyToken}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setJustCreated(null)}>
              Done
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New token</CardTitle>
            <CardDescription>Give it a name so you can tell tokens apart later, e.g. &ldquo;TradingView Chrome&rdquo;.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="TradingView Chrome"
                maxLength={100}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Button type="button" onClick={handleCreate} disabled={isPending || !name.trim()}>
                <Plug className="size-3.5" />
                Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {tokens.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
        {tokens.map((token) => {
          const revoked = token.revokedAt != null;
          return (
            <div
              key={token.id}
              className="glass flex items-center justify-between gap-4 rounded-xl px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {token.name}
                  {revoked && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Revoked</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <code>{token.tokenPrefix}…</code> · Created {formatDate(token.createdAt)} · Last used {formatDate(token.lastUsedAt)}
                  {token.expiresAt ? ` · Expires ${formatDate(token.expiresAt)}` : ""}
                </div>
              </div>
              {!revoked && (
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                        <Trash2 className="size-3.5" />
                        Revoke
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke &ldquo;{token.name}&rdquo;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Anything using this token — including the TradingView extension, if it&apos;s connected with it — will stop working immediately. This can&apos;t be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleRevoke(token.id)}>Revoke</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
