import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { isOwnerUser } from './owner';

/** A Supabase client bound to the request's cookies. Used only for sign-in, never for data. */
export async function supabaseServer() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) jar.set(name, value, options);
          } catch {
            // Cookies are read-only in some contexts; the session is refreshed on the next write.
          }
        },
      },
    },
  );
}

/**
 * The real access check, done next to the data: asks Supabase who the cookie belongs to
 * (a server round trip, not a local decode) and compares with the one allowed GitHub account.
 */
export async function isOwner(): Promise<boolean> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    return isOwnerUser(data.user, process.env.OWNER_GITHUB_ID ?? '');
  } catch {
    return false;
  }
}
