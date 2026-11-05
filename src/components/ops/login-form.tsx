"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/app/ops/actions";

export function OpsLoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="ops-token">Admin token</Label>
        <Input
          id="ops-token"
          name="token"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          aria-invalid={!!state?.error}
          aria-describedby={state?.error ? "ops-token-err" : undefined}
          className="font-mono"
        />
        {state?.error && (
          <p id="ops-token-err" className="text-xs text-destructive" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2Icon className="animate-spin" aria-hidden />}
        Sign in
      </Button>
    </form>
  );
}
