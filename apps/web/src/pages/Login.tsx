import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../lib/auth";

export function Login() {
  const { signIn, loading, blockedReason } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <Card className="w-full max-w-lg animate-rise">
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>
            Sign in with Google to access your private AI cost ledger.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {blockedReason ? (
            <div className="rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground">
              {blockedReason}
            </div>
          ) : null}
          <Button onClick={signIn} disabled={loading} className="w-full" size="lg">
            Continue with Google
          </Button>
          <p className="text-xs text-muted-foreground">
            Your data stays in your Firebase project and can be exported anytime.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
