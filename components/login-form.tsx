'use client';

import { useSearchParams } from 'next/navigation';

export function LoginForm() {
  const denied = useSearchParams().get('denied') === '1';
  return (
    <div className="flex flex-col gap-3">
      {denied && (
        <p role="alert" className="rounded-md border border-line bg-warn-bg px-3 py-2 text-sm text-warn">
          Войти не получилось: этот аккаунт GitHub не имеет доступа, или вход был прерван.
        </p>
      )}
      {/* A plain link on purpose: the sign-in route answers with a redirect to GitHub. */}
      <a href="/auth/login" className="rounded-md bg-ink px-4 py-2.5 text-center text-sm font-medium text-paper no-underline">
        Войти через GitHub
      </a>
    </div>
  );
}
