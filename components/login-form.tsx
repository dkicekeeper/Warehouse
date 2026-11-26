'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function LoginForm() {
  const denied = useSearchParams().get('denied') === '1';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    );
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError('Не удалось начать вход. Попробуйте ещё раз.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {denied && (
        <p role="alert" className="rounded-md border border-line bg-warn-bg px-3 py-2 text-sm text-warn">
          Этот аккаунт GitHub не имеет доступа.
        </p>
      )}
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper disabled:opacity-60"
      >
        {busy ? 'Открываю GitHub…' : 'Войти через GitHub'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
